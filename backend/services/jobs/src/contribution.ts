import { createHash } from "node:crypto";
import type { CreateJobContributionRequest } from "@ai-job-apply/api-contracts";
import {
  expectedJobContributionApprovedFields,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "@ai-job-apply/api-contracts/job-contribution-canonical";
import {
  type D2ContributionCapabilityPolicy,
  evaluateContributionCapability,
  type SignedD2ContributionCapabilityPolicy,
  verifySignedContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";
import {
  type ContributionCapabilitySource,
  isDevelopmentContributionCapabilitySource,
} from "./contribution-capability-source.js";
import { isSafeContributionDescription } from "./contribution-description.js";

export const contributionProviders = ["greenhouse", "lever", "ashby"] as const;
export type ContributionProvider = (typeof contributionProviders)[number];
export const contributionPageVariants = [
  "greenhouse-board-v1",
  "lever-posting-v1",
  "ashby-job-board-v1",
] as const;
export type ContributionPageVariant = (typeof contributionPageVariants)[number];

export type JobContributionInput = CreateJobContributionRequest;

export interface CreateJobContributionCommand {
  ownerUserId: string;
  idempotencyKey: string;
  input: JobContributionInput;
}

export interface CancelJobContributionCommand {
  ownerUserId: string;
  contributionId: string;
  idempotencyKey: string;
  traceId: string;
}

export interface JobContributionConsentRevoker {
  revoke(
    input: Parameters<JobContributionConsentVerifier["verify"]>[0] & {
      occurredAt: string;
      traceId: string;
    },
  ): Promise<void>;
}

export class JobContributionCancellationConflictError extends Error {
  constructor() {
    super("This contribution requires the Trust withdrawal path");
    this.name = "JobContributionCancellationConflictError";
  }
}

export const jobContributionStates = [
  "queued",
  "normalized",
  "awaiting_independent_verification",
  "independently_verified",
  "awaiting_trust",
  "rejected",
  "ready_for_publication",
  "published",
  "consent_invalid",
  "withdrawn",
  "taken_down",
  "removed",
] as const;
export type JobContributionState = (typeof jobContributionStates)[number];

export interface JobContributionStatus {
  id: string;
  state: JobContributionState;
  submittedAt: string;
  updatedAt: string;
}

export interface JobContributionStore {
  ping(): Promise<void>;
  create(command: CreateJobContributionCommand): Promise<JobContributionStatus>;
  get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null>;
  cancel?(
    command: CancelJobContributionCommand,
    revoker: JobContributionConsentRevoker,
  ): Promise<JobContributionStatus | null>;
}

export interface JobContributionConsentVerifier {
  verify(input: {
    ownerUserId: string;
    consentId: string;
    purpose: "ugc_contribution";
    clientSurface: "browser_extension";
    contributionId: string;
    consentVersion: "ugc-contribution-preview.v1";
    policyVersion: string;
    previewDigestSha256: string;
    approvedAt: string;
    clientVersion: string;
  }): Promise<boolean>;
}

export interface JobContributionCapabilityPolicyLoader {
  load(): Promise<{
    envelope: SignedD2ContributionCapabilityPolicy;
    publicKeys: Readonly<Record<string, string>>;
  } | null>;
}

export interface JobContributions {
  ping(): Promise<void>;
  contribute(command: CreateJobContributionCommand): Promise<JobContributionStatus>;
  get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null>;
  cancel?(command: CancelJobContributionCommand): Promise<JobContributionStatus | null>;
}

export class JobContributionIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different contribution");
    this.name = "JobContributionIdempotencyConflictError";
  }
}

export class JobContributionUnavailableError extends Error {
  readonly code: JobContributionDiagnosticCode;

  constructor(code: JobContributionDiagnosticCode = "JOB_UNAVAILABLE", cause?: unknown) {
    super("Job contribution intake is temporarily unavailable", { cause });
    this.name = "JobContributionUnavailableError";
    this.code = code;
  }
}

