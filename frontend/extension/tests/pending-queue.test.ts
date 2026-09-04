import { describe, expect, it } from "vitest";
import type { SanitizedJobCapture } from "../lib/job-capture";
import {
  classifyResponse,
  createPendingIntent,
  deferPendingIntent,
  dueForDispatch,
  fenceMismatchedIntent,
  restartStoppedIntent,
  retainUnexpiredIntents,
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
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    expect(intent.idempotencyKey).toBe("extension-job-intent-018f0000-0000-7000-8000-000000000001");
    expect(intent.approvedFields).toEqual(["title"]);
    expect(dueForDispatch(intent, "account-a", new Date(intent.nextAttemptAt))).toBe(true);
    expect(dueForDispatch(intent, "account-b", new Date(intent.nextAttemptAt))).toBe(false);
  });

  it("lets an explicit retry bypass only the backoff boundary", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      now,
      randomId: () => "018f0000-0000-7000-8000-000000000005",
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    const backedOff = { ...intent, nextAttemptAt: "2026-09-01T14:00:00.000Z" };

    expect(dueForDispatch(backedOff, "account-a", now)).toBe(false);
    expect(dueForDispatch(backedOff, "account-a", now, true)).toBe(true);
    expect(dueForDispatch(backedOff, "account-b", now, true)).toBe(false);
    expect(
      dueForDispatch({ ...backedOff, expiresAt: now.toISOString() }, "account-a", now, true),
    ).toBe(false);
    expect(dueForDispatch({ ...backedOff, state: "terminal" }, "account-a", now, true)).toBe(false);
  });

  it("retries ambiguous/server failures with the same key and bounds attempts", () => {
    let intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      now: new Date("2026-09-01T12:00:00.000Z"),
      randomId: () => "018f0000-0000-7000-8000-000000000002",
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
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
    expect(intent.lastError).toBe("retry_exhausted");
    const restarted = restartStoppedIntent(intent, new Date("2026-09-01T15:00:00.000Z"));
    expect(restarted).toMatchObject({
      attempt: 0,
      idempotencyKey: key,
      nextAttemptAt: "2026-09-01T15:00:00.000Z",
      state: "pending",
    });
    expect(restarted).not.toHaveProperty("lastError");
  });

  it("does not restart account-fenced or already-pending intents", () => {
    const intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      randomId: () => "018f0000-0000-7000-8000-000000000006",
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    expect(restartStoppedIntent(intent)).toBe(intent);
    const blocked = fenceMismatchedIntent(intent);
    expect(restartStoppedIntent(blocked)).toBe(blocked);
  });

  it("records local delivery gates without consuming a delivery attempt", () => {
    const intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      randomId: () => "018f0000-0000-7000-8000-000000000007",
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });

    expect(deferPendingIntent(intent, "authentication_required")).toMatchObject({
      attempt: 0,
      lastError: "authentication_required",
      state: "pending",
    });
    const blocked = fenceMismatchedIntent(intent);
    expect(deferPendingIntent(blocked, "authentication_required")).toBe(blocked);
  });

  it("removes only acknowledged intents and fences account changes", () => {
    const intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "private_save",
      randomId: () => "018f0000-0000-7000-8000-000000000003",
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    expect(settleDispatch(intent, { outcome: "accepted" })).toBeUndefined();
    expect(fenceMismatchedIntent(intent)).toMatchObject({
      lastError: "identity_changed",
      state: "blocked",
    });
    expect(classifyResponse(503).outcome).toBe("retryable");
    expect(classifyResponse(409).outcome).toBe("terminal");
  });

  it("expires local intents at the configured boundary and rejects missing policy", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    const intent = createPendingIntent({
      approvedFields: ["title"],
      capture,
      identityFence: "account-a",
      intent: "contribute",
      now,
      randomId: () => "018f0000-0000-7000-8000-000000000004",
      retentionMilliseconds: 60 * 60 * 1_000,
    });
    expect(retainUnexpiredIntents([intent], new Date("2026-09-01T12:59:59.999Z"))).toEqual([
      intent,
    ]);
    expect(retainUnexpiredIntents([intent], new Date(intent.expiresAt))).toEqual([]);
    expect(() =>
      createPendingIntent({
        approvedFields: ["title"],
        capture,
        identityFence: "account-a",
        intent: "contribute",
        retentionMilliseconds: 0,
      }),
    ).toThrow("retention");
  });
});
