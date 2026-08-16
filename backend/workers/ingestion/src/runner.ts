import {
  type CatalogObservation,
  canonicalizeObservation,
  exactIdentityKeys,
} from "@ai-job-apply/jobs-service";
import { type RetryBackoffPolicy, retryDelayForAttempt } from "./backoff.js";
import type {
  IngestionRunResult,
  JobCatalogIngestionPort,
  SourceJobObservation,
  SourcePollResult,
} from "./contract.js";
import type { SourceRegistry } from "./registry.js";

export const maximumSourceBatchSize = 100;

export interface IngestionRunnerOptions {
  clock?: () => Date;
  backoffPolicy?: RetryBackoffPolicy;
}

export class SourceBatchContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceBatchContractError";
  }
}

const sourceObservationKeys = new Set([
  "atsTenant",
  "companyName",
  "department",
  "description",
  "employerRequisitionId",
  "externalJobId",
  "locations",
  "sourceUrl",
  "title",
  "validThrough",
  "verifiedCompanyDomain",
]);
const retryReasons = new Set(["rate_limited", "source_unavailable", "timeout"]);

function exactKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SourceBatchContractError(`${label} contains an unsupported field`);
  }
}

function currentTimestamp(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SourceBatchContractError("The ingestion clock returned an invalid timestamp");
  }
  return new Date(value);
}

function enforceSyntheticSourceBoundary(source: SourceJobObservation): void {
  if (
    typeof source.sourceUrl !== "string" ||
    source.sourceUrl.length > 2_048 ||
    !/^[\x21-\x7e]+$/.test(source.sourceUrl)
  ) {
    throw new SourceBatchContractError("The synthetic source URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(source.sourceUrl);
  } catch {
    throw new SourceBatchContractError("The synthetic source URL is invalid");
  }
  const syntheticHostname =
    url.hostname !== "example.test" && url.hostname.endsWith(".example.test");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search ||
    !syntheticHostname
  ) {
    throw new SourceBatchContractError(
      "The synthetic source URL must be an exact HTTPS .example.test URL without credentials, ports, fragments, or query parameters",
    );
  }
  if (
    typeof source.verifiedCompanyDomain !== "string" ||
    source.verifiedCompanyDomain.length > 253 ||
    !/^[a-z0-9.-]+$/i.test(source.verifiedCompanyDomain) ||
    source.verifiedCompanyDomain.toLocaleLowerCase("en-US") === "example.test" ||
    !source.verifiedCompanyDomain.toLocaleLowerCase("en-US").endsWith(".example.test")
  ) {
    throw new SourceBatchContractError(
      "The synthetic verified company domain must use .example.test",
    );
  }
}

function catalogObservation(
  source: SourceJobObservation,
  registration: ReturnType<SourceRegistry["requireEnabled"]>,
  observedAt: Date,
): CatalogObservation {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new SourceBatchContractError("A source observation must be an object");
  }
  exactKeys(source, sourceObservationKeys, "The source observation");
  if (!Array.isArray(source.locations)) {
    throw new SourceBatchContractError("Source locations must be an array");
  }
  if (source.validThrough !== undefined && !(source.validThrough instanceof Date)) {
    throw new SourceBatchContractError("Source validThrough must be a Date");
  }
  enforceSyntheticSourceBoundary(source);
  const candidate: CatalogObservation = {
    provider: registration.provider,
    provenance: registration.provenance,
    companyName: source.companyName,
    title: source.title,
    locations: [...source.locations],
    description: source.description,
    sourceUrl: source.sourceUrl,
    observedAt: new Date(observedAt),
    adapterVersion: registration.adapter.adapterVersion,
    ...(source.atsTenant ? { atsTenant: source.atsTenant } : {}),
    ...(source.externalJobId ? { externalJobId: source.externalJobId } : {}),
    ...(source.employerRequisitionId
      ? { employerRequisitionId: source.employerRequisitionId }
      : {}),
    ...(source.verifiedCompanyDomain
      ? { verifiedCompanyDomain: source.verifiedCompanyDomain }
      : {}),
    ...(source.department ? { department: source.department } : {}),
    ...(source.validThrough ? { validThrough: new Date(source.validThrough) } : {}),
  };
  const canonical = canonicalizeObservation(candidate);
  return {
    ...candidate,
    sourceUrl: canonical.canonicalUrl,
    ...(canonical.verifiedCompanyDomain
      ? { verifiedCompanyDomain: canonical.verifiedCompanyDomain }
      : {}),
  };
}

