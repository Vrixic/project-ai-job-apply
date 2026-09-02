import type {
  CreatePrivateSavedPageCaptureRequest,
  CreateJobContributionRequest,
  GrantUgcContributionConsentRequest,
  JobContribution,
  PrivateSavedPageCapture,
  UgcContributionConsentGrant,
} from "@ai-job-apply/api-contracts";
import {
  expectedJobContributionApprovedFields,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
  UGC_CONTRIBUTION_DOCUMENT_VERSION,
} from "@ai-job-apply/api-contracts/job-contribution-canonical";
import { extensionConfiguration } from "./config";
import { type SanitizedJobCapture, selectContributionFields } from "./job-capture";
import {
  classifyResponse,
  type DispatchResult,
  type PendingJobIntent,
  type UgcConsentBinding,
} from "./pending-queue";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function exactNoStoreJson(response: Response): boolean {
  return (
    response.headers.get("cache-control")?.toLowerCase() === "no-store" &&
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
      "application/json"
  );
}

function exactConsentGrant(
  value: unknown,
  policyVersion: string,
): value is UgcContributionConsentGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join("\0") ===
      ["documentVersion", "grantedAt", "id", "policyVersion", "schemaVersion", "state"]
        .sort()
        .join("\0") &&
    record.schemaVersion === 1 &&
    typeof record.id === "string" &&
    UUID_V7.test(record.id) &&
    record.state === "granted" &&
    record.documentVersion === UGC_CONTRIBUTION_DOCUMENT_VERSION &&
    record.policyVersion === policyVersion &&
    typeof record.grantedAt === "string" &&
    ISO_TIMESTAMP.test(record.grantedAt) &&
    new Date(record.grantedAt).toISOString() === record.grantedAt
  );
}

function exactContribution(value: unknown, contributionId: string): value is JobContribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join("\0") ===
      ["id", "state", "submittedAt", "updatedAt"].sort().join("\0") &&
    record.id === contributionId &&
    record.state === "queued" &&
    typeof record.submittedAt === "string" &&
    ISO_TIMESTAMP.test(record.submittedAt) &&
    typeof record.updatedAt === "string" &&
    ISO_TIMESTAMP.test(record.updatedAt)
  );
}

function exactFlatObject(value: unknown, expected: object): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  const wanted = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actual).sort();
  const wantedKeys = Object.keys(wanted).sort();
  return (
    actualKeys.join("\0") === wantedKeys.join("\0") &&
    wantedKeys.every((key) => actual[key] === wanted[key])
  );
}

export function preparePrivateSavedPageCapture(
  intent: PendingJobIntent,
): CreatePrivateSavedPageCaptureRequest {
  const capture = intent.capture;
  return {
    schemaVersion: 1,
    captureId: intent.id,
    source: {
      provider: capture.provider,
      pageVariant: capture.pageVariant,
      sourceUrl: capture.sourceUrl,
      adapterVersion: capture.adapterVersion,
    },
    snapshot: {
      title: capture.title,
      ...(capture.company ? { company: capture.company } : {}),
      ...(capture.location ? { location: capture.location } : {}),
      ...(capture.description ? { description: capture.description } : {}),
      ...(capture.externalJobId ? { externalJobId: capture.externalJobId } : {}),
    },
    capturedAt: capture.capturedAt,
  };
}

function exactPrivateSavedPageCapture(
  value: unknown,
  expected: CreatePrivateSavedPageCaptureRequest,
): value is PrivateSavedPageCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join("\0");
  const exactKeys = [
    "schemaVersion",
    "id",
    "source",
    "snapshot",
    "capturedAt",
    "savedAt",
    ...(record.resolution === undefined ? [] : ["resolution"]),
  ]
    .sort()
    .join("\0");
  if (
    keys !== exactKeys ||
    record.schemaVersion !== 1 ||
    record.id !== expected.captureId ||
    record.capturedAt !== expected.capturedAt ||
    typeof record.savedAt !== "string" ||
    !ISO_TIMESTAMP.test(record.savedAt) ||
    new Date(record.savedAt).toISOString() !== record.savedAt ||
    !exactFlatObject(record.source, expected.source) ||
    !exactFlatObject(record.snapshot, expected.snapshot)
  ) {
    return false;
  }
  if (record.resolution !== undefined) {
    if (
      !record.resolution ||
      typeof record.resolution !== "object" ||
      Array.isArray(record.resolution)
    ) {
      return false;
    }
    const resolution = record.resolution as Record<string, unknown>;
    if (
      Object.keys(resolution).sort().join("\0") !== ["canonicalJobId", "resolvedAt"].join("\0") ||
      typeof resolution.canonicalJobId !== "string" ||
      !UUID.test(resolution.canonicalJobId) ||
      typeof resolution.resolvedAt !== "string" ||
      !ISO_TIMESTAMP.test(resolution.resolvedAt) ||
      new Date(resolution.resolvedAt).toISOString() !== resolution.resolvedAt
    ) {
      return false;
    }
  }
  return true;
}

function mappedContributionSkeleton(
  intent: PendingJobIntent,
  capture: SanitizedJobCapture,
  policyVersion: string,
): CreateJobContributionRequest {
  const skeleton: CreateJobContributionRequest = {
    schemaVersion: 1,
    contributionId: intent.id,
    source: {
      provider: capture.provider,
      pageVariant: capture.pageVariant,
      sourceUrl: capture.sourceUrl,
      ...(capture.externalJobId ? { externalJobId: capture.externalJobId } : {}),
      adapterVersion: capture.adapterVersion,
    },
    posting: {
      ...(capture.company ? { companyName: capture.company } : {}),
      title: capture.title,
      ...(capture.location ? { locations: [capture.location] } : {}),
      ...(capture.description ? { description: capture.description } : {}),
    },
    observation: { observedAt: capture.capturedAt, contentSha256: "0".repeat(64) },
    approval: {
      consentId: intent.id,
      consentVersion: UGC_CONTRIBUTION_DOCUMENT_VERSION,
      policyVersion,
      approvedAt: capture.capturedAt,
      approvedFields: [],
      previewDigestSha256: "0".repeat(64),
    },
  };
  skeleton.approval.approvedFields = expectedJobContributionApprovedFields(skeleton);
  return skeleton;
}

