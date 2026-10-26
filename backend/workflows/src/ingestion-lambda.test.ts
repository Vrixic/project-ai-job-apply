import { createHash } from "node:crypto";
import { ashbyExactBoardProfile } from "@ai-job-apply/ingestion-worker";
import { durableIngestionExecutionName } from "@ai-job-apply/jobs-service";
import type { EventBridgeEvent, SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  AwsIngestionDurableStatusReader,
  activity,
  assertIngestionActivityDispatch,
  buildIngestionDispatchNudge,
  createIngestionStarterHandler,
  createIngestionTerminalHandler,
  createModeratedSourceExecutionGate,
  generatedSyntheticConfigSha256,
  generatedSyntheticSourceMayRun,
  hourlyIngestionScheduleSlot,
  parseProviderSourceConfigurations,
  preflightProviderSourceConfigurations,
  publishClaimedIngestionDispatch,
  requireInvokedActivityVersionArn,
  requireScheduledEvent,
  runIngestionProviderFailureActivity,
  safeIngestionTransportErrorCode,
  verifyIngestionDispatchNudge,
} from "./ingestion-lambda.js";
import { INGESTION_PROVIDER_FAILURE_FIXTURE_KIND } from "./ingestion-provider-failure-durable.js";

const dispatchId = "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d";
const executionId = "a".repeat(64);
const executionName = durableIngestionExecutionName(executionId, 1);
const durableFunctionArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:7";
const activityFunctionArn =
  "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:9";
const adapterConfigSha256 = generatedSyntheticConfigSha256("foundation01");
const queueBoundary = {
  queueArn: "arn:aws:sqs:us-east-2:123456789012:synthetic-ingestion",
  accountId: "123456789012",
  region: "us-east-2",
} as const;

function sqs(body: string): SQSEvent {
  return {
    Records: [
      {
        messageId: "message-1",
        receiptHandle: "synthetic",
        body,
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: "0",
          SenderId: "synthetic",
          ApproximateFirstReceiveTimestamp: "0",
        },
        messageAttributes: {},
        md5OfBody: createHash("md5").update(body, "utf8").digest("hex"),
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-2:123456789012:synthetic-ingestion",
        awsRegion: "us-east-2",
      },
    ],
  };
}

