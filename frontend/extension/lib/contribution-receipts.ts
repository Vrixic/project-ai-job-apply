import type { JobContribution, OwnerTrustCase } from "@ai-job-apply/api-contracts";

export const CONTRIBUTION_RECEIPTS_KEY = "d2ContributionReceiptsV1";
export const MAXIMUM_CONTRIBUTION_RECEIPTS = 25;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_FENCE = /^[A-Za-z0-9_-]{43}$/u;
const CONTRIBUTION_STATES = new Set(["queued", "normalized", "awaiting_independent_verification", "independently_verified", "awaiting_trust", "rejected", "ready_for_publication", "published", "consent_invalid", "withdrawn", "taken_down", "removed"]);
const TRUST_STATES = new Set(["needs_review", "accepted", "rejected", "appeal_pending", "withdrawn", "taken_down"]);

export interface ContributionReceipt {
  contributionId: string;
  identityFence: string;
  state: JobContribution["state"];
  submittedAt: string;
  updatedAt: string;
  trust?: Pick<OwnerTrustCase, "appealDeadlineAt" | "appealed" | "state" | "updatedAt" | "version">;
}

function exactInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function parseReceipt(value: unknown): ContributionReceipt | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const receipt = value as Record<string, unknown>;
  const expectedKeys = ["contributionId", "identityFence", "state", "submittedAt", "updatedAt", ...(receipt.trust === undefined ? [] : ["trust"])];
  if (
    Object.keys(receipt).sort().join("\0") !== expectedKeys.sort().join("\0") ||
    typeof receipt.contributionId !== "string" || !UUID_V7.test(receipt.contributionId) ||
    typeof receipt.identityFence !== "string" || !IDENTITY_FENCE.test(receipt.identityFence) ||
    !CONTRIBUTION_STATES.has(String(receipt.state)) ||
    !exactInstant(receipt.submittedAt) || !exactInstant(receipt.updatedAt)
  ) return undefined;
  let trust: ContributionReceipt["trust"];
  if (receipt.trust !== undefined) {
    if (!receipt.trust || typeof receipt.trust !== "object" || Array.isArray(receipt.trust)) return undefined;
    const candidate = receipt.trust as Record<string, unknown>;
    const trustKeys = ["appealed", "state", "updatedAt", "version", ...(candidate.appealDeadlineAt === undefined ? [] : ["appealDeadlineAt"])];
    if (
      Object.keys(candidate).sort().join("\0") !== trustKeys.sort().join("\0") ||
      typeof candidate.appealed !== "boolean" ||
      !TRUST_STATES.has(String(candidate.state)) ||
      !Number.isSafeInteger(candidate.version) || Number(candidate.version) < 1 ||
      !exactInstant(candidate.updatedAt) ||
      (candidate.appealDeadlineAt !== undefined && candidate.appealDeadlineAt !== null && !exactInstant(candidate.appealDeadlineAt))
    ) return undefined;
    trust = candidate as ContributionReceipt["trust"];
  }
  return {
    contributionId: receipt.contributionId,
    identityFence: receipt.identityFence,
    state: receipt.state as JobContribution["state"],
    submittedAt: receipt.submittedAt,
    updatedAt: receipt.updatedAt,
    ...(trust ? { trust } : {}),
  };
}

export function parseContributionReceipts(value: unknown): ContributionReceipt[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_CONTRIBUTION_RECEIPTS) return [];
  const parsed = value.map(parseReceipt);
  return parsed.every((receipt): receipt is ContributionReceipt => Boolean(receipt)) ? parsed : [];
}

export function receiptFromContribution(contribution: JobContribution, identityFence: string): ContributionReceipt {
  return { contributionId: contribution.id, identityFence, state: contribution.state, submittedAt: contribution.submittedAt, updatedAt: contribution.updatedAt };
}

export function upsertContributionReceipt(receipts: readonly ContributionReceipt[], receipt: ContributionReceipt): ContributionReceipt[] {
  return [receipt, ...receipts.filter((item) => item.contributionId !== receipt.contributionId || item.identityFence !== receipt.identityFence)].slice(0, MAXIMUM_CONTRIBUTION_RECEIPTS);
}

export function receiptsForIdentity(receipts: readonly ContributionReceipt[], identityFence: string): ContributionReceipt[] {
  return receipts.filter((receipt) => receipt.identityFence === identityFence);
}

export function updateContributionStatus(receipt: ContributionReceipt, contribution: JobContribution): ContributionReceipt {
  if (receipt.contributionId !== contribution.id) throw new TypeError("Contribution identity mismatch");
  return { ...receipt, state: contribution.state, updatedAt: contribution.updatedAt };
}

export function updateTrustStatus(receipt: ContributionReceipt, trust: OwnerTrustCase): ContributionReceipt {
  if (receipt.contributionId !== trust.contributionId) throw new TypeError("Contribution identity mismatch");
  return { ...receipt, trust: { appealed: trust.appealed, state: trust.state, updatedAt: trust.updatedAt, version: trust.version, ...(trust.appealDeadlineAt === undefined ? {} : { appealDeadlineAt: trust.appealDeadlineAt }) } };
}
