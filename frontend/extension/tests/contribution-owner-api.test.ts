import { describe, expect, it, vi } from "vitest";
import { appealEvidenceDigest, fileContributionAppeal, getContributionStatus, withdrawContribution } from "../lib/contribution-owner-api";

const id = "018f0000-0000-7000-8000-000000000004";
const trust = { id: "018f0000-0000-8000-8000-000000000005", contributionId: id, state: "appeal_pending", policyVersion: "policy.v1", version: 3, appealed: true, createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:01:00.000Z" };
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "cache-control": "no-store", "content-type": "application/json" } });

describe("owner contribution transport", () => {
  it("keeps an offline status refresh retryable without synthetic state", async () => {
    await expect(getContributionStatus(id, "token", "https://api.test", vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch)).resolves.toEqual({ outcome: "unavailable" });
  });
  it.each(["queued", "normalized", "awaiting_independent_verification", "independently_verified", "awaiting_trust", "rejected", "ready_for_publication", "published", "consent_invalid", "withdrawn", "taken_down", "removed"])("accepts the exact owner processing state %s", async (state) => {
    const body = { id, state, submittedAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:01:00.000Z" };
    await expect(getContributionStatus(id, "token", "https://api.test", vi.fn(async () => response(200, body)) as typeof fetch)).resolves.toEqual({ outcome: "ok", value: body });
  });
  it("surfaces withdrawal version conflict", async () => {
    await expect(withdrawContribution(id, 2, "token", "https://api.test", vi.fn(async () => response(409, {})) as typeof fetch)).resolves.toEqual({ outcome: "version_conflict" });
  });
  it("hashes bounded appeal evidence locally and sends no raw evidence", async () => {
    const evidenceDigestSha256 = await appealEvidenceDigest("candidate evidence");
    expect(evidenceDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const serialized = String(init?.body);
      expect(serialized).not.toContain("candidate evidence");
      expect(JSON.parse(serialized)).toEqual({ expectedVersion: 2, evidenceDigestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
      return response(200, trust);
    });
    await expect(fileContributionAppeal(id, 2, evidenceDigestSha256, "token", "https://api.test", fetcher as typeof fetch)).resolves.toEqual({ outcome: "ok", value: trust });
  });
});
