import type { PacketFieldEntry } from "./packet.js";
import type { AttemptRecord } from "./store.js";

/**
 * D3-010 measurement. Events carry only allow-listed dimensions whose values are short opaque
 * tokens, so a metric can never hold a candidate value, free text, URL, or identifier. Every
 * quality metric is dimensioned by adapter, variant, adapter version, model, and prompt version so
 * regressions are observable per version.
 */
export const metricNames = [
  "application_funnel",
  "field_review",
  "field_correction",
  "generation_outcome",
  "attempt_outcome",
  "attempt_latency_ms",
  "review_latency_ms",
] as const;
export type MetricName = (typeof metricNames)[number];

export const dimensionNames = [
  "stage",
  "adapter",
  "adapterVersion",
  "variant",
  "fieldKey",
  "outcome",
  "reason",
  "origin",
  "model",
  "promptVersion",
] as const;
export type DimensionName = (typeof dimensionNames)[number];

export interface MetricEvent {
  name: MetricName;
  value: number;
  dimensions: Partial<Record<DimensionName, string>>;
}

export interface MetricSink {
  record(event: MetricEvent): void;
}

const TOKEN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export class InvalidMetricError extends Error {
  constructor() {
    super("Metric events must use allow-listed names and short opaque dimension tokens");
    this.name = "InvalidMetricError";
  }
}

export function assertMetricEvent(event: MetricEvent): void {
  if (!(metricNames as readonly string[]).includes(event.name) || !Number.isFinite(event.value)) {
    throw new InvalidMetricError();
  }
  for (const [name, value] of Object.entries(event.dimensions)) {
    if (!(dimensionNames as readonly string[]).includes(name) || !TOKEN.test(value ?? "")) {
      throw new InvalidMetricError();
    }
  }
}

/** Lowercases and tokenizes a version-like string; returns "unknown" instead of failing a request. */
export function versionToken(value: string | undefined): string {
  const token = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/gu, "-")
    .slice(0, 64);
  return TOKEN.test(token) ? token : "unknown";
}

export class InMemoryMetricSink implements MetricSink {
  readonly events: MetricEvent[] = [];

  record(event: MetricEvent): void {
    assertMetricEvent(event);
    this.events.push({ ...event, dimensions: { ...event.dimensions } });
  }
}

/** A sink that can never break a candidate request: invalid events and sink failures are dropped. */
export function safeRecord(sink: MetricSink | undefined, event: MetricEvent): void {
  if (!sink) return;
  try {
    assertMetricEvent(event);
    sink.record(event);
  } catch {
    // Telemetry is best effort and must not change application behavior.
  }
}

/**
 * Per-field correction: a field the candidate changed between packet versions. The taxonomy key
 * and reason are emitted; values never are.
 */
export function correctionMetrics(
  previous: readonly PacketFieldEntry[],
  next: readonly PacketFieldEntry[],
  dimensions: { adapter: string; adapterVersion: string; variant: string },
): MetricEvent[] {
  const before = new Map(previous.map((field) => [field.fieldKey, field]));
  const events: MetricEvent[] = [];
  for (const field of next) {
    const prior = before.get(field.fieldKey);
    if (!prior) continue;
    const changed = JSON.stringify(prior.value) !== JSON.stringify(field.value);
    events.push({
      name: "field_review",
      value: 1,
      dimensions: { ...dimensions, fieldKey: versionToken(field.fieldKey), origin: prior.origin },
    });
    if (changed && field.origin === "user_entered") {
      events.push({
        name: "field_correction",
        value: 1,
        dimensions: {
          ...dimensions,
          fieldKey: versionToken(field.fieldKey),
          origin: prior.origin,
          reason: prior.value === null ? "filled_missing" : "value_changed",
        },
      });
    }
  }
  return events;
}