function validateBatch(
  result: SourcePollResult,
  registration: ReturnType<SourceRegistry["requireEnabled"]>,
  observedAt: Date,
): CatalogObservation[] {
  if (!result || typeof result !== "object" || result.kind !== "success") {
    throw new SourceBatchContractError("The source returned an invalid success batch");
  }
  exactKeys(result, new Set(["kind", "observations"]), "The source success result");
  if (!Array.isArray(result.observations)) {
    throw new SourceBatchContractError("The source returned an invalid success batch");
  }
  if (result.observations.length > maximumSourceBatchSize) {
    throw new SourceBatchContractError("The source batch exceeds its bounded size");
  }
  const identities = new Set<string>();
  return result.observations.map((source) => {
    const observation = catalogObservation(source, registration, observedAt);
    const canonical = canonicalizeObservation(observation);
    for (const identity of exactIdentityKeys(canonical)) {
      if (identities.has(identity)) {
        throw new SourceBatchContractError("A source batch contains a duplicate exact identity");
      }
      identities.add(identity);
    }
    return observation;
  });
}

export class SourceNeutralIngestionRunner {
  readonly #clock: () => Date;
  readonly #backoffPolicy: RetryBackoffPolicy | undefined;

  constructor(
    private readonly registry: SourceRegistry,
    private readonly catalog: JobCatalogIngestionPort,
    options: IngestionRunnerOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date());
    this.#backoffPolicy = options.backoffPolicy;
  }

  async run(sourceId: string, attempt: number, signal: AbortSignal): Promise<IngestionRunResult> {
    const registration = this.registry.requireEnabled(sourceId);
    if (signal.aborted) {
      return {
        sourceId,
        status: "aborted",
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      };
    }
    const observedAt = currentTimestamp(this.#clock);
    let result: SourcePollResult;
    try {
      result = await registration.adapter.poll({ observedAt: new Date(observedAt), signal });
    } catch {
      if (signal.aborted) {
        return {
          sourceId,
          status: "aborted",
          observationCount: 0,
          createdCount: 0,
          updatedCount: 0,
        };
      }
      result = { kind: "retry", reason: "source_unavailable" };
    }
    if (this.registry.requireEnabled(sourceId) !== registration) {
      throw new Error("The ingestion source registration changed during the run");
    }
    if (signal.aborted) {
      return {
        sourceId,
        status: "aborted",
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      };
    }
    if (result.kind === "retry") {
      exactKeys(result, new Set(["kind", "reason", "retryAfterMs"]), "The source retry result");
      if (!retryReasons.has(result.reason)) {
        throw new SourceBatchContractError("The source retry reason is invalid");
      }
      return {
        sourceId,
        status: "retry",
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
        reason: result.reason,
        retryAfterMs: retryDelayForAttempt(attempt, result.retryAfterMs, this.#backoffPolicy),
      };
    }
    const observations = validateBatch(result, registration, observedAt);
    let createdCount = 0;
    let updatedCount = 0;
    for (const observation of observations) {
      if (signal.aborted) {
        return {
          sourceId,
          status: "aborted",
          observationCount: createdCount + updatedCount,
          createdCount,
          updatedCount,
        };
      }
      if (this.registry.requireEnabled(sourceId) !== registration) {
        throw new Error("The ingestion source registration changed during the run");
      }
      const recorded = await this.catalog.recordObservation(observation);
      if (recorded.outcome === "created") createdCount += 1;
      else updatedCount += 1;
      if (this.registry.requireEnabled(sourceId) !== registration) {
        throw new Error("The ingestion source registration changed during the run");
      }
      if (signal.aborted) {
        return {
          sourceId,
          status: "aborted",
          observationCount: createdCount + updatedCount,
          createdCount,
          updatedCount,
        };
      }
    }
    return {
      sourceId,
      status: "succeeded",
      observationCount: observations.length,
      createdCount,
      updatedCount,
    };
  }
}
