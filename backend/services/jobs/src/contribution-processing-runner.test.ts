import { describe, expect, it, vi } from "vitest";
import {
  ContributionProcessingRunner,
  type ContributionProcessingQueueItem,
  type ContributionProcessingQueueStore,
} from "./contribution-processing-runner.js";

const now = new Date("2026-09-01T13:00:00.000Z");
const item: ContributionProcessingQueueItem = {
  id: "018f47a6-7b2c-7ee1-8c09-3ea174e80e30",
  contributionId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e20",
  state: "claimed",
  attempt: 1,
  claimedBy: "worker:synthetic",
  claimExpiresAt: new Date("2026-09-01T13:00:30.000Z"),
};

function store(): ContributionProcessingQueueStore {
  return {
    claim: vi.fn(async () => [item]),
    complete: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    park: vi.fn(async () => undefined),
    requeue: vi.fn(async () => true),
  };
}

function runner(queue: ContributionProcessingQueueStore, outcome: string) {
  return new ContributionProcessingRunner(
    queue,
    { process: vi.fn(async () => outcome as never) },
    {
      maxAttempts: 3,
      claimLeaseMilliseconds: 30_000,
      retryDelayMilliseconds: [1_000, 5_000],
    },
  );
}

describe("ContributionProcessingRunner", () => {
  it("requires explicit bounded lease and retry policy", () => {
    expect(
      () =>
        new ContributionProcessingRunner(
          store(),
          { process: vi.fn() },
          {
            maxAttempts: 3,
            claimLeaseMilliseconds: 30_000,
            retryDelayMilliseconds: [],
          },
        ),
    ).toThrow("explicit bounded");
  });

  it("completes an idempotently published work item under the exact lease", async () => {
    const queue = store();
    await expect(runner(queue, "published").runBatch("worker:synthetic", now, 1)).resolves.toEqual({
      claimed: 1,
      completed: 1,
      retried: 0,
      dead: 0,
      parked: 0,
    });
    expect(queue.claim).toHaveBeenCalledWith({
      workerId: "worker:synthetic",
      now,
      claimExpiresAt: new Date("2026-09-01T13:00:30.000Z"),
      limit: 1,
    });
    expect(queue.complete).toHaveBeenCalledOnce();
  });

  it("bounds technical dependency retries and uses fixed codes only", async () => {
    const queue = store();
    await expect(
      runner(queue, "awaiting_consent_dependency").runBatch("worker:synthetic", now, 1),
    ).resolves.toMatchObject({ retried: 1, dead: 0 });
    expect(queue.retry).toHaveBeenCalledWith({
      item,
      workerId: "worker:synthetic",
      now,
      retryAt: new Date("2026-09-01T13:00:01.000Z"),
      errorCode: "consent_dependency",
      terminal: false,
    });

    const exhausted = store();
    const finalItem = { ...item, attempt: 3 };
    vi.mocked(exhausted.claim).mockResolvedValueOnce([finalItem]);
    await expect(
      runner(exhausted, "awaiting_capability_dependency").runBatch("worker:synthetic", now, 1),
    ).resolves.toMatchObject({ retried: 0, dead: 1 });
    expect(exhausted.retry).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "capability_dependency", terminal: true }),
    );
  });

  it("parks long-lived provider and Trust waits instead of exhausting them", async () => {
    for (const [outcome, reason] of [
      ["awaiting_independent_verification", "provider_pending"],
      ["awaiting_trust", "trust_pending"],
    ] as const) {
      const queue = store();
      vi.mocked(queue.claim).mockResolvedValueOnce([{ ...item, attempt: 3 }]);
      await expect(
        runner(queue, outcome).runBatch("worker:synthetic", now, 1),
      ).resolves.toMatchObject({
        parked: 1,
        dead: 0,
      });
      expect(queue.park).toHaveBeenCalledWith({
        item: { ...item, attempt: 3 },
        workerId: "worker:synthetic",
        now,
        reason,
      });
      expect(queue.retry).not.toHaveBeenCalled();
    }
  });

  it("parks a disabled capability and converges after an explicit policy signal", async () => {
    const queue = store();
    vi.mocked(queue.claim)
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([{ ...item, attempt: 1 }]);
    const processing = {
      process: vi
        .fn()
        .mockResolvedValueOnce("capability_disabled")
        .mockResolvedValueOnce("published"),
    };
    const value = new ContributionProcessingRunner(queue, processing, {
      maxAttempts: 3,
      claimLeaseMilliseconds: 30_000,
      retryDelayMilliseconds: [1_000, 5_000],
    });
    await expect(value.runBatch("worker:synthetic", now, 1)).resolves.toMatchObject({
      parked: 1,
      dead: 0,
    });
    expect(queue.park).toHaveBeenCalledWith({
      item,
      workerId: "worker:synthetic",
      now,
      reason: "capability_disabled",
    });
    await expect(
      queue.requeue({
        contributionId: item.contributionId,
        now: new Date("2026-09-01T13:05:00.000Z"),
        signal: "capability_policy",
      }),
    ).resolves.toBe(true);
    await expect(
      value.runBatch("worker:synthetic", new Date("2026-09-01T13:05:00.000Z"), 1),
    ).resolves.toMatchObject({ completed: 1, parked: 0 });
  });
});
