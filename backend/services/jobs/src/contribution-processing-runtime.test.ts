import { describe, expect, it, vi } from "vitest";
import { runContributionProcessingRuntimeBatch } from "./contribution-processing-runtime.js";

const input = {
  processingWorkerId: "processing:synthetic",
  processingLimit: 5,
};

describe("contribution processing batch runtime", () => {
  it("is default-off and performs no work without explicit configuration", async () => {
    await expect(runContributionProcessingRuntimeBatch(input)).resolves.toEqual({
      enabled: false,
      processing: { claimed: 0, completed: 0, retried: 0, dead: 0, parked: 0 },
      delivery: { claimed: 0, published: 0, retried: 0, dead: 0 },
    });
  });

  it("fails closed when activation omits any runtime authority", async () => {
    await expect(
      runContributionProcessingRuntimeBatch(input, { enabled: true } as never),
    ).rejects.toThrow("Every contribution-processing runtime authority must be injected");
  });

  it("runs processing without touching event delivery when no real publisher is configured", async () => {
    const statements: string[] = [];
    const sql = Object.assign(
      (fragments: TemplateStringsArray) => {
        statements.push(fragments.join("?"));
        return Promise.resolve([]);
      },
      {
        begin: async (work: (transaction: unknown) => Promise<unknown>) => work(sql),
      },
    );
    await expect(
      runContributionProcessingRuntimeBatch(input, {
        enabled: true,
        client: sql as never,
        processingPolicy: { version: "synthetic-processing-v1" },
        processingRunnerPolicy: {
          maxAttempts: 3,
          claimLeaseMilliseconds: 30_000,
          retryDelayMilliseconds: [1_000, 2_000],
        },
        consent: { verifyCurrent: async () => ({ status: "unavailable" }) },
        independentVerifier: { verify: async () => ({ status: "unavailable" }) as never },
        trust: { evaluate: async () => ({ status: "unavailable" }) },
        capability: { load: async () => null },
        publicationCatalog: { recordObservationInTransaction: vi.fn() as never },
        now: () => new Date("2026-09-02T16:00:00.000Z"),
      }),
    ).resolves.toEqual({
      enabled: true,
      processing: { claimed: 0, completed: 0, retried: 0, dead: 0, parked: 0 },
      delivery: { claimed: 0, published: 0, retried: 0, dead: 0 },
    });
    expect(statements.join("\n")).not.toContain("job_contribution_processing_event_deliveries");
  });

  it("rejects delivery input without an explicit publisher before database work", async () => {
    const client = Object.assign(vi.fn(), { begin: vi.fn() });
    await expect(
      runContributionProcessingRuntimeBatch(
        { ...input, delivery: { workerId: "delivery:synthetic", limit: 5 } },
        {
          enabled: true,
          client: client as never,
          processingPolicy: { version: "synthetic-processing-v1" },
          processingRunnerPolicy: {
            maxAttempts: 3,
            claimLeaseMilliseconds: 30_000,
            retryDelayMilliseconds: [1_000, 2_000],
          },
          consent: { verifyCurrent: async () => ({ status: "unavailable" }) },
          independentVerifier: { verify: async () => ({ status: "unavailable" }) as never },
          trust: { evaluate: async () => ({ status: "unavailable" }) },
          capability: { load: async () => null },
          publicationCatalog: { recordObservationInTransaction: vi.fn() as never },
          now: () => new Date("2026-09-02T16:00:00.000Z"),
        },
      ),
    ).rejects.toThrow("requires a real publisher");
    expect(client.begin).not.toHaveBeenCalled();
  });
});