describe("ingestion Lambda transport", () => {
  it("runs the exact provider-failure activity contract without runtime or provider I/O", async () => {
    const fixtureInput = {
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
      runId: "3f4d7a90-c1b2-4e6f-8a9b-0123456789ab",
      reviewedConfigSha256: "a".repeat(64),
      releaseSourceSha: "b".repeat(40),
    } as const;
    await expect(
      runIngestionProviderFailureActivity({ ...fixtureInput, attempt: 1 }),
    ).resolves.toEqual({
      schemaVersion: 1,
      fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
      attempt: 1,
      status: "retry",
      reason: "source_unavailable",
      retryAfterMs: 1_000,
      providerRequests: 0,
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
    });
    await expect(
      runIngestionProviderFailureActivity({ ...fixtureInput, attempt: 2 }),
    ).resolves.toEqual({
      schemaVersion: 1,
      fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
      attempt: 2,
      status: "succeeded",
      providerRequests: 0,
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
    });
    await expect(
      runIngestionProviderFailureActivity({ ...fixtureInput, attempt: 3 }),
    ).rejects.toThrow("IngestionProviderFailureActivityInputRejected");
    await expect(
      runIngestionProviderFailureActivity({ ...fixtureInput, attempt: 1, raw: "provider" }),
    ).rejects.toThrow("IngestionProviderFailureActivityInputRejected");

    const previousVersion = process.env.AWS_LAMBDA_FUNCTION_VERSION;
    process.env.AWS_LAMBDA_FUNCTION_VERSION = "9";
    try {
      await expect(
        activity(
          { ...fixtureInput, attempt: 1 },
          { invokedFunctionArn: activityFunctionArn } as never,
          vi.fn(),
        ),
      ).resolves.toMatchObject({
        fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
        attempt: 1,
        status: "retry",
        providerRequests: 0,
      });
    } finally {
      if (previousVersion === undefined) delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
      else process.env.AWS_LAMBDA_FUNCTION_VERSION = previousVersion;
    }
  });

  it("binds the generated-synthetic adapter and policy configuration into one digest", () => {
    expect(adapterConfigSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(generatedSyntheticConfigSha256("foundation02")).not.toBe(adapterConfigSha256);
    expect(() => generatedSyntheticConfigSha256("candidate@example.test")).toThrow(
      "IngestionSyntheticConfigRejected",
    );
  });

  it("parses exact provider configurations and refuses activation without authority", () => {
    const configurations = [
      {
        schemaVersion: 1,
        provider: "greenhouse",
        sourceId: "greenhouse-approved-board",
        enabled: true,
        boardToken: "approved_board",
        companyName: "Approved Company",
        verifiedCompanyDomain: "approved.example",
      },
      {
        schemaVersion: 1,
        provider: "lever",
        sourceId: "lever-approved-site",
        enabled: false,
        site: "approved-site",
        region: "eu",
        companyName: "Approved EU Company",
        verifiedCompanyDomain: "eu.approved.example",
      },
      {
        schemaVersion: 1,
        provider: "ashby",
        sourceId: "ashby-approved-board",
        enabled: false,
        jobBoardName: "approved-board",
        companyName: "Approved Ashby Company",
        verifiedCompanyDomain: "ashby.approved.example",
      },
    ];
    expect(() => parseProviderSourceConfigurations(JSON.stringify(configurations), false)).toThrow(
      "IngestionProviderConfigurationRejected",
    );
    const parsed = parseProviderSourceConfigurations(JSON.stringify(configurations), true);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((source) => source.registration.provider)).toEqual([
      "greenhouse",
      "lever",
      "ashby",
    ]);
    expect(new Set(parsed.map((source) => source.adapterConfigSha256)).size).toBe(3);
    expect(parsed.every((source) => /^[a-f0-9]{64}$/u.test(source.adapterConfigSha256))).toBe(true);
    expect(ashbyExactBoardProfile).toEqual({
      version: "ashby-exact-board-v1",
      maximumResponseBytes: 16_000_000,
      maximumJobs: 1_000,
      maximumRecordBytes: 512_000,
      maximumEnvelopeValueBytes: 64_000,
      maximumDepth: 32,
      maximumRootFields: 16,
      requestTimeoutMs: 5_000,
    });
    expect(Object.isFrozen(ashbyExactBoardProfile)).toBe(true);
    for (const [index, configuration] of configurations.entries()) {
      const source = parsed[index];
      if (!source) throw new Error("Missing synthetic configuration");
      const legacyFields = [
        "schemaVersion=1",
        `sourceId=${configuration.sourceId}`,
        `provider=${configuration.provider}`,
        `adapterVersion=${source.registration.adapter.adapterVersion}`,
        "provenance=permitted_api",
        `companyName=${configuration.companyName}`,
        `verifiedCompanyDomain=${configuration.verifiedCompanyDomain}`,
        ...(configuration.provider === "greenhouse"
          ? [configuration.boardToken]
          : configuration.provider === "lever"
            ? [configuration.site, configuration.region]
            : [configuration.jobBoardName]),
        "maximumObservations=100",
        "requestTimeoutMs=5000",
        "maximumResponseBytes=1000000",
      ];
      const hash = (fields: readonly (string | undefined)[]) =>
        createHash("sha256")
          .update([...fields, ""].join("\n"), "utf8")
          .digest("hex");
      if (configuration.provider !== "ashby") {
        expect(source.adapterConfigSha256).toBe(hash(legacyFields));
      } else {
        expect(source.adapterConfigSha256).not.toBe(hash(legacyFields));
        expect(source.adapterConfigSha256).toBe(
          hash([
            ...legacyFields,
            ...Object.entries(ashbyExactBoardProfile).map(
              ([key, value]) => `exactVerification.${key}=${value}`,
            ),
          ]),
        );
        for (const [omitted] of Object.entries(ashbyExactBoardProfile)) {
          expect(source.adapterConfigSha256).not.toBe(
            hash([
              ...legacyFields,
              ...Object.entries(ashbyExactBoardProfile)
                .filter(([key]) => key !== omitted)
                .map(([key, value]) => `exactVerification.${key}=${value}`),
            ]),
          );
        }
        expect(source.registration.adapter.pollExact).toBeTypeOf("function");
        expect(source.registration.enabled).toBe(false);
      }
    }
    expect(() =>
      parseProviderSourceConfigurations(
        JSON.stringify([{ ...configurations[0], unexpected: "field" }]),
        true,
      ),
    ).toThrow("IngestionProviderConfigurationRejected");
    expect(() => parseProviderSourceConfigurations("not-json", true)).toThrow(
      "IngestionProviderConfigurationRejected",
    );
    expect(() =>
      parseProviderSourceConfigurations(
        JSON.stringify(
          Array.from({ length: 9 }, (_, index) => ({
            schemaVersion: 1,
            provider: "ashby",
            sourceId: `ashby-board-${index}`,
            enabled: false,
            jobBoardName: `board-${index}`,
            companyName: `Company ${index}`,
            verifiedCompanyDomain: `company-${index}.example`,
          })),
        ),
        false,
      ),
    ).toThrow("IngestionProviderConfigurationRejected");
  });

  it("preflights only default-off provider configurations with safe activation metadata", () => {
    const configuration = [
      {
        schemaVersion: 1,
        provider: "lever",
        sourceId: "lever-reviewed-site",
        enabled: false,
        site: "reviewed-site",
        region: "global",
        companyName: "Reviewed Company",
        verifiedCompanyDomain: "reviewed.example",
      },
    ];
    const result = preflightProviderSourceConfigurations(JSON.stringify(configuration));
    expect(result).toEqual([
      {
        provider: "lever",
        sourceId: "lever-reviewed-site",
        adapterVersion: "lever-postings-v1",
        adapterConfigSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    ]);
    expect(result[0]).not.toHaveProperty("companyName");
    expect(result[0]).not.toHaveProperty("verifiedCompanyDomain");
    expect(() =>
      preflightProviderSourceConfigurations(
        JSON.stringify([{ ...configuration[0], enabled: true }]),
      ),
    ).toThrow("IngestionProviderConfigurationRejected");
  });

  it("binds runtime execution to the exact persisted source-pause identity", async () => {
    const isSourcePaused = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("raw database detail"));
    const gate = createModeratedSourceExecutionGate(
      { isSourcePaused },
      {
        sourceId: "synthetic-foundation-v1",
        adapterVersion: "synthetic-ingestion-v1",
        adapterConfigSha256,
      },
    );
    const identity = {
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
    } as const;

    await expect(gate(identity)).resolves.toBe(true);
    await expect(gate(identity)).resolves.toBe(false);
    await expect(gate(identity)).rejects.toThrow("IngestionSourceControlUnavailable");
    await expect(gate({ ...identity, adapterVersion: "synthetic-ingestion-v2" })).resolves.toBe(
      false,
    );
    expect(isSourcePaused).toHaveBeenCalledTimes(3);
    expect(isSourcePaused).toHaveBeenCalledWith({
      kind: "source",
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      adapterConfigSha256,
    });
    expect(() =>
      createModeratedSourceExecutionGate(
        { isSourcePaused },
        { ...identity, adapterConfigSha256: "not-a-digest" },
      ),
    ).toThrow("moderated source execution identity");
  });

  it("binds each configured provider to its own persisted pause identity", async () => {
    const isSourcePaused = vi.fn().mockResolvedValue(false);
    const gate = createModeratedSourceExecutionGate({ isSourcePaused }, [
      {
        sourceId: "greenhouse-approved-board",
        adapterVersion: "greenhouse-job-board-v1",
        adapterConfigSha256: "b".repeat(64),
      },
      {
        sourceId: "lever-approved-site",
        adapterVersion: "lever-postings-v1",
        adapterConfigSha256: "c".repeat(64),
      },
    ]);
    await expect(
      gate({ sourceId: "lever-approved-site", adapterVersion: "lever-postings-v1" }),
    ).resolves.toBe(true);
    await expect(
      gate({ sourceId: "ashby-absent-board", adapterVersion: "ashby-job-board-v1" }),
    ).resolves.toBe(false);
    expect(isSourcePaused).toHaveBeenCalledWith({
      kind: "source",
      sourceId: "lever-approved-site",
      adapterVersion: "lever-postings-v1",
      adapterConfigSha256: "c".repeat(64),
    });
  });

  it("requires both static activation and the persisted source control before scheduling", async () => {
    const sourceExecutionGate = vi.fn().mockResolvedValue(true);

    await expect(generatedSyntheticSourceMayRun(false, sourceExecutionGate)).resolves.toBe(false);
    expect(sourceExecutionGate).not.toHaveBeenCalled();
    await expect(generatedSyntheticSourceMayRun(true, sourceExecutionGate)).resolves.toBe(true);
    sourceExecutionGate.mockResolvedValue(false);
    await expect(generatedSyntheticSourceMayRun(true, sourceExecutionGate)).resolves.toBe(false);
  });

  it("reconciles every five minutes while deriving one exact hourly occurrence", () => {
    expect(hourlyIngestionScheduleSlot("2026-08-16T12:37:05.123Z")).toBe(
      "2026-08-16T12:00:00.000Z",
    );
    expect(hourlyIngestionScheduleSlot("2026-08-16T12:37:05Z")).toBe("2026-08-16T12:00:00.000Z");
    expect(() => hourlyIngestionScheduleSlot("2026-02-30T12:37:05Z")).toThrow();
    const previousRule = process.env.INGESTION_SCHEDULE_RULE_ARN;
    const previousAccount = process.env.AWS_ACCOUNT_ID;
    const previousRegion = process.env.AWS_REGION;
    const scheduleRuleArn = "arn:aws:events:us-east-2:123456789012:rule/synthetic-ingestion";
    process.env.INGESTION_SCHEDULE_RULE_ARN = scheduleRuleArn;
    process.env.AWS_ACCOUNT_ID = "123456789012";
    process.env.AWS_REGION = "us-east-2";
    try {
      const event: EventBridgeEvent<"Scheduled Event", Record<string, never>> = {
        version: "0",
        id: "cdc73e6b-040d-5c4d-6c45-f222a4aa2d4a",
        "detail-type": "Scheduled Event",
        source: "aws.events",
        account: "123456789012",
        time: "2026-08-16T12:37:05Z",
        region: "us-east-2",
        resources: [scheduleRuleArn],
        detail: {},
      };
      const now = new Date("2026-08-16T12:38:00.000Z");
      expect(() => requireScheduledEvent(event, now)).not.toThrow();
      expect(() => requireScheduledEvent({ ...event, time: "2026-08-16T13:00:00Z" }, now)).toThrow(
        "IngestionScheduleEventRejected",
      );
      expect(() => requireScheduledEvent({ ...event, time: "2026-08-16T11:30:00Z" }, now)).toThrow(
        "IngestionScheduleEventRejected",
      );
      expect(() => requireScheduledEvent({ ...event, account: "999999999999" }, now)).toThrow(
        "IngestionScheduleEventRejected",
      );
      expect(() => requireScheduledEvent({ ...event, unexpected: "raw" } as never, now)).toThrow(
        "IngestionScheduleEventRejected",
      );
    } finally {
      if (previousRule === undefined) delete process.env.INGESTION_SCHEDULE_RULE_ARN;
      else process.env.INGESTION_SCHEDULE_RULE_ARN = previousRule;
      if (previousAccount === undefined) delete process.env.AWS_ACCOUNT_ID;
      else process.env.AWS_ACCOUNT_ID = previousAccount;
      if (previousRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = previousRegion;
    }
  });

  it("uses only fixed transport failure codes", () => {
    expect(safeIngestionTransportErrorCode({ name: "TooManyRequestsException" })).toBe(
      "TooManyRequestsException",
    );
    expect(safeIngestionTransportErrorCode({ name: "candidate@example.test" })).toBe(
      "IngestionDispatchFailure",
    );
  });

  it("reconciles durable status without requesting or accepting execution data", async () => {
    const executionArn = `${durableFunctionArn}/durable-execution/${executionName}/opaqueExecution01`;
    const metadata = {
      ExecutionDataIncluded: false,
      DurableExecutionArn: executionArn,
      DurableExecutionName: executionName,
      FunctionArn: durableFunctionArn.replace(/:7$/u, ""),
      Version: "7",
      StartTimestamp: new Date("2026-08-16T12:00:00.000Z"),
    };
    for (const status of ["RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED"] as const) {
      const send = vi.fn().mockResolvedValue({
        ...metadata,
        Status: status,
        ...(status === "RUNNING" ? {} : { EndTimestamp: new Date("2026-08-16T12:01:00.000Z") }),
      });
      await expect(
        new AwsIngestionDurableStatusReader({ send }).getStatus(executionArn),
      ).resolves.toBe(status);
      expect(send.mock.calls[0]?.[0].input).toEqual({
        DurableExecutionArn: executionArn,
        IncludeExecutionData: false,
      });
    }
    await expect(
      new AwsIngestionDurableStatusReader({
        send: vi.fn().mockResolvedValue({
          ...metadata,
          Status: "FAILED",
          EndTimestamp: new Date("2026-08-16T12:01:00.000Z"),
          Error: { ErrorMessage: "raw" },
        }),
      }).getStatus(executionArn),
    ).rejects.toThrow("IngestionDurableReconciliationRejected");
    await expect(
      new AwsIngestionDurableStatusReader({
        send: vi.fn().mockResolvedValue({
          ...metadata,
          Status: "FAILED",
          EndTimestamp: new Date("2026-08-16T11:59:59.000Z"),
        }),
      }).getStatus(executionArn),
    ).rejects.toThrow("IngestionDurableReconciliationRejected");
    const longOpaqueArn = `${durableFunctionArn}/durable-execution/${executionName}/${"a".repeat(256)}`;
    await expect(
      new AwsIngestionDurableStatusReader({
        send: vi.fn().mockResolvedValue({
          ...metadata,
          DurableExecutionArn: longOpaqueArn,
          Status: "RUNNING",
        }),
      }).getStatus(longOpaqueArn),
    ).resolves.toBe("RUNNING");
    for (const name of [
      "ResourceNotFoundException",
      "TooManyRequestsException",
      "ServiceException",
    ]) {
      await expect(
        new AwsIngestionDurableStatusReader({
          send: vi.fn().mockRejectedValue(Object.assign(new Error("raw"), { name })),
        }).getStatus(executionArn),
      ).rejects.toThrow("IngestionDurableReconciliationUnavailable");
    }
  });

  it("leaves a content-free trace of what the durable status call failed with", async () => {
    const executionArn = `${durableFunctionArn}/durable-execution/${executionName}/opaqueExecution01`;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        new AwsIngestionDurableStatusReader({
          send: vi.fn().mockRejectedValue(
            Object.assign(new Error("raw message with an address"), {
              name: "AccessDeniedException",
              $metadata: { httpStatusCode: 403 },
            }),
          ),
        }).getStatus(executionArn),
      ).rejects.toThrow("IngestionDurableReconciliationUnavailable");
      expect(error).toHaveBeenCalledWith({
        event: "ingestion_durable_status_failed",
        errorName: "AccessDeniedException",
        httpStatus: 403,
      });
      expect(JSON.stringify(error.mock.calls)).not.toContain("address");
    } finally {
      error.mockRestore();
    }
  });

  it("builds and verifies an exact identifier-only integrity-bound nudge", () => {
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    });
    expect(verifyIngestionDispatchNudge(nudge)).toBe(true);
    expect(verifyIngestionDispatchNudge({ ...nudge, workflowGeneration: 2 })).toBe(false);
    expect(
      verifyIngestionDispatchNudge({ ...nudge, sourceUrl: "https://jobs.example.test/raw" }),
    ).toBe(false);
    expect(Object.keys(nudge).sort()).toEqual([
      "checkpointRevision",
      "dispatchId",
      "executionId",
      "integrity",
      "schemaVersion",
      "workflowGeneration",
    ]);
  });

  it("never records an accepted SQS send as a false publish failure", async () => {
    const dispatch = {
      id: dispatchId,
      executionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: executionName,
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
      state: "claimed",
      publishAttempts: 0,
      nextAttemptAt: new Date(),
    } as const;
    const recordDispatchFailure = vi.fn();
    await expect(
      publishClaimedIngestionDispatch(
        dispatch,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e2e",
        { publish: vi.fn().mockResolvedValue(undefined) },
        {
          recordDispatchNudged: vi.fn().mockRejectedValue(new Error("database unavailable")),
          recordDispatchFailure,
        } as never,
      ),
    ).resolves.toEqual({ accepted: true, confirmed: false });
    expect(recordDispatchFailure).not.toHaveBeenCalled();

    const publishError = Object.assign(new Error("opaque transport failure"), {
      name: "TimeoutError",
    });
    await expect(
      publishClaimedIngestionDispatch(
        dispatch,
        "018f47a6-7b2c-7ee1-8c09-3ea174e80e2e",
        { publish: vi.fn().mockRejectedValue(publishError) },
        {
          recordDispatchNudged: vi.fn(),
          recordDispatchFailure,
        } as never,
      ),
    ).resolves.toEqual({ accepted: false, confirmed: false });
    expect(recordDispatchFailure).toHaveBeenCalledWith(
      dispatchId,
      "018f47a6-7b2c-7ee1-8c09-3ea174e80e2e",
      "TimeoutError",
    );
  });

  it("starts only the authoritative nudged dispatch and records the accepted ARN", async () => {
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    });
    const recordDurableStart = vi.fn().mockResolvedValue(undefined);
    const store = {
      confirmDispatchDelivery: vi.fn().mockResolvedValue({
        id: dispatchId,
        executionId,
        generation: 1,
        checkpointRevision: 0,
        durableExecutionName: executionName,
        durableFunctionArn,
        activityFunctionArn,
        adapterConfigSha256,
        state: "nudged",
        publishAttempts: 1,
        nextAttemptAt: new Date(),
      }),
      recordDurableStart,
    };
    const start = vi.fn().mockResolvedValue({
      executionArn: `${durableFunctionArn}/durable-execution/${executionName}/opaqueExecution01`,
    });
    const handler = createIngestionStarterHandler(
      store as never,
      { start },
      durableFunctionArn,
      activityFunctionArn,
      queueBoundary,
    );
    const result = await handler(sqs(JSON.stringify(nudge)));
    expect(result).toEqual({ batchItemFailures: [] });
    expect(store.confirmDispatchDelivery).toHaveBeenCalledWith(nudge, {
      durableFunctionArn,
      activityFunctionArn,
    });
    expect(start).toHaveBeenCalledWith(durableFunctionArn, executionName, {
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      dispatchId,
      executionId,
      workflowGeneration: 1,
    });
    expect(recordDurableStart).toHaveBeenCalledTimes(1);
  });

  it("rejects an unauthenticated queue envelope and body digest before database I/O", async () => {
    const confirmDispatchDelivery = vi.fn();
    const start = vi.fn();
    const handler = createIngestionStarterHandler(
      { confirmDispatchDelivery, recordDurableStart: vi.fn() } as never,
      { start },
      durableFunctionArn,
      activityFunctionArn,
      queueBoundary,
    );
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    });
    const wrongQueue = sqs(JSON.stringify(nudge));
    const wrongQueueRecord = wrongQueue.Records[0];
    if (!wrongQueueRecord) throw new Error("missing queue record");
    wrongQueueRecord.eventSourceARN = "arn:aws:sqs:us-east-2:999999999999:synthetic-ingestion";
    await expect(handler(wrongQueue)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    const wrongDigest = sqs(JSON.stringify(nudge));
    const wrongDigestRecord = wrongDigest.Records[0];
    if (!wrongDigestRecord) throw new Error("missing queue record");
    wrongDigestRecord.md5OfBody = "0".repeat(32);
    await expect(handler(wrongDigest)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "message-1" }],
    });
    await expect(handler({ Records: [] })).rejects.toThrow("IngestionQueueBoundaryRejected");
    expect(confirmDispatchDelivery).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a retained numeric workflow version but rejects another function family", async () => {
    const retainedDurableFunctionArn =
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:6";
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    });
    const dispatch = {
      id: dispatchId,
      executionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: executionName,
      durableFunctionArn: retainedDurableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
      state: "nudged",
      publishAttempts: 1,
      nextAttemptAt: new Date(),
    } as const;
    const start = vi.fn().mockResolvedValue({
      executionArn: `${retainedDurableFunctionArn}/durable-execution/${executionName}/opaqueExecution01`,
    });
    const recordDurableStart = vi.fn().mockResolvedValue(undefined);
    await expect(
      createIngestionStarterHandler(
        {
          confirmDispatchDelivery: vi.fn().mockResolvedValue(dispatch),
          recordDurableStart,
        } as never,
        { start },
        durableFunctionArn,
        activityFunctionArn,
        queueBoundary,
      )(sqs(JSON.stringify(nudge))),
    ).resolves.toEqual({ batchItemFailures: [] });
    expect(start).toHaveBeenCalledWith(
      retainedDurableFunctionArn,
      executionName,
      expect.any(Object),
    );

    const wrongFamily = {
      ...dispatch,
      durableFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:other-ingestion:6",
    };
    start.mockClear();
    await expect(
      createIngestionStarterHandler(
        {
          confirmDispatchDelivery: vi.fn().mockResolvedValue(wrongFamily),
          recordDurableStart,
        } as never,
        { start },
        durableFunctionArn,
        activityFunctionArn,
        queueBoundary,
      )(sqs(JSON.stringify(nudge))),
    ).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(start).not.toHaveBeenCalled();
  });

  it("returns only the message identifier when database truth disagrees", async () => {
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    });
    const store = {
      confirmDispatchDelivery: vi.fn().mockResolvedValue({
        id: dispatchId,
        executionId,
        generation: 2,
        checkpointRevision: 0,
        durableExecutionName: executionName,
        state: "nudged",
      }),
      recordDurableStart: vi.fn(),
    };
    const start = vi.fn();
    await expect(
      createIngestionStarterHandler(
        store as never,
        { start },
        durableFunctionArn,
        activityFunctionArn,
        queueBoundary,
      )(sqs(JSON.stringify(nudge))),
    ).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(start).not.toHaveBeenCalled();
  });

  it("starts an exact delivered nudge promoted from transport recovery exhaustion", async () => {
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: 1,
    });
    const recordDurableStart = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue({
      executionArn: `${durableFunctionArn}/durable-execution/${executionName}/opaqueExecution01`,
    });
    await expect(
      createIngestionStarterHandler(
        {
          confirmDispatchDelivery: vi.fn().mockResolvedValue({
            id: dispatchId,
            executionId,
            generation: 1,
            checkpointRevision: 0,
            durableExecutionName: executionName,
            durableFunctionArn,
            activityFunctionArn,
            adapterConfigSha256,
            state: "nudged",
            publishAttempts: 5,
            nextAttemptAt: new Date(),
          }),
          recordDurableStart,
        } as never,
        { start },
        durableFunctionArn,
        activityFunctionArn,
        queueBoundary,
      )(sqs(JSON.stringify(nudge))),
    ).resolves.toEqual({ batchItemFailures: [] });
    expect(start).toHaveBeenCalledTimes(1);
    expect(recordDurableStart).toHaveBeenCalledTimes(1);
  });

  it("acknowledges an exact stale nudge after generation recovery was exhausted", async () => {
    const generation = 20;
    const generationName = durableIngestionExecutionName(executionId, generation);
    const nudge = buildIngestionDispatchNudge({
      dispatchId,
      executionId,
      checkpointRevision: 0,
      workflowGeneration: generation,
    });
    const start = vi.fn();
    await expect(
      createIngestionStarterHandler(
        {
          confirmDispatchDelivery: vi.fn().mockResolvedValue({
            id: dispatchId,
            executionId,
            generation,
            checkpointRevision: 0,
            durableExecutionName: generationName,
            durableFunctionArn,
            activityFunctionArn,
            adapterConfigSha256,
            state: "recovery_exhausted",
            publishAttempts: 5,
            lastErrorCode: "RecoveryGenerationLimit",
            nextAttemptAt: new Date(),
          }),
          recordDurableStart: vi.fn(),
        } as never,
        { start },
        durableFunctionArn,
        activityFunctionArn,
        queueBoundary,
      )(sqs(JSON.stringify(nudge))),
    ).resolves.toEqual({ batchItemFailures: [] });
    expect(start).not.toHaveBeenCalled();
  });

  it("binds a real terminal event shape to account, region, time, version, and opaque execution id", async () => {
    const retainedDurableFunctionArn =
      "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion:6";
    const executionArn = `${retainedDurableFunctionArn}/durable-execution/${executionName}/opaqueExecution01`;
    const recordDurableTerminal = vi.fn().mockResolvedValue({
      executionId,
      generation: 1,
    });
    const ensureRecoveryDispatch = vi.fn().mockResolvedValue(undefined);
    const handler = createIngestionTerminalHandler(
      { recordDurableTerminal, ensureRecoveryDispatch } as never,
      {
        account: "123456789012",
        region: "us-east-2",
        currentDurableFunctionArn: durableFunctionArn,
        currentActivityFunctionArn: activityFunctionArn,
        currentAdapterConfigSha256: adapterConfigSha256,
        now: () => new Date("2026-08-16T12:01:00.000Z"),
        dispatchId: () => "018f47a6-7b2c-7ee1-8c09-3ea174e80e30",
      },
    );
    const event = {
      version: "0",
      id: "d019b03c-a8a3-9d58-85de-241e96206538",
      "detail-type": "Durable Execution Status Change",
      source: "aws.lambda",
      account: "123456789012",
      time: "2026-08-16T12:00:05Z",
      region: "us-east-2",
      resources: [retainedDurableFunctionArn],
      detail: {
        durableExecutionArn: executionArn,
        durableExecutionName: executionName,
        functionArn: retainedDurableFunctionArn,
        status: "FAILED",
        startTimestamp: "2026-08-16T12:00:00.000Z",
        endTimestamp: "2026-08-16T12:00:04.000Z",
      },
    };
    await expect(handler(event)).resolves.toEqual({ handled: true });
    expect(recordDurableTerminal).toHaveBeenCalledWith(
      executionName,
      "FAILED",
      executionArn,
      retainedDurableFunctionArn,
    );
    expect(ensureRecoveryDispatch).toHaveBeenCalledWith(
      executionId,
      1,
      "018f47a6-7b2c-7ee1-8c09-3ea174e80e30",
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
    );
    ensureRecoveryDispatch.mockClear();
    const resolveDisabledSource = vi.fn().mockResolvedValue(undefined);
    const successHandler = createIngestionTerminalHandler(
      { recordDurableTerminal, ensureRecoveryDispatch } as never,
      {
        account: "123456789012",
        region: "us-east-2",
        currentDurableFunctionArn: durableFunctionArn,
        currentActivityFunctionArn: activityFunctionArn,
        currentAdapterConfigSha256: resolveDisabledSource,
        now: () => new Date("2026-08-16T12:01:00.000Z"),
      },
    );
    await expect(
      successHandler({ ...event, detail: { ...event.detail, status: "SUCCEEDED" } }),
    ).resolves.toEqual({ handled: true });
    expect(resolveDisabledSource).not.toHaveBeenCalled();
    expect(ensureRecoveryDispatch).not.toHaveBeenCalled();
    const pauseDisabledSource = vi.fn().mockResolvedValue(true);
    const disabledFailureHandler = createIngestionTerminalHandler(
      { recordDurableTerminal, ensureRecoveryDispatch } as never,
      {
        account: "123456789012",
        region: "us-east-2",
        currentDurableFunctionArn: durableFunctionArn,
        currentActivityFunctionArn: activityFunctionArn,
        currentAdapterConfigSha256: resolveDisabledSource,
        pauseDisabledSource,
        now: () => new Date("2026-08-16T12:01:00.000Z"),
      },
    );
    await expect(disabledFailureHandler(event)).resolves.toEqual({ handled: true });
    expect(pauseDisabledSource).toHaveBeenCalledTimes(1);
    expect(pauseDisabledSource).toHaveBeenCalledWith(executionId);
    expect(ensureRecoveryDispatch).not.toHaveBeenCalled();
    pauseDisabledSource.mockResolvedValue(false);
    await expect(disabledFailureHandler(event)).rejects.toThrow(
      "IngestionTerminalConfigurationRejected",
    );
    await expect(handler({ ...event, account: "999999999999" })).rejects.toThrow(
      "IngestionTerminalEventRejected",
    );
    await expect(
      handler({ ...event, detail: { ...event.detail, unexpected: "raw" } }),
    ).rejects.toThrow("IngestionTerminalEventRejected");
    await expect(handler({ ...event, resources: [] })).rejects.toThrow(
      "IngestionTerminalEventRejected",
    );
    await expect(handler({ ...event, resources: [durableFunctionArn] })).rejects.toThrow(
      "IngestionTerminalEventRejected",
    );
    await expect(
      successHandler({
        ...event,
        time: "2026-08-03T12:00:05Z",
        detail: {
          ...event.detail,
          status: "SUCCEEDED",
          startTimestamp: "2026-08-03T12:00:00.000Z",
          endTimestamp: "2026-08-03T12:00:04.000Z",
        },
      }),
    ).resolves.toEqual({ handled: true });
    await expect(
      handler({
        ...event,
        time: "2026-08-02T12:00:00Z",
        detail: {
          ...event.detail,
          startTimestamp: "2026-08-02T11:59:59.000Z",
          endTimestamp: "2026-08-02T12:00:00Z",
        },
      }),
    ).rejects.toThrow("IngestionTerminalEventRejected");
    await expect(
      handler({
        ...event,
        detail: {
          ...event.detail,
          endTimestamp: "2026-08-16T11:45:00Z",
        },
      }),
    ).rejects.toThrow("IngestionTerminalEventRejected");
    await expect(
      createIngestionTerminalHandler({ recordDurableTerminal, ensureRecoveryDispatch } as never, {
        account: "123456789012",
        region: "us-east-2",
        currentDurableFunctionArn: durableFunctionArn,
        currentActivityFunctionArn: activityFunctionArn,
        currentAdapterConfigSha256: adapterConfigSha256,
        now: () => new Date(Number.NaN),
      })(event),
    ).rejects.toThrow("IngestionTerminalConfigurationRejected");
  });

  it("requires the exact numeric activity version invoked by Lambda", () => {
    const previous = process.env.AWS_LAMBDA_FUNCTION_VERSION;
    process.env.AWS_LAMBDA_FUNCTION_VERSION = "9";
    try {
      expect(requireInvokedActivityVersionArn({ invokedFunctionArn: activityFunctionArn })).toBe(
        activityFunctionArn,
      );
      expect(() =>
        requireInvokedActivityVersionArn({
          invokedFunctionArn:
            "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:8",
        }),
      ).toThrow("IngestionActivityVersionRejected");
      delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
      expect(() =>
        requireInvokedActivityVersionArn({ invokedFunctionArn: activityFunctionArn }),
      ).toThrow("IngestionActivityVersionRejected");
    } finally {
      if (previous === undefined) delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
      else process.env.AWS_LAMBDA_FUNCTION_VERSION = previous;
    }
  });

  it("fences activity execution to the persisted dispatch generation, version, and adapter config", () => {
    const persisted = {
      id: dispatchId,
      executionId,
      generation: 1,
      checkpointRevision: 0,
      durableExecutionName: executionName,
      durableFunctionArn,
      activityFunctionArn,
      adapterConfigSha256,
      state: "started",
      publishAttempts: 1,
      nextAttemptAt: new Date(),
    } as const;
    expect(() =>
      assertIngestionActivityDispatch(
        persisted,
        { dispatchId, executionId, workflowGeneration: 1 },
        activityFunctionArn,
        adapterConfigSha256,
      ),
    ).not.toThrow();
    for (const candidate of [
      {
        input: {
          dispatchId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e30",
          executionId,
          workflowGeneration: 1,
        },
      },
      { input: { dispatchId, executionId, workflowGeneration: 2 } },
      {
        input: { dispatchId, executionId, workflowGeneration: 1 },
        activityArn:
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:8",
      },
      {
        input: { dispatchId, executionId, workflowGeneration: 1 },
        configSha256: "d".repeat(64),
      },
    ]) {
      expect(() =>
        assertIngestionActivityDispatch(
          persisted,
          candidate.input,
          candidate.activityArn ?? activityFunctionArn,
          candidate.configSha256 ?? adapterConfigSha256,
        ),
      ).toThrow("IngestionActivityDispatchRejected");
    }
  });
});
