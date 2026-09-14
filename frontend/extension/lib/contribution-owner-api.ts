import type {
  JobContribution,
  JobContributionHistory,
  OwnerTrustCase,
} from "@ai-job-apply/api-contracts";
import { MAXIMUM_CONTRIBUTION_RECEIPTS } from "./contribution-receipts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTRIBUTION_STATES = new Set([
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
]);
const TRUST_STATES = new Set([
  "needs_review",
  "accepted",
  "rejected",
  "appeal_pending",
  "withdrawn",
  "taken_down",
]);
export const MAXIMUM_APPEAL_EVIDENCE_CHARACTERS = 2_000;

export type OwnerActionResult<T> =
  | { outcome: "ok"; value: T }
  | { outcome: "not_found" | "unavailable" | "version_conflict" | "rejected" };

function exactNoStoreJson(response: Response): boolean {
  return (
    response.headers.get("cache-control")?.toLowerCase() === "no-store" &&
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
      "application/json"
  );
}
function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function exactContribution(value: unknown, id: string): value is JobContribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).sort().join("\0") ===
      ["id", "state", "submittedAt", "updatedAt"].sort().join("\0") &&
    r.id === id &&
    typeof r.state === "string" &&
    CONTRIBUTION_STATES.has(r.state) &&
    timestamp(r.submittedAt) &&
    timestamp(r.updatedAt)
  );
}
function exactTrust(value: unknown, id: string): value is OwnerTrustCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const keys = [
    "id",
    "contributionId",
    "state",
    "policyVersion",
    "version",
    "appealed",
    "createdAt",
    "updatedAt",
    ...(r.appealDeadlineAt === undefined ? [] : ["appealDeadlineAt"]),
  ]
    .sort()
    .join("\0");
  return (
    Object.keys(r).sort().join("\0") === keys &&
    typeof r.id === "string" &&
    UUID.test(r.id) &&
    r.contributionId === id &&
    typeof r.state === "string" &&
    TRUST_STATES.has(r.state) &&
    typeof r.policyVersion === "string" &&
    typeof r.version === "number" &&
    Number.isSafeInteger(r.version) &&
    r.version >= 1 &&
    typeof r.appealed === "boolean" &&
    timestamp(r.createdAt) &&
    timestamp(r.updatedAt) &&
    (r.appealDeadlineAt === undefined ||
      r.appealDeadlineAt === null ||
      timestamp(r.appealDeadlineAt))
  );
}
function headers(token: string, body = false): HeadersInit {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...(body ? { "content-type": "application/json" } : {}),
  };
}
export const OWNER_ACTION_TIMEOUT_MILLISECONDS = 10_000;
const MAXIMUM_OWNER_RESPONSE_BYTES = 16_384;
async function request<T>(
  url: URL,
  init: RequestInit,
  parser: (value: unknown) => value is T,
  fetcher: typeof fetch,
): Promise<OwnerActionResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<OwnerActionResult<T>> => {
      const response = await fetcher(url, {
        ...init,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 404) return { outcome: "not_found" };
      if (response.status === 409) return { outcome: "version_conflict" };
      if ([408, 425, 429].includes(response.status) || response.status >= 500)
        return { outcome: "unavailable" };
      if (response.status !== 200 || !exactNoStoreJson(response) || !response.body)
        return { outcome: "rejected" };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > MAXIMUM_OWNER_RESPONSE_BYTES) {
            void reader.cancel().catch(() => undefined);
            return { outcome: "rejected" };
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return parser(value) ? { outcome: "ok", value } : { outcome: "rejected" };
    };
    return await Promise.race([
      work(),
      new Promise<OwnerActionResult<T>>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ outcome: "unavailable" });
        }, OWNER_ACTION_TIMEOUT_MILLISECONDS);
      }),
    ]);
  } catch {
    return { outcome: "unavailable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function cancelContribution(
  id: string,
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  if (!UUID.test(id)) return Promise.resolve({ outcome: "rejected" as const });
  return request(
    new URL(`/v1/jobs/contributions/${id}/cancel`, origin),
    {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1 }),
      headers: { ...headers(token, true), "idempotency-key": `cancel-${id}` },
    },
    (value): value is JobContribution =>
      exactContribution(value, id) && value.state === "consent_invalid",
    fetcher,
  );
}

export function getContributionStatus(
  id: string,
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  return request(
    new URL(`/v1/jobs/contributions/${encodeURIComponent(id)}`, origin),
    { headers: headers(token), method: "GET" },
    (value): value is JobContribution => exactContribution(value, id),
    fetcher,
  );
}

export function getContributionHistory(
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  return request(
    new URL("/v1/jobs/contributions", origin),
    { headers: headers(token), method: "GET" },
    (value): value is JobContributionHistory => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const page = value as Record<string, unknown>;
      if (
        Object.keys(page).join("\0") !== "items" ||
        !Array.isArray(page.items) ||
        page.items.length > MAXIMUM_CONTRIBUTION_RECEIPTS
      )
        return false;
      const ids = new Set<string>();
      let previous: JobContribution | undefined;
      for (const item of page.items) {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(item.id) ||
          !exactContribution(item, item.id) ||
          ids.has(item.id) ||
          item.updatedAt < item.submittedAt ||
          (previous &&
            (item.submittedAt > previous.submittedAt ||
              (item.submittedAt === previous.submittedAt && item.id >= previous.id)))
        )
          return false;
        ids.add(item.id);
        previous = item;
      }
      return true;
    },
    fetcher,
  );
}
export function getOwnerTrustStatus(
  id: string,
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  return request(
    new URL(`/v1/trust/contributions/${encodeURIComponent(id)}`, origin),
    { headers: headers(token), method: "GET" },
    (value): value is OwnerTrustCase => exactTrust(value, id),
    fetcher,
  );
}
export function withdrawContribution(
  id: string,
  expectedVersion: number,
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  return request(
    new URL(`/v1/trust/contributions/${encodeURIComponent(id)}/withdraw`, origin),
    { body: JSON.stringify({ expectedVersion }), headers: headers(token, true), method: "POST" },
    (value): value is OwnerTrustCase => exactTrust(value, id),
    fetcher,
  );
}
export async function appealEvidenceDigest(evidenceText: string): Promise<string> {
  const normalized = evidenceText.trim();
  if (!normalized || normalized.length > MAXIMUM_APPEAL_EVIDENCE_CHARACTERS)
    throw new TypeError("Appeal evidence is invalid");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function fileContributionAppeal(
  id: string,
  expectedVersion: number,
  evidenceDigestSha256: string,
  token: string,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  if (!SHA256.test(evidenceDigestSha256)) throw new TypeError("Appeal evidence digest is invalid");
  return request(
    new URL(`/v1/trust/contributions/${encodeURIComponent(id)}/appeals`, origin),
    {
      body: JSON.stringify({ expectedVersion, evidenceDigestSha256 }),
      headers: headers(token, true),
      method: "POST",
    },
    (value): value is OwnerTrustCase => exactTrust(value, id),
    fetcher,
  );
}
