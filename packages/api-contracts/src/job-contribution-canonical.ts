import type { CreateJobContributionRequest } from "./index.js";

export const UGC_CONTRIBUTION_DOCUMENT_VERSION = "ugc-contribution-preview.v1" as const;

export const JOB_CONTRIBUTION_FIELD_ORDER = [
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

export type JobContributionFieldName = (typeof JOB_CONTRIBUTION_FIELD_ORDER)[number];

function canonicalSource(input: CreateJobContributionRequest): Record<string, unknown> {
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

function canonicalSelectedPublicSource(
  input: CreateJobContributionRequest,
): Record<string, unknown> {
  return {
    provider: input.source.provider,
    pageVariant: input.source.pageVariant,
    sourceUrl: input.source.sourceUrl,
    ...(input.source.externalJobId === undefined
      ? {}
      : { externalJobId: input.source.externalJobId }),
  };
}

function canonicalPosting(input: CreateJobContributionRequest): Record<string, unknown> {
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

export function expectedJobContributionApprovedFields(
  input: CreateJobContributionRequest,
): JobContributionFieldName[] {
  return JOB_CONTRIBUTION_FIELD_ORDER.filter((field) => {
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

export function jobContributionContentDigestInput(input: CreateJobContributionRequest): string {
  return JSON.stringify({
    client: {
      surface: input.client.surface,
      version: input.client.version,
    },
    source: canonicalSelectedPublicSource(input),
    posting: canonicalPosting(input),
  });
}

export function jobContributionPreviewDigestInput(input: CreateJobContributionRequest): string {
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    contributionId: input.contributionId,
    client: {
      surface: input.client.surface,
      version: input.client.version,
    },
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
