const namespace = "AIJobApply/D2Community";

export type D2CommunityMetricValues = Readonly<Record<string, number>>;

export function d2CommunityEmf(
  metricValues: D2CommunityMetricValues,
  occurredAt: Date,
): Readonly<Record<string, unknown>> {
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
    throw new TypeError("The D2 community metric clock is invalid");
  }
  const names = Object.keys(metricValues).sort();
  if (
    names.length < 1 ||
    names.length > 30 ||
    names.some((name) => !/^[A-Z][A-Za-z0-9]{2,63}$/u.test(name)) ||
    names.some((name) => {
      const value = metricValues[name];
      return value === undefined || !Number.isSafeInteger(value) || value < 0;
    })
  ) {
    throw new TypeError("The D2 community aggregate metrics are invalid");
  }
  return Object.freeze({
    _aws: Object.freeze({
      Timestamp: occurredAt.getTime(),
      CloudWatchMetrics: Object.freeze([
        Object.freeze({
          Namespace: namespace,
          Dimensions: Object.freeze([]),
          Metrics: Object.freeze(names.map((Name) => Object.freeze({ Name, Unit: "Count" }))),
        }),
      ]),
    }),
    ...Object.fromEntries(names.map((name) => [name, metricValues[name]])),
  });
}