export async function prepareContribution(
  intent: PendingJobIntent,
  policyVersion = extensionConfiguration.ugcContributionPolicyVersion,
): Promise<{ body: CreateJobContributionRequest; previewDigestSha256: string }> {
  if (!policyVersion) throw new TypeError("UGC contribution policy is not configured");
  const capture = selectContributionFields(intent.capture, intent.approvedFields);
  const body = mappedContributionSkeleton(intent, capture, policyVersion);
  body.observation.contentSha256 = await sha256Hex(jobContributionContentDigestInput(body));
  const previewDigestSha256 = await sha256Hex(jobContributionPreviewDigestInput(body));
  body.approval.previewDigestSha256 = previewDigestSha256;
  return { body, previewDigestSha256 };
}

export function createConsentGrantRequest(
  intent: PendingJobIntent,
  previewDigestSha256: string,
  accessToken: string,
  apiOrigin: string,
  policyVersion = extensionConfiguration.ugcContributionPolicyVersion,
): { init: RequestInit; url: URL } {
  if (!policyVersion) throw new TypeError("UGC contribution policy is not configured");
  const body: GrantUgcContributionConsentRequest = {
    schemaVersion: 1,
    documentVersion: UGC_CONTRIBUTION_DOCUMENT_VERSION,
    policyVersion,
    previewDigestSha256,
  };
  return {
    init: {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": intent.consentIdempotencyKey,
      },
      method: "POST",
    },
    url: new URL("/v1/profile/ugc-contribution-consents", apiOrigin),
  };
}

export function createContributionRequest(
  intent: PendingJobIntent,
  body: CreateJobContributionRequest,
  consent: UgcConsentBinding,
  accessToken: string,
  apiOrigin: string,
): { init: RequestInit; url: URL } {
  body.approval.consentId = consent.id;
  body.approval.approvedAt = consent.grantedAt;
  return {
    init: {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": intent.idempotencyKey,
      },
      method: "POST",
    },
    url: new URL("/v1/jobs/contributions", apiOrigin),
  };
}

async function sendContribution(
  intent: PendingJobIntent,
  accessToken: string,
  apiOrigin: string,
  fetchImplementation: typeof fetch,
): Promise<DispatchResult> {
  const policyVersion = extensionConfiguration.ugcContributionPolicyVersion;
  if (!policyVersion) return { outcome: "terminal" };
  const prepared = await prepareContribution(intent, policyVersion);
  let consent = intent.consent;
  if (consent && consent.previewDigestSha256 !== prepared.previewDigestSha256) {
    return { outcome: "terminal" };
  }
  if (!consent) {
    const grantRequest = createConsentGrantRequest(
      intent,
      prepared.previewDigestSha256,
      accessToken,
      apiOrigin,
      policyVersion,
    );
    const response = await fetchImplementation(grantRequest.url, grantRequest.init);
    const classified = classifyResponse(response.status);
    if (classified.outcome !== "accepted") return classified;
    if (response.status !== 201 || !exactNoStoreJson(response)) return { outcome: "terminal" };
    const payload: unknown = await response.json();
    if (!exactConsentGrant(payload, policyVersion)) return { outcome: "terminal" };
    consent = {
      grantedAt: payload.grantedAt,
      id: payload.id,
      previewDigestSha256: prepared.previewDigestSha256,
    };
  }
  const contributionRequest = createContributionRequest(
    intent,
    prepared.body,
    consent,
    accessToken,
    apiOrigin,
  );
  let response: Response;
  try {
    response = await fetchImplementation(contributionRequest.url, contributionRequest.init);
  } catch {
    return { consent, outcome: "retryable" };
  }
  const classified = classifyResponse(response.status);
  if (classified.outcome !== "accepted") return { ...classified, consent };
  if (response.status !== 202 || !exactNoStoreJson(response)) {
    return { consent, outcome: "terminal" };
  }
  const payload: unknown = await response.json();
  return exactContribution(payload, intent.id)
    ? { outcome: "accepted" }
    : { consent, outcome: "terminal" };
}

export async function sendJobIntent(
  intent: PendingJobIntent,
  accessToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<DispatchResult> {
  if (!extensionConfiguration.apiOrigin) return { outcome: "terminal" };
  if (intent.intent === "contribute") {
    try {
      return await sendContribution(
        intent,
        accessToken,
        extensionConfiguration.apiOrigin,
        fetchImplementation,
      );
    } catch {
      return { ...(intent.consent ? { consent: intent.consent } : {}), outcome: "retryable" };
    }
  }
  try {
    const capture = preparePrivateSavedPageCapture(intent);
    const response = await fetchImplementation(
      new URL("/v1/saved-job-captures", extensionConfiguration.apiOrigin),
      {
        body: JSON.stringify(capture),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "idempotency-key": intent.idempotencyKey,
        },
        method: "POST",
      },
    );
    const classified = classifyResponse(response.status);
    if (classified.outcome !== "accepted") return classified;
    if (response.status !== 201 || !exactNoStoreJson(response)) return { outcome: "terminal" };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { outcome: "terminal" };
    }
    return exactPrivateSavedPageCapture(payload, capture)
      ? { outcome: "accepted" }
      : { outcome: "terminal" };
  } catch {
    return { outcome: "retryable" };
  }
}