export type JobContributionDiagnosticCode =
  | "JOB_CAPABILITY_LOAD"
  | "JOB_CAPABILITY_VERIFY"
  | "JOB_CONSENT_VERIFY"
  | "JOB_RESPONSE_CONTRACT"
  | "JOB_STORE_CHRONOLOGY"
  | "JOB_STORE_CLIENT"
  | "JOB_STORE_CONNECTION"
  | "JOB_STORE_CONSTRAINT"
  | "JOB_STORE_DATA"
  | "JOB_STORE_DATABASE"
  | "JOB_STORE_FOREIGN_KEY"
  | "JOB_STORE_IDENTITY_READ"
  | "JOB_STORE_INSERT"
  | "JOB_STORE_LOCK"
  | "JOB_STORE_OUTBOX"
  | "JOB_STORE_PAYLOAD"
  | "JOB_STORE_PERMISSION"
  | "JOB_STORE_QUEUE"
  | "JOB_STORE_READ"
  | "JOB_STORE_REPLAY_READ"
  | "JOB_STORE_RESOURCE"
  | "JOB_STORE_RESULT"
  | "JOB_STORE_RUNTIME"
  | "JOB_STORE_SCHEMA"
  | "JOB_STORE_SOURCE_BOUNDARY"
  | "JOB_STORE_SOURCE_URL"
  | "JOB_STORE_TRANSACTION"
  | "JOB_STORE_TRIGGER"
  | "JOB_STORE_UNIQUE"
  | "JOB_STORE_WRITE"
  | "JOB_UNAVAILABLE";

function contributionStoreDiagnostic(error: unknown): JobContributionDiagnosticCode {
  const candidate = error as {
    cause?: unknown;
    code?: unknown;
    constraint?: unknown;
    name?: unknown;
  };
  const stageCodes = new Set<JobContributionDiagnosticCode>([
    "JOB_STORE_IDENTITY_READ",
    "JOB_STORE_INSERT",
    "JOB_STORE_LOCK",
    "JOB_STORE_OUTBOX",
    "JOB_STORE_PAYLOAD",
    "JOB_STORE_QUEUE",
    "JOB_STORE_REPLAY_READ",
    "JOB_STORE_RESULT",
    "JOB_STORE_TRANSACTION",
  ]);
  if (
    candidate?.name === "JobContributionStoreStageError" &&
    typeof candidate.code === "string" &&
    stageCodes.has(candidate.code as JobContributionDiagnosticCode)
  ) {
    if (candidate.cause === error) return candidate.code as JobContributionDiagnosticCode;
    const nested = contributionStoreDiagnostic(candidate.cause);
    return nested === "JOB_STORE_RUNTIME" || nested === "JOB_STORE_WRITE"
      ? (candidate.code as JobContributionDiagnosticCode)
      : nested;
  }
  switch (candidate?.constraint) {
    case "job_contributions_chronology_ck":
      return "JOB_STORE_CHRONOLOGY";
    case "job_contributions_client_ck":
      return "JOB_STORE_CLIENT";
    case "job_contributions_provider_boundary_ck":
      return "JOB_STORE_SOURCE_BOUNDARY";
    case "job_contributions_source_url_ck":
      return "JOB_STORE_SOURCE_URL";
    case "job_contributions_payload_ck":
      return "JOB_STORE_PAYLOAD";
    case "job_contribution_outbox_data_ck":
    case "job_contribution_outbox_subject_ck":
      return "JOB_STORE_OUTBOX";
    default:
      break;
  }
  switch (candidate?.code) {
    case "23503":
      return "JOB_STORE_FOREIGN_KEY";
    case "23505":
      return "JOB_STORE_UNIQUE";
    case "23514":
      return "JOB_STORE_CONSTRAINT";
    case "42501":
      return "JOB_STORE_PERMISSION";
    case "55000":
      return "JOB_STORE_TRIGGER";
    default:
      break;
  }
  if (typeof candidate?.code === "string") {
    const sqlStateClass = candidate.code.slice(0, 2);
    if (sqlStateClass === "08") return "JOB_STORE_CONNECTION";
    if (sqlStateClass === "22") return "JOB_STORE_DATA";
    if (sqlStateClass === "23") return "JOB_STORE_CONSTRAINT";
    if (["25", "2D", "40"].includes(sqlStateClass)) return "JOB_STORE_TRANSACTION";
    if (["0A", "3D", "3F", "42"].includes(sqlStateClass)) return "JOB_STORE_SCHEMA";
    if (["53", "54", "55", "57", "58"].includes(sqlStateClass)) {
      return "JOB_STORE_RESOURCE";
    }
  }
  if (candidate?.name === "PostgresError") return "JOB_STORE_DATABASE";
  if (["TypeError", "RangeError", "ReferenceError"].includes(String(candidate?.name))) {
    return "JOB_STORE_RUNTIME";
  }
  return "JOB_STORE_WRITE";
}