export function attemptMetrics(
  attempt: Pick<
    AttemptRecord,
    "adapterId" | "adapterVersion" | "status" | "startedAt" | "resolvedAt"
  >,
  variant: string,
): MetricEvent[] {
  const dimensions = {
    adapter: versionToken(attempt.adapterId),
    adapterVersion: versionToken(attempt.adapterVersion),
    variant: versionToken(variant),
  };
  const events: MetricEvent[] = [
    { name: "attempt_outcome", value: 1, dimensions: { ...dimensions, outcome: attempt.status } },
  ];
  if (attempt.resolvedAt) {
    events.push({
      name: "attempt_latency_ms",
      value: Math.max(0, attempt.resolvedAt.getTime() - attempt.startedAt.getTime()),
      dimensions: { ...dimensions, outcome: attempt.status },
    });
  }
  return events;
}

export interface VersionedRate {
  key: string;
  total: number;
  numerator: number;
  rate: number;
}

function rateBy(
  events: readonly MetricEvent[],
  name: MetricName,
  denominatorName: MetricName,
  keyOf: (event: MetricEvent) => string,
  isNumerator: (event: MetricEvent) => boolean,
): VersionedRate[] {
  const totals = new Map<string, { total: number; numerator: number }>();
  for (const event of events) {
    if (event.name !== denominatorName && event.name !== name) continue;
    const key = keyOf(event);
    const entry = totals.get(key) ?? { total: 0, numerator: 0 };
    if (event.name === denominatorName) entry.total += event.value;
    if (event.name === name && isNumerator(event)) entry.numerator += event.value;
    totals.set(key, entry);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, { total, numerator }]) => ({
      key,
      total,
      numerator,
      rate: total === 0 ? 0 : numerator / total,
    }));
}

const versionKey = (event: MetricEvent) =>
  `${event.dimensions.adapter ?? "none"}@${event.dimensions.adapterVersion ?? "none"}/${event.dimensions.variant ?? "none"}`;

/** Share of reviewed fields the candidate corrected, per adapter version, variant, and field. */
export function correctionRateByVersion(events: readonly MetricEvent[]): VersionedRate[] {
  return rateBy(
    events,
    "field_correction",
    "field_review",
    (event) => `${versionKey(event)}#${event.dimensions.fieldKey ?? "none"}`,
    () => true,
  );
}

/** Confirmed submissions as a share of all attempts, per adapter version and variant. */
export function confirmationRateByVersion(events: readonly MetricEvent[]): VersionedRate[] {
  return rateBy(
    events,
    "attempt_outcome",
    "attempt_outcome",
    versionKey,
    (event) => event.dimensions.outcome === "confirmed",
  );
}

/** Ambiguous results as a share of all attempts. Any rise is a duplicate-submission risk signal. */
export function ambiguityRateByVersion(events: readonly MetricEvent[]): VersionedRate[] {
  return rateBy(
    events,
    "attempt_outcome",
    "attempt_outcome",
    versionKey,
    (event) => event.dimensions.outcome === "ambiguous",
  );
}

/** Unsupported-claim rejections as a share of generation attempts, per model and prompt version. */
export function generationRejectionRateByVersion(events: readonly MetricEvent[]): VersionedRate[] {
  return rateBy(
    events,
    "generation_outcome",
    "generation_outcome",
    (event) => `${event.dimensions.model ?? "none"}@${event.dimensions.promptVersion ?? "none"}`,
    (event) => event.dimensions.outcome === "rejected",
  );
}

export function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

export function latencyByVersion(
  events: readonly MetricEvent[],
): Array<{ key: string; count: number; p50: number; p95: number }> {
  const byKey = new Map<string, number[]>();
  for (const event of events) {
    if (event.name !== "attempt_latency_ms") continue;
    const values = byKey.get(versionKey(event)) ?? [];
    values.push(event.value);
    byKey.set(versionKey(event), values);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, values]) => ({
      key,
      count: values.length,
      p50: percentile(values, 0.5) ?? 0,
      p95: percentile(values, 0.95) ?? 0,
    }));
}
