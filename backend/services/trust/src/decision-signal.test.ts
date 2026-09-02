import { describe, expect, it, vi } from "vitest";
import {
  IdentifierOnlyTrustDecisionEventPublisher,
  type ClaimedTrustContributionDecisionEvent,
  TrustDecisionDeliveryRunner,
  type TrustDecisionDeliveryStore,
} from "./decision-signal.js";

const now = new Date("2026-09-02T04:00:00.000Z");
const decisionId = "8c22280f-3fc3-8f8b-8a0f-1fc74152d8c9";
const contributionId = "019b4e12-7ea3-7c36-9357-aea35ab542ca";

function item(attempt = 1): ClaimedTrustContributionDecisionEvent {
  return {
    event: {
      id: decisionId,
      type: "trust.contribution-decision.changed.v1",
      subject: contributionId,
      data: { decisionId, contributionId },
    },
    attempt,
    claimToken: "01990a00-0000-7000-8000-000000000004",
    claimedBy: "trust:synthetic",
    claimExpiresAt: new Date(now.getTime() + 30_000),
  };
}

function store(items: ClaimedTrustContributionDecisionEvent[]): TrustDecisionDeliveryStore {
  return {
    claim: vi.fn(async () => items),
    acknowledge: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}

const policy = {
  maxAttempts: 3,
  claimLeaseMilliseconds: 30_000,
  retryDelayMilliseconds: [1_000, 2_000],
} as const;

describe("Trust decision signal delivery", () => {
  it("publishes only a stable identifier-only integrity nudge", async () => {
    const transport = {
      publish: vi.fn(
        async (_nudge: import("@ai-job-apply/event-contracts").OutboxNudgeV1) => undefined,
      ),
    };
    const publisher = new IdentifierOnlyTrustDecisionEventPublisher(transport);
    await publisher.publish({ idempotencyKey: decisionId, event: item().event });
    const [nudge] = transport.publish.mock.calls[0] ?? [];
    expect(nudge).toMatchObject({
      schemaVersion: 1,
      eventId: decisionId,
      eventType: "trust.contribution-decision.changed.v1",
      integrity: { algorithm: "sha256" },
    });
    expect(JSON.stringify(nudge)).not.toContain(contributionId);
    expect(JSON.stringify(nudge)).not.toContain("reviewer");
  });

  it("retries the same event identity and returns aggregate-only metrics", async () => {
    const delivery = store([item(2)]);
    const runner = new TrustDecisionDeliveryRunner(
      delivery,
      { publish: vi.fn(async () => Promise.reject(new Error("private"))) },
      policy,
    );
    await expect(runner.runBatch("trust:synthetic", now, 1)).resolves.toEqual({
      claimed: 1,
      published: 0,
      retried: 1,
      dead: 0,
    });
    expect(delivery.retry).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: false, retryAt: new Date(now.getTime() + 2_000) }),
    );
  });

  it("requires explicit bounded delivery policy", () => {
    expect(
      () =>
        new TrustDecisionDeliveryRunner(
          store([]),
          { publish: vi.fn() },
          {
            maxAttempts: 0,
            claimLeaseMilliseconds: 0,
            retryDelayMilliseconds: [],
          },
        ),
    ).toThrow("explicit bounded");
  });
});
