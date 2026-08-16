import { describe, expect, it } from "vitest";
import {
  buildGeneratedSyntheticObservations,
  GeneratedSyntheticIngestionAdapter,
  generatedSyntheticAdapterVersion,
  generatedSyntheticSourceId,
} from "./synthetic.js";

describe("generated synthetic ingestion", () => {
  const observedAt = new Date("2026-08-16T00:00:00.000Z");
  const seed = "019c0000000070008000000000000099";

  it("is byte-for-byte deterministic for one seed and timestamp", () => {
    const first = buildGeneratedSyntheticObservations(seed, observedAt);
    const second = buildGeneratedSyntheticObservations(seed, observedAt);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).toHaveLength(2);
    expect(
      first.every((observation) =>
        new URL(observation.sourceUrl).hostname.endsWith(".example.test"),
      ),
    ).toBe(true);
    expect(JSON.stringify(first).toLocaleLowerCase("en-US")).not.toMatch(/greenhouse|lever|ashby/);
  });

  it("represents no provider and returns fresh copies", async () => {
    const adapter = new GeneratedSyntheticIngestionAdapter(seed);
    expect(adapter).toMatchObject({
      sourceId: generatedSyntheticSourceId,
      adapterVersion: generatedSyntheticAdapterVersion,
    });
    const first = await adapter.poll({ observedAt, signal: new AbortController().signal });
    const second = await adapter.poll({ observedAt, signal: new AbortController().signal });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it("rejects noncanonical seeds and timestamps", () => {
    expect(() => buildGeneratedSyntheticObservations("real employer", observedAt)).toThrow(
      "canonical synthetic seed",
    );
    expect(() => buildGeneratedSyntheticObservations(seed, new Date(Number.NaN))).toThrow(
      "canonical synthetic seed",
    );
  });
});
