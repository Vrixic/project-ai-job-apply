import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appealEvidenceDigest,
  cancelContribution,
  fileContributionAppeal,
  getContributionHistory,
  getContributionStatus,
  getOwnerTrustStatus,
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
  const historyItem = {
    id,
    state: "awaiting_trust",
    submittedAt: trust.createdAt,
    updatedAt: trust.updatedAt,
  };

  it("loads one bounded owner history page through the cookie-free exact authenticated GET", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.test/v1/jobs/contributions");
      expect(init).toMatchObject({
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");
      return response(200, { items: [historyItem] });
    });
    await expect(
      getContributionHistory("synthetic-token", "https://api.test", fetcher),
    ).resolves.toEqual({ outcome: "ok", value: { items: [historyItem] } });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      getContributionHistory("synthetic-token", "https://api.test", async () =>
        response(200, { items: [] }),
      ),
    ).resolves.toEqual({ outcome: "ok", value: { items: [] } });
  });

  it.each([
    null,
    [],
    { items: [], owner: "forbidden" },
    { items: "invalid" },
    { items: [historyItem, historyItem] },
    {
      items: Array.from({ length: 26 }, (_, index) => ({
        ...historyItem,
        id: `018f0000-0000-7000-8000-${String(30 - index).padStart(12, "0")}`,
      })),
    },
    { items: [{ ...historyItem, ownerUserId: "forbidden" }] },
    { items: [{ ...historyItem, id: "invalid" }] },
    { items: [{ ...historyItem, state: "unknown" }] },
    { items: [{ ...historyItem, updatedAt: "2026-09-01T12:01:00Z" }] },
    { items: [{ ...historyItem, updatedAt: "2026-09-01T11:59:00.000Z" }] },
    { items: [historyItem, { ...historyItem, id: "018f0000-0000-7000-8000-000000000005" }] },
    {
      items: [
        historyItem,
        {
          ...historyItem,
          id: "018f0000-0000-7000-8000-000000000005",
          submittedAt: "2026-09-01T12:01:00.000Z",
        },
      ],
    },
  ])(
    "rejects a malformed or out-of-order history page %# without exposing its body",
    async (value) => {
      await expect(
        getContributionHistory("token", "https://api.test", async () => response(200, value)),
      ).resolves.toEqual({ outcome: "rejected" });
    },
  );

  it.each([401, 403, 404, 429, 503])(
    "does not mistake history HTTP %i for an empty account",
    async (status) => {
      const result = await getContributionHistory("token", "https://api.test", async () =>
        response(status, { private: "must-not-surface" }),
      );
      expect(result.outcome).not.toBe("ok");
      expect(result).not.toHaveProperty("value");
      expect(JSON.stringify(result)).not.toContain("must-not-surface");
    },
  );

  it.each([
    { processing: ["queued"], trust: ["accepted"] },
    { processing: [["queued"]], trust: [["accepted"]] },
    { processing: { toString: "queued" }, trust: { toString: "accepted" } },
    { processing: null, trust: null },
    { processing: false, trust: false },
    { processing: 1, trust: 1 },
  ])("rejects non-string Processing and Trust states without coercion %#", async (states) => {
    const item = { ...historyItem, state: states.processing };
    await expect(
      getContributionStatus(id, "token", "https://api.test", async () => response(200, item)),
    ).resolves.toEqual({ outcome: "rejected" });
    await expect(
      getContributionHistory("token", "https://api.test", async () =>
        response(200, { items: [item] }),
      ),
    ).resolves.toEqual({ outcome: "rejected" });
    await expect(
      getOwnerTrustStatus(id, "token", "https://api.test", async () =>
        response(200, { ...trust, state: states.trust }),
      ),
    ).resolves.toEqual({ outcome: "rejected" });
  });

  it.each(["headers", "body"])("bounds a stalled history %s read", async (stage) => {
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
    const reading = getContributionHistory("token", "https://api.test", fetcher);
    await vi.advanceTimersByTimeAsync(OWNER_ACTION_TIMEOUT_MILLISECONDS);
    await expect(reading).resolves.toEqual({ outcome: "unavailable" });
  });

  it("rejects a noncanonical individual timestamp before it can poison local history", async () => {
    await expect(
      getContributionStatus(id, "token", "https://api.test", async () =>
        response(200, { ...historyItem, updatedAt: "2026-09-01T12:01:00Z" }),
      ),
    ).resolves.toEqual({ outcome: "rejected" });
  });
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