export class JobContributionConsentRequiredError extends Error {
  constructor() {
    super("A current contribution consent binding is required");
    this.name = "JobContributionConsentRequiredError";
  }
}

export class JobContributionCapabilityDisabledError extends Error {
  constructor() {
    super("Job contribution intake is disabled for this client or source");
    this.name = "JobContributionCapabilityDisabledError";
  }
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ADAPTER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/;
const CLIENT_VERSION_PATTERN =
  /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,15})?$/u;

const PROVIDER_BOUNDARIES: Readonly<
  Record<
    ContributionProvider,
    { pageVariant: ContributionPageVariant; adapterVersion: string; hosts: readonly string[] }
  >
> = {
  greenhouse: {
    pageVariant: "greenhouse-board-v1",
    adapterVersion: "d2-job-page-v1",
    hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  },
  lever: {
    pageVariant: "lever-posting-v1",
    adapterVersion: "d2-job-page-v1",
    hosts: ["jobs.lever.co", "jobs.eu.lever.co"],
  },
  ashby: {
    pageVariant: "ashby-job-board-v1",
    adapterVersion: "d2-job-page-v1",
    hosts: ["jobs.ashbyhq.com"],
  },
};

function exactProviderUrl(input: JobContributionInput["source"]): boolean {
  try {
    const url = new URL(input.sourceUrl);
    const boundary = PROVIDER_BOUNDARIES[input.provider];
    const pathMatches =
      input.provider === "greenhouse"
        ? /^\/[A-Za-z0-9._~-]+\/jobs\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname)
        : /^\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+\/?$/.test(url.pathname);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.search === "" &&
      boundary.hosts.includes(url.hostname) &&
      input.pageVariant === boundary.pageVariant &&
      input.adapterVersion === boundary.adapterVersion &&
      pathMatches &&
      url.toString() === input.sourceUrl &&
      input.sourceUrl.length <= 4096
    );
  } catch {
    return false;
  }
}

function exactIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

const UNSAFE_TEXT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject browser control and bidi payloads before persistence.
  /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function boundedText(
  value: string | undefined,
  maximum: number,
  required = false,
  isSafeText = (text: string) => !UNSAFE_TEXT.test(text),
): boolean {
  if (value === undefined) return !required;
  return value === value.trim() && value.length > 0 && value.length <= maximum && isSafeText(value);
}

export { jobContributionContentDigestInput, jobContributionPreviewDigestInput };

