import type { JobContribution, OwnerTrustCase } from "@ai-job-apply/api-contracts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTRIBUTION_STATES = new Set(["queued", "normalized", "awaiting_independent_verification", "independently_verified", "awaiting_trust", "rejected", "ready_for_publication", "published", "consent_invalid", "withdrawn", "taken_down", "removed"]);
const TRUST_STATES = new Set(["needs_review", "accepted", "rejected", "appeal_pending", "withdrawn", "taken_down"]);
export const MAXIMUM_APPEAL_EVIDENCE_CHARACTERS = 2_000;

export type OwnerActionResult<T> = { outcome: "ok"; value: T } | { outcome: "not_found" | "unavailable" | "version_conflict" | "rejected" };

function exactNoStoreJson(response: Response): boolean {
  return response.headers.get("cache-control")?.toLowerCase() === "no-store" && response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function exactContribution(value: unknown, id: string): value is JobContribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).sort().join("\0") === ["id", "state", "submittedAt", "updatedAt"].sort().join("\0") && r.id === id && CONTRIBUTION_STATES.has(String(r.state)) && timestamp(r.submittedAt) && timestamp(r.updatedAt);
}
function exactTrust(value: unknown, id: string): value is OwnerTrustCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const keys = ["id", "contributionId", "state", "policyVersion", "version", "appealed", "createdAt", "updatedAt", ...(r.appealDeadlineAt === undefined ? [] : ["appealDeadlineAt"])].sort().join("\0");
  return Object.keys(r).sort().join("\0") === keys && typeof r.id === "string" && UUID.test(r.id) && r.contributionId === id && TRUST_STATES.has(String(r.state)) && typeof r.policyVersion === "string" && typeof r.version === "number" && Number.isSafeInteger(r.version) && r.version >= 1 && typeof r.appealed === "boolean" && timestamp(r.createdAt) && timestamp(r.updatedAt) && (r.appealDeadlineAt === undefined || r.appealDeadlineAt === null || timestamp(r.appealDeadlineAt));
}
function headers(token: string, body = false): HeadersInit { return { accept: "application/json", authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }; }
async function request<T>(url: URL, init: RequestInit, parser: (value: unknown) => value is T, fetcher: typeof fetch): Promise<OwnerActionResult<T>> {
  let response: Response;
  try { response = await fetcher(url, init); } catch { return { outcome: "unavailable" }; }
  if (response.status === 404) return { outcome: "not_found" };
  if (response.status === 409) return { outcome: "version_conflict" };
  if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) return { outcome: "unavailable" };
  if (response.status !== 200 || !exactNoStoreJson(response)) return { outcome: "rejected" };
  try { const value: unknown = await response.json(); return parser(value) ? { outcome: "ok", value } : { outcome: "rejected" }; } catch { return { outcome: "rejected" }; }
}

export function getContributionStatus(id: string, token: string, origin: string, fetcher: typeof fetch = fetch) {
  return request(new URL(`/v1/jobs/contributions/${encodeURIComponent(id)}`, origin), { headers: headers(token), method: "GET" }, (value): value is JobContribution => exactContribution(value, id), fetcher);
}
export function getOwnerTrustStatus(id: string, token: string, origin: string, fetcher: typeof fetch = fetch) {
  return request(new URL(`/v1/trust/contributions/${encodeURIComponent(id)}`, origin), { headers: headers(token), method: "GET" }, (value): value is OwnerTrustCase => exactTrust(value, id), fetcher);
}
export function withdrawContribution(id: string, expectedVersion: number, token: string, origin: string, fetcher: typeof fetch = fetch) {
  return request(new URL(`/v1/trust/contributions/${encodeURIComponent(id)}/withdraw`, origin), { body: JSON.stringify({ expectedVersion }), headers: headers(token, true), method: "POST" }, (value): value is OwnerTrustCase => exactTrust(value, id), fetcher);
}
export async function appealEvidenceDigest(evidenceText: string): Promise<string> {
  const normalized = evidenceText.trim();
  if (!normalized || normalized.length > MAXIMUM_APPEAL_EVIDENCE_CHARACTERS) throw new TypeError("Appeal evidence is invalid");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function fileContributionAppeal(id: string, expectedVersion: number, evidenceDigestSha256: string, token: string, origin: string, fetcher: typeof fetch = fetch) {
  if (!SHA256.test(evidenceDigestSha256)) throw new TypeError("Appeal evidence digest is invalid");
  return request(new URL(`/v1/trust/contributions/${encodeURIComponent(id)}/appeals`, origin), { body: JSON.stringify({ expectedVersion, evidenceDigestSha256 }), headers: headers(token, true), method: "POST" }, (value): value is OwnerTrustCase => exactTrust(value, id), fetcher);
}
