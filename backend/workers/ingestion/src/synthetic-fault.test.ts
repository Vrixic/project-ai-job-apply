import { describe, expect, it } from "vitest";
import {
  GeneratedSyntheticProviderFaultAdapter,
  generatedSyntheticProviderFaultAdapterVersion,
  generatedSyntheticProviderFaultSourceId,
} from "./synthetic-fault.js";

describe("generated-synthetic provider fault fixture", () => {
  const observedAt = new Date("2026-08-26T12:00:00.000Z");

  it("binds one fixed generated-synthetic source and adapter identity", () => {
    expect(new GeneratedSyntheticProviderFaultAdapter()).toMatchObject({
      sourceId: generatedSyntheticProviderFaultSourceId,
      adapterVersion: generatedSyntheticProviderFaultAdapterVersion,
    });
    expect(generatedSyntheticProviderFaultSourceId).toBe("synthetic-d1-provider-fault-v1");
    expect(generatedSyntheticProviderFaultAdapterVersion).toBe("synthetic-d1-provider-fault-v1");
  });

  it("injects exactly one bounded source-unavailable retry on attempt one", async () => {
    const adapter = new GeneratedSyntheticProviderFaultAdapter();

    await expect(
      adapter.poll({ observedAt, signal: new AbortController().signal, attempt: 1 }),
    ).resolves.toEqual({
      kind: "retry",
      reason: "source_unavailable",
      retryAfterMs: 1_000,
    });
  });

  it.each([2, 3, 4, 5])("recovers with an empty success batch on attempt %i", async (attempt) => {
    const adapter = new GeneratedSyntheticProviderFaultAdapter();

    await expect(
      adapter.poll({ observedAt, signal: new AbortController().signal, attempt }),
    ).resolves.toEqual({ kind: "success", observations: [], withdrawals: [] });
  });

  it.each([0, 6, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid attempt %s",
    async (attempt) => {
      const adapter = new GeneratedSyntheticProviderFaultAdapter();

      await expect(
        adapter.poll({ observedAt, signal: new AbortController().signal, attempt }),
      ).rejects.toThrow("source poll attempt must be a whole number from 1 through 5");
    },
  );
});
