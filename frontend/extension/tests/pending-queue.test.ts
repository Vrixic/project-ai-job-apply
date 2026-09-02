import { describe, expect, it } from "vitest";
import type { SanitizedJobCapture } from "../lib/job-capture";
import {
  classifyResponse,
  createPendingIntent,
  dueForDispatch,
  fenceMismatchedIntent,
  settleDispatch,
  uuidV7,
} from "../lib/pending-queue";

const capture: SanitizedJobCapture = {
  adapterVersion: "d2-job-page-v1",
  capturedAt: "2026-09-01T12:00:00.000Z",
  pageVariant: "lever-posting-v1",
  provider: "lever",
  sourceUrl: "https://jobs.lever.co/example/123",
  title: "Engineer",
};

describe("persistent pending job intents", () => {
  it("generates a contract-compatible UUIDv7 semantic identity", () => {
    expect(uuidV7(1_725_192_000_000, new Uint8Array(10))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("creates one stable semantic identity and idempotency key", () => {
    const intent = createPendingIntent({
      approvedFields: ["title", "title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      now: new Date("2026-09-01T12:00:00.000Z"),
      randomId: () => "018f0000-0000-7000-8000-000000000001",
    });
    expect(intent.idempotencyKey).toBe("extension-job-intent-018f0000-0000-7000-8000-000000000001");
    expect(intent.approvedFields).toEqual(["title"]);
    expect(dueForDispatch(intent, "account-a", new Date(intent.nextAttemptAt))).toBe(true);
    expect(dueForDispatch(intent, "account-b", new Date(intent.nextAttemptAt))).toBe(false);
  });

  it("retries ambiguous/server failures with the same key and bounds attempts", () => {
    let intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      now: new Date("2026-09-01T12:00:00.000Z"),
      randomId: () => "018f0000-0000-7000-8000-000000000002",
    });
    const key = intent.idempotencyKey;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const settled = settleDispatch(intent, { outcome: "retryable" }, new Date());
      expect(settled).toBeDefined();
      if (!settled) throw new Error("Retry unexpectedly acknowledged the pending intent");
      intent = settled;
    }
    expect(intent.idempotencyKey).toBe(key);
    expect(intent.attempt).toBe(5);
    expect(intent.state).toBe("terminal");
  });

  it("removes only acknowledged intents and fences account changes", () => {
    const intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "private_save",
      randomId: () => "018f0000-0000-7000-8000-000000000003",
    });
    expect(settleDispatch(intent, { outcome: "accepted" })).toBeUndefined();
    expect(fenceMismatchedIntent(intent)).toMatchObject({
      lastError: "identity_changed",
      state: "blocked",
    });
    expect(classifyResponse(503).outcome).toBe("retryable");
    expect(classifyResponse(409).outcome).toBe("terminal");
  });
});
