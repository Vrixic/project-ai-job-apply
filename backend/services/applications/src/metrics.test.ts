import { describe, expect, it } from "vitest";
import {
  ambiguityRateByVersion,
  assertMetricEvent,
  attemptMetrics,
  confirmationRateByVersion,
  correctionMetrics,
  correctionRateByVersion,
  generationRejectionRateByVersion,
  InMemoryMetricSink,
  InvalidMetricError,
  latencyByVersion,
  type MetricEvent,
  percentile,
  safeRecord,
  versionToken,
} from "./metrics.js";
import type { PacketFieldEntry } from "./packet.js";

const dims = { adapter: "greenhouse", adapterVersion: "1.2.0", variant: "board-v1" };

function field(
  fieldKey: string,
  value: PacketFieldEntry["value"],
  origin: PacketFieldEntry["origin"],
) {
  return {
    fieldKey,
    value,
    origin,
    sourceFactIds: [],
    confidence: 0.9,
    disposition: "review",
    reasons: [],
    requiresReview: true,
  } satisfies PacketFieldEntry;
}

describe("metric event validation", () => {
  it("accepts only allow-listed names and short opaque dimension tokens", () => {
    expect(() =>
      assertMetricEvent({
        name: "field_review",
        value: 1,
        dimensions: { fieldKey: "contact.email" },
      }),
    ).not.toThrow();
    for (const bad of [
      { name: "field_review", value: 1, dimensions: { fieldKey: "candidate@example.test" } },
      { name: "field_review", value: 1, dimensions: { fieldKey: "Has Spaces" } },
      { name: "field_review", value: 1, dimensions: { fieldKey: "x".repeat(65) } },
      { name: "field_review", value: 1, dimensions: { userId: "abc" } },
      { name: "hiring_outcome", value: 1, dimensions: {} },
      { name: "field_review", value: Number.NaN, dimensions: {} },
    ]) {
      expect(() => assertMetricEvent(bad as unknown as MetricEvent)).toThrow(InvalidMetricError);
    }
    expect(versionToken("Greenhouse Board/V1")).toBe("greenhouse-board-v1");
    expect(versionToken(undefined)).toBe("unknown");
  });

  it("never lets telemetry fail or alter a request", () => {
    const failing = {
      record() {
        throw new Error("sink down");
      },
    };
    expect(() =>
      safeRecord(failing, {
        name: "application_funnel",
        value: 1,
        dimensions: { stage: "created" },
      }),
    ).not.toThrow();
    expect(() =>
      safeRecord(failing, {
        name: "application_funnel",
        value: 1,
        dimensions: { stage: "Bad Token" },
      }),
    ).not.toThrow();
    const sink = new InMemoryMetricSink();
    safeRecord(sink, { name: "application_funnel", value: 1, dimensions: { stage: "Bad Token" } });
    expect(sink.events).toHaveLength(0);
    safeRecord(undefined, {
      name: "application_funnel",
      value: 1,
      dimensions: { stage: "created" },
    });
  });
});

describe("per-field correction metrics", () => {
  it("emits a correction only when the candidate changed a proposed value, and never the value", () => {
    const events = correctionMetrics(
      [
        field("contact.email", "old@example.test", "confirmed_fact"),
        field("job.relocation", null, "confirmed_fact"),
        field("contact.phone", "555-0100", "confirmed_fact"),
      ],
      [
        field("contact.email", "new@example.test", "user_entered"),
        field("job.relocation", true, "user_entered"),
        field("contact.phone", "555-0100", "confirmed_fact"),
      ],
      dims,
    );
    const corrections = events.filter((event) => event.name === "field_correction");
    expect(
      corrections.map((event) => [event.dimensions.fieldKey, event.dimensions.reason]),
    ).toEqual([
      ["contact.email", "value_changed"],
      ["job.relocation", "filled_missing"],
    ]);
    expect(events.filter((event) => event.name === "field_review")).toHaveLength(3);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("555-0100");
    for (const event of events) expect(() => assertMetricEvent(event)).not.toThrow();
  });

  it("computes correction rates per adapter version, variant, and field", () => {
    const review = (adapterVersion: string, fieldKey: string): MetricEvent => ({
      name: "field_review",
      value: 1,
      dimensions: { ...dims, adapterVersion, fieldKey },
    });
    const correction = (adapterVersion: string, fieldKey: string): MetricEvent => ({
      name: "field_correction",
      value: 1,
      dimensions: { ...dims, adapterVersion, fieldKey },
    });
    const rates = correctionRateByVersion([
      review("1.0.0", "contact.email"),
      review("1.0.0", "contact.email"),
      correction("1.0.0", "contact.email"),
      review("1.1.0", "contact.email"),
    ]);
    expect(rates).toEqual([
      { key: "greenhouse@1.0.0/board-v1#contact.email", total: 2, numerator: 1, rate: 0.5 },
      { key: "greenhouse@1.1.0/board-v1#contact.email", total: 1, numerator: 0, rate: 0 },
    ]);
  });
});

describe("attempt, confirmation, ambiguity, and latency metrics", () => {
  const start = new Date("2026-09-18T12:00:00.000Z");
  const attempt = (status: string, ms: number, adapterVersion = "1.0.0") =>
    attemptMetrics(
      {
        adapterId: "greenhouse",
        adapterVersion,
        status,
        startedAt: start,
        resolvedAt: new Date(start.getTime() + ms),
      } as never,
      "board-v1",
    );

  it("derives outcome and latency events with version dimensions", () => {
    const events = attempt("confirmed", 1500);
    expect(events).toEqual([
      {
        name: "attempt_outcome",
        value: 1,
        dimensions: {
          adapter: "greenhouse",
          adapterVersion: "1.0.0",
          variant: "board-v1",
          outcome: "confirmed",
        },
      },
      {
        name: "attempt_latency_ms",
        value: 1500,
        dimensions: {
          adapter: "greenhouse",
          adapterVersion: "1.0.0",
          variant: "board-v1",
          outcome: "confirmed",
        },
      },
    ]);
  });

  it("reports confirmation and ambiguity rates per adapter version", () => {
    const events = [
      ...attempt("confirmed", 1000),
      ...attempt("confirmed", 2000),
      ...attempt("ambiguous", 30_000),
      ...attempt("confirmed", 900, "2.0.0"),
    ];
    expect(confirmationRateByVersion(events)).toEqual([
      { key: "greenhouse@1.0.0/board-v1", total: 3, numerator: 2, rate: 2 / 3 },
      { key: "greenhouse@2.0.0/board-v1", total: 1, numerator: 1, rate: 1 },
    ]);
    expect(ambiguityRateByVersion(events)[0]).toMatchObject({ numerator: 1, total: 3 });
    const latency = latencyByVersion(events);
    expect(latency[0]).toMatchObject({
      key: "greenhouse@1.0.0/board-v1",
      count: 3,
      p50: 2000,
      p95: 30_000,
    });
  });

  it("reports unsupported-claim rejection rate per model and prompt version", () => {
    const generation = (outcome: string, promptVersion: string): MetricEvent => ({
      name: "generation_outcome",
      value: 1,
      dimensions: { model: "template", promptVersion, outcome },
    });
    expect(
      generationRejectionRateByVersion([
        generation("needs_review", "1.0.0"),
        generation("rejected", "1.0.0"),
        generation("needs_review", "1.1.0"),
      ]),
    ).toEqual([
      { key: "template@1.0.0", total: 2, numerator: 1, rate: 0.5 },
      { key: "template@1.1.0", total: 1, numerator: 0, rate: 0 },
    ]);
  });

  it("computes percentiles conservatively", () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
  });
});
