import {
  type CatalogObservation,
  canonicalizeObservation,
  exactIdentityKeys,
} from "@ai-job-apply/jobs-service";
import { type RetryBackoffPolicy, retryDelayForAttempt } from "./backoff.js";
import type {
  IngestionRunResult,
  JobCatalogIngestionPort,
  SourceExecutionGate,
  SourceExecutionIdentity,
  SourceJobObservation,
  SourcePollResult,
} from "./contract.js";
import type { SourceRegistry } from "./registry.js";

export const maximumSourceBatchSize = 100;

export interface IngestionRunnerOptions {
  clock?: () => Date;
  backoffPolicy?: RetryBackoffPolicy;
  sourceExecutionGate?: SourceExecutionGate;
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
  "employmentType",
  "externalJobId",
  "locations",
  "sourceUrl",
  "title",
  "validThrough",
  "verifiedCompanyDomain",
  "workMode",
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

function enforceGreenhouseSourceBoundary(source: SourceJobObservation): void {
  if (
    typeof source.sourceUrl !== "string" ||
    source.sourceUrl.length > 2_048 ||
    !/^[\x21-\x7e]+$/.test(source.sourceUrl)
  ) {
    throw new SourceBatchContractError("The Greenhouse source URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(source.sourceUrl);
  } catch {
    throw new SourceBatchContractError("The Greenhouse source URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    !new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]).has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search
  ) {
    throw new SourceBatchContractError(
      "The Greenhouse source URL is outside the approved host boundary",
    );
  }
  if (
    typeof source.atsTenant !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(source.atsTenant) ||
    typeof source.externalJobId !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(source.externalJobId) ||
    typeof source.verifiedCompanyDomain !== "string" ||
    source.verifiedCompanyDomain.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      source.verifiedCompanyDomain,
    )
  ) {
    throw new SourceBatchContractError("The Greenhouse source identity is invalid");
  }
  if (url.pathname !== `/${source.atsTenant}/jobs/${source.externalJobId}`) {
    throw new SourceBatchContractError(
      "The Greenhouse source URL does not match its board and job identity",
    );
  }
}

function enforceLeverSourceBoundary(source: SourceJobObservation): void {
  if (typeof source.sourceUrl !== "string" || source.sourceUrl.length > 2_048) {
    throw new SourceBatchContractError("The Lever source URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(source.sourceUrl);
  } catch {
    throw new SourceBatchContractError("The Lever source URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    !new Set(["jobs.lever.co", "jobs.eu.lever.co"]).has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search ||
    typeof source.atsTenant !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(source.atsTenant) ||
    typeof source.externalJobId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/.test(source.externalJobId) ||
    url.pathname !== `/${source.atsTenant}/${source.externalJobId}`
  ) {
    throw new SourceBatchContractError(
      "The Lever source URL does not match its site and posting identity",
    );
  }
}

function enforceAshbySourceBoundary(source: SourceJobObservation): void {
  if (typeof source.sourceUrl !== "string" || source.sourceUrl.length > 2_048) {
    throw new SourceBatchContractError("The Ashby source URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(source.sourceUrl);
  } catch {
    throw new SourceBatchContractError("The Ashby source URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "jobs.ashbyhq.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search ||
    typeof source.atsTenant !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/.test(source.atsTenant) ||
    typeof source.externalJobId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/.test(source.externalJobId) ||
    url.pathname !== `/${source.atsTenant}/${source.externalJobId}`
  ) {
    throw new SourceBatchContractError(
      "The Ashby source URL does not match its board and posting identity",
    );
  }
}

function enforceSourceBoundary(
  source: SourceJobObservation,
  registration: ReturnType<SourceRegistry["requireEnabled"]>,
): void {
  if (registration.provider === "other" && registration.provenance === "authorized_fixture") {
    enforceSyntheticSourceBoundary(source);
    return;
  }
  if (registration.provider === "greenhouse" && registration.provenance === "permitted_api") {
    enforceGreenhouseSourceBoundary(source);
    return;
  }
  if (registration.provider === "lever" && registration.provenance === "permitted_api") {
    enforceLeverSourceBoundary(source);
    return;
  }
  if (registration.provider === "ashby" && registration.provenance === "permitted_api") {
    enforceAshbySourceBoundary(source);
    return;
  }
  throw new SourceBatchContractError("The source observation boundary is not implemented");
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
  enforceSourceBoundary(source, registration);
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
    ...(source.workMode ? { workMode: source.workMode } : {}),
    ...(source.employmentType ? { employmentType: source.employmentType } : {}),
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
  readonly #sourceExecutionGate: SourceExecutionGate | undefined;

  constructor(
    private readonly registry: SourceRegistry,
    private readonly catalog: JobCatalogIngestionPort,
    options: IngestionRunnerOptions = {},
  ) {
    this.#clock = options.clock ?? (() => new Date());
    this.#backoffPolicy = options.backoffPolicy;
    this.#sourceExecutionGate = options.sourceExecutionGate;
  }

  async #executionEnabled(identity: Readonly<SourceExecutionIdentity>): Promise<boolean> {
    if (!this.#sourceExecutionGate) return true;
    const enabled = await this.#sourceExecutionGate(Object.freeze({ ...identity }));
    if (typeof enabled !== "boolean") {
      throw new Error("The source execution gate returned an invalid decision");
    }
    return enabled;
  }

  async run(sourceId: string, attempt: number, signal: AbortSignal): Promise<IngestionRunResult> {
    const registration = this.registry.requireEnabled(sourceId);
    const identity = Object.freeze({
      sourceId: registration.sourceId,
      adapterVersion: registration.adapter.adapterVersion,
    });
    if (signal.aborted || !(await this.#executionEnabled(identity))) {
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
    if (signal.aborted || !(await this.#executionEnabled(identity))) {
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
      if (signal.aborted || !(await this.#executionEnabled(identity))) {
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
      if (signal.aborted || !(await this.#executionEnabled(identity))) {
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
