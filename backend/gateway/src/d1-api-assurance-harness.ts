export interface D1ApiAssuranceResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | number | undefined>>;
}

export interface D1ApiAssuranceScenario {
  stage: "steady" | "fault" | "recovery";
  expectedStatus: number;
  execute(): Promise<D1ApiAssuranceResponse>;
  validate(response: D1ApiAssuranceResponse): boolean;
}

export interface D1ApiAssuranceStageReceipt {
  requests: number;
  expectedResponses: number;
  unexpectedStatuses: number;
  contractFailures: number;
  privacyLeaks: number;
  transportFailures: number;
}

export interface D1ApiAssuranceReceipt {
  schemaVersion: 1;
  dataClassification: "synthetic";
  requests: number;
  expectedResponses: number;
  unexpectedStatuses: number;
  contractFailures: number;
  privacyLeaks: number;
  transportFailures: number;
  maximumInFlight: number;
  configuredConcurrency: number;
  stages: Readonly<Record<D1ApiAssuranceScenario["stage"], D1ApiAssuranceStageReceipt>>;
}

export const MAXIMUM_D1_API_ASSURANCE_SCENARIOS = 1_000;
export const MAXIMUM_D1_API_ASSURANCE_CONCURRENCY = 32;

interface MutableStageReceipt extends D1ApiAssuranceStageReceipt {}

function emptyStageReceipt(): MutableStageReceipt {
  return {
    requests: 0,
    expectedResponses: 0,
    unexpectedStatuses: 0,
    contractFailures: 0,
    privacyLeaks: 0,
    transportFailures: 0,
  };
}

function containsForbiddenValue(
  response: D1ApiAssuranceResponse,
  forbiddenValues: readonly string[],
): boolean {
  const observable = JSON.stringify({ body: response.body, headers: response.headers });
  return forbiddenValues.some((value) => value.length > 0 && observable.includes(value));
}

function snapshotResponse(response: D1ApiAssuranceResponse): D1ApiAssuranceResponse {
  const headers = Object.fromEntries(
    Object.entries(response.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? Object.freeze([...value]) : value,
    ]),
  );
  return Object.freeze({
    statusCode: response.statusCode,
    body: response.body,
    headers: Object.freeze(headers),
  });
}

function sum(
  stages: Readonly<Record<D1ApiAssuranceScenario["stage"], MutableStageReceipt>>,
  field: keyof D1ApiAssuranceStageReceipt,
): number {
  return stages.steady[field] + stages.fault[field] + stages.recovery[field];
}

/**
 * Executes a bounded, in-process API assurance matrix and returns counts only. Response bodies,
 * request values, identities, and failure details are deliberately excluded from the receipt.
 */
export async function runD1ApiAssurance(options: {
  scenarios: readonly D1ApiAssuranceScenario[];
  concurrency: number;
  forbiddenValues: readonly string[];
}): Promise<D1ApiAssuranceReceipt> {
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > MAXIMUM_D1_API_ASSURANCE_CONCURRENCY
  ) {
    throw new TypeError(
      `D1 API assurance concurrency must be between 1 and ${MAXIMUM_D1_API_ASSURANCE_CONCURRENCY}`,
    );
  }
  if (
    options.scenarios.length === 0 ||
    options.scenarios.length > MAXIMUM_D1_API_ASSURANCE_SCENARIOS
  ) {
    throw new TypeError(
      `D1 API assurance requires between 1 and ${MAXIMUM_D1_API_ASSURANCE_SCENARIOS} scenarios`,
    );
  }
  if (
    options.forbiddenValues.length === 0 ||
    options.forbiddenValues.some((value) => value.trim().length === 0)
  ) {
    throw new TypeError("D1 API assurance requires at least one non-empty forbidden value");
  }

  const stages = {
    steady: emptyStageReceipt(),
    fault: emptyStageReceipt(),
    recovery: emptyStageReceipt(),
  };
  let nextScenario = 0;
  let inFlight = 0;
  let maximumInFlight = 0;

  const worker = async () => {
    while (nextScenario < options.scenarios.length) {
      const scenario = options.scenarios[nextScenario];
      nextScenario += 1;
      if (!scenario) continue;

      const receipt = stages[scenario.stage];
      receipt.requests += 1;
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      try {
        const response = await scenario.execute();
        const snapshot = snapshotResponse(response);
        if (snapshot.statusCode === scenario.expectedStatus) {
          receipt.expectedResponses += 1;
        } else {
          receipt.unexpectedStatuses += 1;
        }
        try {
          if (containsForbiddenValue(snapshot, options.forbiddenValues)) {
            receipt.privacyLeaks += 1;
          }
        } catch {
          receipt.contractFailures += 1;
        }
        try {
          if (!scenario.validate(snapshot)) {
            receipt.contractFailures += 1;
          }
        } catch {
          receipt.contractFailures += 1;
        }
      } catch {
        receipt.transportFailures += 1;
      } finally {
        inFlight -= 1;
      }
    }
  };

  const workerCount = Math.min(options.concurrency, options.scenarios.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return Object.freeze({
    schemaVersion: 1,
    dataClassification: "synthetic",
    requests: sum(stages, "requests"),
    expectedResponses: sum(stages, "expectedResponses"),
    unexpectedStatuses: sum(stages, "unexpectedStatuses"),
    contractFailures: sum(stages, "contractFailures"),
    privacyLeaks: sum(stages, "privacyLeaks"),
    transportFailures: sum(stages, "transportFailures"),
    maximumInFlight,
    configuredConcurrency: options.concurrency,
    stages: Object.freeze({
      steady: Object.freeze({ ...stages.steady }),
      fault: Object.freeze({ ...stages.fault }),
      recovery: Object.freeze({ ...stages.recovery }),
    }),
  });
}
