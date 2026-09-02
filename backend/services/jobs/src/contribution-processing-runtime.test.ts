import { describe, expect, it } from "vitest";
import { runContributionProcessingRuntimeBatch } from "./contribution-processing-runtime.js";

const input = {
  processingWorkerId: "processing:synthetic",
  processingLimit: 5,
  deliveryWorkerId: "delivery:synthetic",
  deliveryLimit: 5,
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
});