function assertInput(input: JobContributionInput): void {
  if (
    input.schemaVersion !== 1 ||
    !UUID_V7_PATTERN.test(input.contributionId) ||
    input.client.surface !== "browser_extension" ||
    !CLIENT_VERSION_PATTERN.test(input.client.version) ||
    !contributionProviders.includes(input.source.provider) ||
    !contributionPageVariants.includes(input.source.pageVariant) ||
    !exactProviderUrl(input.source) ||
    (input.source.externalJobId !== undefined &&
      !boundedText(input.source.externalJobId, 200, true)) ||
    !ADAPTER_VERSION_PATTERN.test(input.source.adapterVersion) ||
    !SHA256_PATTERN.test(input.observation.contentSha256) ||
    createHash("sha256").update(jobContributionContentDigestInput(input)).digest("hex") !==
      input.observation.contentSha256 ||
    !boundedText(input.posting.title, 240, true) ||
    !boundedText(input.posting.companyName, 200) ||
    !boundedText(input.posting.description, 50_000, false, isSafeContributionDescription) ||
    !boundedText(input.posting.department, 200) ||
    (input.posting.locations !== undefined &&
      (input.posting.locations.length < 1 ||
        input.posting.locations.length > 20 ||
        new Set(input.posting.locations).size !== input.posting.locations.length ||
        input.posting.locations.some((location) => !boundedText(location, 240, true)))) ||
    (input.posting.applicationUrl !== undefined &&
      !exactPublicApplicationUrl(input.posting.applicationUrl)) ||
    (input.posting.employmentType !== undefined &&
      !["full_time", "part_time", "contract", "internship", "unknown"].includes(
        input.posting.employmentType,
      )) ||
    (input.posting.workMode !== undefined &&
      !["remote", "hybrid", "on_site", "unknown"].includes(input.posting.workMode)) ||
    !exactIsoTimestamp(input.observation.observedAt) ||
    !exactIsoTimestamp(input.approval.approvedAt) ||
    Date.parse(input.observation.observedAt) > Date.parse(input.approval.approvedAt) ||
    input.approval.consentVersion !== "ugc-contribution-preview.v1" ||
    !UUID_V7_PATTERN.test(input.approval.consentId) ||
    !/^[a-z0-9][a-z0-9._-]{2,99}$/.test(input.approval.policyVersion) ||
    !SHA256_PATTERN.test(input.approval.previewDigestSha256) ||
    createPreviewDigest(input) !== input.approval.previewDigestSha256
  ) {
    throw new TypeError("The job contribution source or approval is invalid");
  }
  const expected = expectedJobContributionApprovedFields(input);
  if (
    input.approval.approvedFields.length !== expected.length ||
    input.approval.approvedFields.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError("The approved contribution fields do not exactly match the payload");
  }
}

function createPreviewDigest(input: JobContributionInput): string {
  return createHash("sha256").update(jobContributionPreviewDigestInput(input)).digest("hex");
}

function exactPublicApplicationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.search === "" &&
      !/^(?:localhost|.*\.(?:local|internal))$/u.test(url.hostname) &&
      !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(url.hostname) &&
      !url.hostname.includes(":") &&
      url.toString() === value
    );
  } catch {
    return false;
  }
}

function assertCommand(command: CreateJobContributionCommand): void {
  if (!UUID_V7_PATTERN.test(command.ownerUserId)) {
    throw new TypeError("The contribution owner identifier is invalid");
  }
  if (command.idempotencyKey.length < 16 || command.idempotencyKey.length > 128) {
    throw new TypeError("The contribution idempotency key is invalid");
  }
  assertInput(command.input);
}

export class JobContributionService implements JobContributions {
  constructor(
    private readonly store: JobContributionStore,
    private readonly consentVerifier: JobContributionConsentVerifier = {
      async verify() {
        return false;
      },
    },
    private readonly capabilityPolicy: ContributionCapabilitySource = {
      async load() {
        return null;
      },
    },
    private readonly now: () => Date = () => new Date(),
    private readonly consentRevoker?: JobContributionConsentRevoker,
  ) {}

  ping(): Promise<void> {
    return this.store.ping();
  }

  async cancel(command: CancelJobContributionCommand): Promise<JobContributionStatus | null> {
    if (
      !UUID_V7_PATTERN.test(command.ownerUserId) ||
      !UUID_V7_PATTERN.test(command.contributionId) ||
      command.idempotencyKey.length < 16 ||
      command.idempotencyKey.length > 128 ||
      command.traceId.length < 1 ||
      command.traceId.length > 128 ||
      /[\r\n]/u.test(command.traceId)
    ) {
      throw new TypeError("Contribution cancellation input is invalid");
    }
    if (!this.store.cancel || !this.consentRevoker) throw new JobContributionUnavailableError();
    // Revocation is deliberately independent of intake capability/policy freshness.
    try {
      return await this.store.cancel(command, this.consentRevoker);
    } catch (error) {
      if (error instanceof JobContributionCancellationConflictError) throw error;
      throw new JobContributionUnavailableError("JOB_STORE_TRANSACTION", error);
    }
  }

