import { describe, expect, it, vi } from "vitest";
import {
  type ClaimedContributionProcessingEvent,
  ContributionProcessingEventDeliveryRunner,
  type ContributionProcessingEventDeliveryStore,
} from "./contribution-processing-event-delivery.js";

const now = new Date("2026-09-02T04:00:00.000Z");
const eventId = "01990a00-0000-7000-8000-000000000001";
const contributionId = "01990a00-0000-7000-8000-000000000002";
const normalizationId = "01990a00-0000-7000-8000-000000000003";

function item(attempt = 1): ClaimedContributionProcessingEvent {
  return {
    event: {
      id: eventId,
      type: "job.normalized.v1",
      subject: contributionId,
      data: { contributionId, normalizationId },
    },
    attempt,
    claimToken: "01990a00-0000-7000-8000-000000000004",
    claimedBy: "delivery:synthetic",
    claimExpiresAt: new Date(now.getTime() + 30_000),
  };
}

function store(
  claimed: ClaimedContributionProcessingEvent[],
): ContributionProcessingEventDeliveryStore {
  return {
    claim: vi.fn(async () => claimed),
    acknowledge: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
  };
}

const policy = {
  maxAttempts: 3,
  claimLeaseMilliseconds: 30_000,
  retryDelayMilliseconds: [1_000, 2_000],
} as const;

describe("ContributionProcessingEventDeliveryRunner", () => {
  it("publishes with the immutable event identity and returns aggregate-only metrics", async () => {
    const delivery = store([item()]);
    const publisher = { publish: vi.fn(async () => undefined) };
    const result = await new ContributionProcessingEventDeliveryRunner(
      delivery,
      publisher,
      policy,
    ).runBatch("delivery:synthetic", now, 5);

    expect(publisher.publish).toHaveBeenCalledWith({
      idempotencyKey: eventId,
      event: item().event,
    });
    expect(delivery.acknowledge).toHaveBeenCalledOnce();
    expect(delivery.retry).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 1, published: 1, retried: 0, dead: 0 });
    expect(JSON.stringify(result)).not.toContain(eventId);
  });

  it("bounds transport failures and marks only the final attempt dead", async () => {
    const retrying = store([item(2)]);
    const unavailable = { publish: vi.fn(async () => Promise.reject(new Error("private"))) };
    await expect(
      new ContributionProcessingEventDeliveryRunner(retrying, unavailable, policy).runBatch(
        "delivery:synthetic",
        now,
        1,
      ),
    ).resolves.toEqual({ claimed: 1, published: 0, retried: 1, dead: 0 });
    expect(retrying.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "transport_unavailable",
        terminal: false,
        retryAt: new Date(now.getTime() + 2_000),
      }),
    );

    const exhausted = store([item(3)]);
    await expect(
      new ContributionProcessingEventDeliveryRunner(exhausted, unavailable, policy).runBatch(
        "delivery:synthetic",
        now,
        1,
      ),
    ).resolves.toEqual({ claimed: 1, published: 0, retried: 0, dead: 1 });
    expect(exhausted.retry).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: true, retryAt: now }),
    );
  });

  it("surfaces an ambiguous acknowledgement instead of misclassifying it as transport failure", async () => {
    const delivery = store([item()]);
    delivery.acknowledge = vi.fn(async () => Promise.reject(new Error("ambiguous database ack")));
    await expect(
      new ContributionProcessingEventDeliveryRunner(
        delivery,
        { publish: vi.fn(async () => undefined) },
        policy,
      ).runBatch("delivery:synthetic", now, 1),
    ).rejects.toThrow("ambiguous database ack");
    expect(delivery.retry).not.toHaveBeenCalled();
  });

  it("requires explicit bounded timing and attempt policy", () => {
    expect(
      () =>
        new ContributionProcessingEventDeliveryRunner(
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
