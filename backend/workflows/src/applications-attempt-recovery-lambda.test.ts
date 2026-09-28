import { describe, expect, it, vi } from "vitest";
import {
  createApplicationsAttemptRecoveryHandler,
  DEFAULT_ATTEMPT_RECOVERY_LIMIT,
  DEFAULT_ATTEMPT_STALE_AFTER_MS,
  isApplicationsAttemptRecoveryEvent,
} from "./applications-attempt-recovery-lambda.js";

const RULE_ARN =
  "arn:aws:events:us-east-2:362544434697:rule/ai-job-apply-development-applications-attempt-recovery";

function scheduledEvent(overrides: Record<string, unknown> = {}) {
  return {
    account: "362544434697",
    region: "us-east-2",
    source: "aws.events",
    "detail-type": "Scheduled Event",
    resources: [RULE_ARN],
    detail: {},
    ...overrides,
  };
}

describe("isApplicationsAttemptRecoveryEvent", () => {
  it("accepts the exact scheduled event for the configured rule", () => {
    expect(isApplicationsAttemptRecoveryEvent(scheduledEvent(), RULE_ARN)).toBe(true);
  });

  it.each([
    ["a foreign source", scheduledEvent({ source: "aws.sqs" })],
    ["a different detail type", scheduledEvent({ "detail-type": "Something Else" })],
    ["a second resource", scheduledEvent({ resources: [RULE_ARN, RULE_ARN] })],
    ["another rule entirely", scheduledEvent({ resources: [`${RULE_ARN}-other`] })],
    ["a mismatched account", scheduledEvent({ account: "999999999999" })],
    ["a mismatched region", scheduledEvent({ region: "us-west-2" })],
    ["a nonempty detail", scheduledEvent({ detail: { extra: true } })],
    ["a detail array", scheduledEvent({ detail: [] })],
    ["a null event", null],
    ["an array event", []],
    ["a string event", "scheduled"],
  ])("rejects %s", (_name, event) => {
    expect(isApplicationsAttemptRecoveryEvent(event, RULE_ARN)).toBe(false);
  });

  it("rejects every event when the configured rule ARN itself is malformed", () => {
    expect(isApplicationsAttemptRecoveryEvent(scheduledEvent(), "not-an-arn")).toBe(false);
  });
});

describe("createApplicationsAttemptRecoveryHandler", () => {
  it("throws when constructed without a rule ARN", () => {
    expect(() =>
      createApplicationsAttemptRecoveryHandler({ recoverStaleAttempts: vi.fn() }, ""),
    ).toThrow("ApplicationsAttemptRecoveryConfigurationInvalid");
  });

  it("rejects an event that does not match the configured rule", async () => {
    const store = { recoverStaleAttempts: vi.fn() };
    const handler = createApplicationsAttemptRecoveryHandler(store, RULE_ARN);
    await expect(
      handler(scheduledEvent({ resources: ["arn:aws:events:us-east-2:362544434697:rule/other"] })),
    ).rejects.toThrow("ApplicationsAttemptRecoveryEventRejected");
    expect(store.recoverStaleAttempts).not.toHaveBeenCalled();
  });

  it("calls the store with the default staleness and limit, and returns the count", async () => {
    const store = { recoverStaleAttempts: vi.fn().mockResolvedValue({ recovered: 3 }) };
    const handler = createApplicationsAttemptRecoveryHandler(store, RULE_ARN);
    await expect(handler(scheduledEvent())).resolves.toEqual({ schemaVersion: 1, recovered: 3 });
    expect(store.recoverStaleAttempts).toHaveBeenCalledWith(
      DEFAULT_ATTEMPT_STALE_AFTER_MS,
      DEFAULT_ATTEMPT_RECOVERY_LIMIT,
    );
  });

  it("passes through a configured staleness and limit override", async () => {
    const store = { recoverStaleAttempts: vi.fn().mockResolvedValue({ recovered: 0 }) };
    const handler = createApplicationsAttemptRecoveryHandler(store, RULE_ARN, {
      staleAfterMs: 60_000,
      limit: 10,
    });
    await handler(scheduledEvent());
    expect(store.recoverStaleAttempts).toHaveBeenCalledWith(60_000, 10);
  });

  it("logs only counts, never an identifier", async () => {
    const store = { recoverStaleAttempts: vi.fn().mockResolvedValue({ recovered: 2 }) };
    const logged: unknown[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      logged.push(...args);
    };
    try {
      await createApplicationsAttemptRecoveryHandler(store, RULE_ARN)(scheduledEvent());
    } finally {
      console.info = original;
    }
    expect(logged).toEqual([{ event: "application_stale_attempts_recovered", recovered: 2 }]);
  });

  it("propagates a store failure so the Lambda error alarm fires", async () => {
    const failure = new Error("synthetic private-canary database outage");
    const store = { recoverStaleAttempts: vi.fn().mockRejectedValue(failure) };
    await expect(
      createApplicationsAttemptRecoveryHandler(store, RULE_ARN)(scheduledEvent()),
    ).rejects.toBe(failure);
  });
});