  async contribute(command: CreateJobContributionCommand): Promise<JobContributionStatus> {
    assertCommand(command);
    await this.requireCapability(command.input);
    let consentValid = false;
    try {
      consentValid = await this.consentVerifier.verify({
        ownerUserId: command.ownerUserId,
        consentId: command.input.approval.consentId,
        purpose: "ugc_contribution",
        clientSurface: "browser_extension",
        contributionId: command.input.contributionId,
        consentVersion: command.input.approval.consentVersion,
        policyVersion: command.input.approval.policyVersion,
        previewDigestSha256: command.input.approval.previewDigestSha256,
        approvedAt: command.input.approval.approvedAt,
        clientVersion: command.input.client.version,
      });
    } catch (error) {
      throw new JobContributionUnavailableError("JOB_CONSENT_VERIFY", error);
    }
    if (!consentValid) throw new JobContributionConsentRequiredError();
    await this.requireCapability(command.input);
    try {
      return Object.freeze({ ...(await this.store.create(command)) });
    } catch (error) {
      if (error instanceof JobContributionIdempotencyConflictError) throw error;
      throw new JobContributionUnavailableError(contributionStoreDiagnostic(error), error);
    }
  }

  private async requireCapability(input: JobContributionInput): Promise<void> {
    if (isDevelopmentContributionCapabilitySource(this.capabilityPolicy)) {
      let allowed: boolean;
      try {
        const decision = await this.capabilityPolicy.authorize({
          stage: "intake",
          clientVersion: input.client.version,
          provider: input.source.provider,
          pageVariant: input.source.pageVariant,
          domain: new URL(input.source.sourceUrl).hostname,
          now: this.now(),
        });
        allowed = decision.allowed;
      } catch (error) {
        throw new JobContributionUnavailableError("JOB_CAPABILITY_VERIFY", error);
      }
      if (!allowed) throw new JobContributionCapabilityDisabledError();
      return;
    }
    let loaded: Awaited<ReturnType<JobContributionCapabilityPolicyLoader["load"]>>;
    try {
      loaded = await this.capabilityPolicy.load();
    } catch (error) {
      throw new JobContributionUnavailableError("JOB_CAPABILITY_LOAD", error);
    }
    if (!loaded) throw new JobContributionUnavailableError("JOB_CAPABILITY_LOAD");
    let policy: D2ContributionCapabilityPolicy;
    let domain: string;
    let now: Date;
    try {
      policy = verifySignedContributionCapabilityPolicy(loaded.envelope, loaded.publicKeys);
      domain = new URL(input.source.sourceUrl).hostname;
      now = this.now();
      if (!Number.isFinite(now.getTime())) throw new Error("invalid clock");
    } catch (error) {
      throw new JobContributionUnavailableError("JOB_CAPABILITY_VERIFY", error);
    }
    const decision = evaluateContributionCapability(policy, {
      stage: "intake",
      clientVersion: input.client.version,
      provider: input.source.provider,
      pageVariant: input.source.pageVariant,
      domain,
      now,
    });
    if (!decision.allowed) throw new JobContributionCapabilityDisabledError();
  }

  async get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null> {
    if (!UUID_V7_PATTERN.test(ownerUserId) || !UUID_V7_PATTERN.test(contributionId)) {
      throw new TypeError("The contribution status identity is invalid");
    }
    try {
      const result = await this.store.get(ownerUserId, contributionId);
      return result ? Object.freeze({ ...result }) : null;
    } catch (error) {
      throw new JobContributionUnavailableError("JOB_STORE_READ", error);
    }
  }
}
