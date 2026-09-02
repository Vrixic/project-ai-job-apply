import { createHash } from "node:crypto";

export const contributionProviders = ["greenhouse", "lever", "ashby"] as const;
export type ContributionProvider = (typeof contributionProviders)[number];
export const contributionPageVariants = [
  "greenhouse-board-v1",
  "lever-posting-v1",
  "ashby-job-board-v1",
] as const;
export type ContributionPageVariant = (typeof contributionPageVariants)[number];

export const contributionFieldNames = [
  "provider",
  "pageVariant",
  "sourceUrl",
  "externalJobId",
  "companyName",
  "title",
  "locations",
  "description",
  "department",
  "applicationUrl",
  "employmentType",
  "workMode",
] as const;
export type ContributionFieldName = (typeof contributionFieldNames)[number];

export interface JobContributionInput {
  schemaVersion: 1;
  contributionId: string;
  source: {
    provider: ContributionProvider;
    pageVariant: ContributionPageVariant;
    sourceUrl: string;
    externalJobId?: string;
    adapterVersion: string;
  };
  posting: {
    companyName?: string;
    title: string;
    locations?: string[];
    description?: string;
    department?: string;
    applicationUrl?: string;
    employmentType?: "full_time" | "part_time" | "contract" | "internship" | "unknown";
    workMode?: "remote" | "hybrid" | "on_site" | "unknown";
  };
  observation: { observedAt: string; contentSha256: string };
  approval: {
    consentId: string;
    consentVersion: "ugc-contribution-preview.v1";
    policyVersion: string;
    approvedAt: string;
    approvedFields: ContributionFieldName[];
    previewDigestSha256: string;
  };
}

export interface CreateJobContributionCommand {
  ownerUserId: string;
  idempotencyKey: string;
  input: JobContributionInput;
}

export interface JobContributionStatus {
  id: string;
  state: "queued";
  submittedAt: string;
  updatedAt: string;
}

export interface JobContributionStore {
  ping(): Promise<void>;
  create(command: CreateJobContributionCommand): Promise<JobContributionStatus>;
  get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null>;
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
  }): Promise<boolean>;
}

export interface JobContributions {
  ping(): Promise<void>;
  contribute(command: CreateJobContributionCommand): Promise<JobContributionStatus>;
  get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null>;
}

export class JobContributionIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different contribution");
    this.name = "JobContributionIdempotencyConflictError";
  }
}

export class JobContributionUnavailableError extends Error {
  constructor() {
    super("Job contribution intake is temporarily unavailable");
    this.name = "JobContributionUnavailableError";
  }
}

export class JobContributionConsentRequiredError extends Error {
  constructor() {
    super("A current contribution consent binding is required");
    this.name = "JobContributionConsentRequiredError";
  }
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ADAPTER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/;

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
  /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function boundedText(value: string | undefined, maximum: number, required = false): boolean {
  if (value === undefined) return !required;
  return (
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximum &&
    !UNSAFE_TEXT.test(value)
  );
}

function canonicalSource(input: JobContributionInput): Record<string, unknown> {
  return {
    provider: input.source.provider,
    pageVariant: input.source.pageVariant,
    sourceUrl: input.source.sourceUrl,
    ...(input.source.externalJobId === undefined
      ? {}
      : { externalJobId: input.source.externalJobId }),
    adapterVersion: input.source.adapterVersion,
  };
}

function canonicalSelectedPublicSource(input: JobContributionInput): Record<string, unknown> {
  return {
    provider: input.source.provider,
    pageVariant: input.source.pageVariant,
    sourceUrl: input.source.sourceUrl,
    ...(input.source.externalJobId === undefined
      ? {}
      : { externalJobId: input.source.externalJobId }),
  };
}

function canonicalPosting(input: JobContributionInput): Record<string, unknown> {
  return {
    ...(input.posting.companyName === undefined ? {} : { companyName: input.posting.companyName }),
    title: input.posting.title,
    ...(input.posting.locations === undefined ? {} : { locations: input.posting.locations }),
    ...(input.posting.description === undefined ? {} : { description: input.posting.description }),
    ...(input.posting.department === undefined ? {} : { department: input.posting.department }),
    ...(input.posting.applicationUrl === undefined
      ? {}
      : { applicationUrl: input.posting.applicationUrl }),
    ...(input.posting.employmentType === undefined
      ? {}
      : { employmentType: input.posting.employmentType }),
    ...(input.posting.workMode === undefined ? {} : { workMode: input.posting.workMode }),
  };
}

function expectedApprovedFields(input: JobContributionInput): ContributionFieldName[] {
  return contributionFieldNames.filter((field) => {
    if (
      field === "provider" ||
      field === "pageVariant" ||
      field === "sourceUrl" ||
      field === "title"
    ) {
      return true;
    }
    return field === "externalJobId"
      ? input.source.externalJobId !== undefined
      : input.posting[field] !== undefined;
  });
}

export function jobContributionPreviewDigestInput(input: JobContributionInput): string {
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    contributionId: input.contributionId,
    source: canonicalSource(input),
    posting: canonicalPosting(input),
    observation: {
      observedAt: input.observation.observedAt,
      contentSha256: input.observation.contentSha256,
    },
    approval: {
      consentVersion: input.approval.consentVersion,
      policyVersion: input.approval.policyVersion,
      approvedFields: input.approval.approvedFields,
    },
  });
}

export function jobContributionContentDigestInput(input: JobContributionInput): string {
  return JSON.stringify({
    source: canonicalSelectedPublicSource(input),
    posting: canonicalPosting(input),
  });
}

function assertInput(input: JobContributionInput): void {
  if (
    input.schemaVersion !== 1 ||
    !UUID_V7_PATTERN.test(input.contributionId) ||
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
    !boundedText(input.posting.description, 50_000) ||
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
  const expected = expectedApprovedFields(input);
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
  ) {}

  ping(): Promise<void> {
    return this.store.ping();
  }

  async contribute(command: CreateJobContributionCommand): Promise<JobContributionStatus> {
    assertCommand(command);
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
      });
    } catch {
      throw new JobContributionUnavailableError();
    }
    if (!consentValid) throw new JobContributionConsentRequiredError();
    try {
      return Object.freeze({ ...(await this.store.create(command)) });
    } catch (error) {
      if (error instanceof JobContributionIdempotencyConflictError) throw error;
      throw new JobContributionUnavailableError();
    }
  }

  async get(ownerUserId: string, contributionId: string): Promise<JobContributionStatus | null> {
    if (!UUID_V7_PATTERN.test(ownerUserId) || !UUID_V7_PATTERN.test(contributionId)) {
      throw new TypeError("The contribution status identity is invalid");
    }
    try {
      const result = await this.store.get(ownerUserId, contributionId);
      return result ? Object.freeze({ ...result }) : null;
    } catch {
      throw new JobContributionUnavailableError();
    }
  }
}
