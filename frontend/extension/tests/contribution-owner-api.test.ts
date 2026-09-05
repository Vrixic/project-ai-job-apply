import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appealEvidenceDigest,
  cancelContribution,
  fileContributionAppeal,
  getContributionStatus,
  OWNER_ACTION_TIMEOUT_MILLISECONDS,
  withdrawContribution,
} from "../lib/contribution-owner-api";

const id = "018f0000-0000-7000-8000-000000000004";
const trust = {
  id: "018f0000-0000-8000-8000-000000000005",
  contributionId: id,
  state: "appeal_pending",
  policyVersion: "policy.v1",
  version: 3,
  appealed: true,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:01:00.000Z",
};
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/json" },
  });

describe("owner contribution transport", () => {
  afterEach(() => vi.useRealTimers());
  it("cancels with one stable replay identity and accepts only an exact ended authorization", async () => {
    const value = {
      id,
      state: "consent_invalid",
      submittedAt: trust.createdAt,
      updatedAt: trust.updatedAt,
    };
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(_url)).toBe(`https://api.test/v1/jobs/contributions/${id}/cancel`);
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(`cancel-${id}`);
      expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 1 });
      return response(200, value);
    });
    await expect(cancelContribution(id, "token", "https://api.test", fetcher)).resolves.toEqual({
      outcome: "ok",
      value,
    });
    await expect(cancelContribution(id, "token", "https://api.test", fetcher)).resolves.toEqual({
      outcome: "ok",
      value,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(
      cancelContribution(id, "token", "https://api.test", async () =>
        response(200, { ...value, state: "published" }),
      ),
    ).resolves.toEqual({ outcome: "rejected" });
  });
  it("keeps cancellation ambiguity retryable and never reports success for a conflict or oversized receipt", async () => {
    await expect(
      cancelContribution(id, "token", "https://api.test", async () => response(409, {})),
    ).resolves.toEqual({ outcome: "version_conflict" });
    await expect(
      cancelContribution(id, "token", "https://api.test", async () =>
        response(200, { padding: "x".repeat(16_385) }),
      ),
    ).resolves.toEqual({ outcome: "rejected" });
    const fetcher = vi.fn(async () => response(200, {}));
    await expect(
      cancelContribution("not-an-id", "token", "https://api.test", fetcher),
    ).resolves.toEqual({ outcome: "rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["headers", "body"])(
    "settles a stalled %s deadline without clearing a receipt",
    async (stage) => {
      vi.useFakeTimers();
      const fetcher =
        stage === "headers"
          ? vi.fn(() => new Promise<Response>(() => undefined))
          : vi.fn(
              async () =>
                new Response(new ReadableStream({ start() {} }), {
                  headers: { "content-type": "application/json", "cache-control": "no-store" },
                }),
            );
      const request = cancelContribution(id, "token", "https://api.test", fetcher);
      await vi.advanceTimersByTimeAsync(OWNER_ACTION_TIMEOUT_MILLISECONDS);
      await expect(request).resolves.toEqual({ outcome: "unavailable" });
    },
  );
  it("keeps an offline status refresh retryable without synthetic state", async () => {
    await expect(
      getContributionStatus(
        id,
        "token",
        "https://api.test",
        vi.fn(async () => {
          throw new TypeError("offline");
        }) as typeof fetch,
      ),
    ).resolves.toEqual({ outcome: "unavailable" });
  });
  it.each([
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
  ])("accepts the exact owner processing state %s", async (state) => {
    const body = {
      id,
      state,
      submittedAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:01:00.000Z",
    };
    await expect(
      getContributionStatus(
        id,
        "token",
        "https://api.test",
        vi.fn(async () => response(200, body)) as typeof fetch,
      ),
    ).resolves.toEqual({ outcome: "ok", value: body });
  });
  it("surfaces withdrawal version conflict", async () => {
    await expect(
      withdrawContribution(
        id,
        2,
        "token",
        "https://api.test",
        vi.fn(async () => response(409, {})) as typeof fetch,
      ),
    ).resolves.toEqual({ outcome: "version_conflict" });
  });
  it("hashes bounded appeal evidence locally and sends no raw evidence", async () => {
    const evidenceDigestSha256 = await appealEvidenceDigest("candidate evidence");
    expect(evidenceDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const serialized = String(init?.body);
      expect(serialized).not.toContain("candidate evidence");
      expect(JSON.parse(serialized)).toEqual({
        expectedVersion: 2,
        evidenceDigestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      return response(200, trust);
    });
    await expect(
      fileContributionAppeal(
        id,
        2,
        evidenceDigestSha256,
        "token",
        "https://api.test",
        fetcher as typeof fetch,
      ),
    ).resolves.toEqual({ outcome: "ok", value: trust });
  });
});
