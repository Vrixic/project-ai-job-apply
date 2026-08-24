import { createHash, randomBytes } from "node:crypto";
import {
  type IngestionDispatchNudgeV1,
  ingestionDispatchNudgeIntegrityInput,
  validateIngestionDispatchNudge,
} from "@ai-job-apply/event-contracts";
import {
  AshbyJobBoardAdapter,
  ashbyJobBoardAdapterVersion,
  DurableIngestionCoordinator,
  GeneratedSyntheticIngestionAdapter,
  GreenhouseJobBoardAdapter,
  generatedSyntheticAdapterVersion,
  generatedSyntheticSourceId,
  greenhouseJobBoardAdapterVersion,
  LeverPostingsAdapter,
  leverPostingsAdapterVersion,
  type SourceExecutionGate,
  SourceNeutralIngestionRunner,
  type SourceRegistration,
  SourceRegistry,
} from "@ai-job-apply/ingestion-worker";
import {
  createJobCatalogDatabase,
  durableIngestionExecutionName,
  type IngestionDispatchErrorCode,
  type PersistedIngestionDispatch,
  PostgresIngestionOrchestrationStore,
  PostgresJobCatalog,
  PostgresJobModerationStore,
} from "@ai-job-apply/jobs-service";
import { createLogger } from "@ai-job-apply/observability";
import { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import {
  GetDurableExecutionCommand,
  type GetDurableExecutionCommandOutput,
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type {
  Context,
  EventBridgeEvent,
  Handler,
  SQSBatchResponse,
  SQSEvent,
  SQSRecord,
} from "aws-lambda";
import { v7 as uuidv7 } from "uuid";
import {
  type IngestionActivityResultV1,
  type IngestionWorkflowInputV1,
  isExactNumericLambdaVersionArn,
  validateIngestionActivityInput,
} from "./ingestion-durable.js";

const logger = createLogger({
  service: "ingestion-durable",
  level: "info",
  releaseSha: process.env.RELEASE_SHA ?? "local",
});
const maximumNudgeBytes = 4_096;
const sqsQueueArnPattern =
  /^arn:(aws|aws-us-gov|aws-cn):sqs:([a-z0-9-]+):([0-9]{12}):[A-Za-z0-9_-]{1,80}$/u;

export function generatedSyntheticConfigSha256(seed: string): string {
  if (!/^[a-z0-9]{8,64}$/u.test(seed)) throw new Error("IngestionSyntheticConfigRejected");
  return createHash("sha256")
    .update(
      [
        "schemaVersion=1",
        `sourceId=${generatedSyntheticSourceId}`,
        `adapterVersion=${generatedSyntheticAdapterVersion}`,
        "provider=other",
        "provenance=authorized_fixture",
        "maximumObservations=100",
        `seed=${seed}`,
        "",
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

export type ProviderSourceConfiguration =
  | {
      schemaVersion: 1;
      provider: "greenhouse";
      sourceId: string;
      enabled: boolean;
      boardToken: string;
      companyName: string;
      verifiedCompanyDomain: string;
    }
  | {
      schemaVersion: 1;
      provider: "lever";
      sourceId: string;
      enabled: boolean;
      site: string;
      region: "global" | "eu";
      companyName: string;
      verifiedCompanyDomain: string;
    }
  | {
      schemaVersion: 1;
      provider: "ashby";
      sourceId: string;
      enabled: boolean;
      jobBoardName: string;
      companyName: string;
      verifiedCompanyDomain: string;
    };

interface ConfiguredIngestionSource {
  registration: SourceRegistration;
  adapterConfigSha256: string;
}

export interface ProviderSourcePreflightDescriptor {
  provider: ProviderSourceConfiguration["provider"];
  sourceId: string;
  adapterVersion: string;
  adapterConfigSha256: string;
}

function providerConfigurationDigest(configuration: ProviderSourceConfiguration): string {
  const fields =
    configuration.provider === "greenhouse"
      ? [configuration.boardToken]
      : configuration.provider === "lever"
        ? [configuration.site, configuration.region]
        : [configuration.jobBoardName];
  return createHash("sha256")
    .update(
      [
        "schemaVersion=1",
        `sourceId=${configuration.sourceId}`,
        `provider=${configuration.provider}`,
        `adapterVersion=${
          configuration.provider === "greenhouse"
            ? greenhouseJobBoardAdapterVersion
            : configuration.provider === "lever"
              ? leverPostingsAdapterVersion
              : ashbyJobBoardAdapterVersion
        }`,
        "provenance=permitted_api",
        `companyName=${configuration.companyName.normalize("NFC").trim()}`,
        `verifiedCompanyDomain=${configuration.verifiedCompanyDomain.toLowerCase()}`,
        ...fields,
        "maximumObservations=100",
        "requestTimeoutMs=5000",
        "maximumResponseBytes=1000000",
        "",
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

export function parseProviderSourceConfigurations(
  value: string,
  providerActivationAllowed: boolean,
): readonly ConfiguredIngestionSource[] {
  if (Buffer.byteLength(value, "utf8") > 1_800) {
    throw new Error("IngestionProviderConfigurationRejected");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("IngestionProviderConfigurationRejected");
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new Error("IngestionProviderConfigurationRejected");
  }
  const seen = new Set<string>();
  return Object.freeze(
    parsed.map((candidate): ConfiguredIngestionSource => {
      if (
        !record(candidate) ||
        candidate.schemaVersion !== 1 ||
        typeof candidate.enabled !== "boolean"
      ) {
        throw new Error("IngestionProviderConfigurationRejected");
      }
      const provider = candidate.provider;
      const expectedKeys =
        provider === "greenhouse"
          ? [
              "schemaVersion",
              "provider",
              "sourceId",
              "enabled",
              "boardToken",
              "companyName",
              "verifiedCompanyDomain",
            ]
          : provider === "lever"
            ? [
                "schemaVersion",
                "provider",
                "sourceId",
                "enabled",
                "site",
                "region",
                "companyName",
                "verifiedCompanyDomain",
              ]
            : provider === "ashby"
              ? [
                  "schemaVersion",
                  "provider",
                  "sourceId",
                  "enabled",
                  "jobBoardName",
                  "companyName",
                  "verifiedCompanyDomain",
                ]
              : [];
      if (
        expectedKeys.length === 0 ||
        !hasExactKeys(candidate, expectedKeys) ||
        typeof candidate.sourceId !== "string" ||
        typeof candidate.companyName !== "string" ||
        typeof candidate.verifiedCompanyDomain !== "string" ||
        (candidate.enabled && !providerActivationAllowed) ||
        seen.has(candidate.sourceId)
      ) {
        throw new Error("IngestionProviderConfigurationRejected");
      }
      seen.add(candidate.sourceId);
      const companyName = candidate.companyName.normalize("NFC").trim();
      const verifiedCompanyDomain = candidate.verifiedCompanyDomain
        .normalize("NFC")
        .trim()
        .toLowerCase();
      let configuration: ProviderSourceConfiguration;
      let adapter: SourceRegistration["adapter"];
      if (provider === "greenhouse" && typeof candidate.boardToken === "string") {
        configuration = {
          schemaVersion: 1,
          provider,
          sourceId: candidate.sourceId,
          enabled: candidate.enabled,
          boardToken: candidate.boardToken,
          companyName,
          verifiedCompanyDomain,
        };
        adapter = new GreenhouseJobBoardAdapter(configuration);
      } else if (
        provider === "lever" &&
        typeof candidate.site === "string" &&
        (candidate.region === "global" || candidate.region === "eu")
      ) {
        configuration = {
          schemaVersion: 1,
          provider,
          sourceId: candidate.sourceId,
          enabled: candidate.enabled,
          site: candidate.site,
          region: candidate.region,
          companyName,
          verifiedCompanyDomain,
        };
        adapter = new LeverPostingsAdapter(configuration);
      } else if (provider === "ashby" && typeof candidate.jobBoardName === "string") {
        configuration = {
          schemaVersion: 1,
          provider,
          sourceId: candidate.sourceId,
          enabled: candidate.enabled,
          jobBoardName: candidate.jobBoardName,
          companyName,
          verifiedCompanyDomain,
        };
        adapter = new AshbyJobBoardAdapter(configuration);
      } else {
        throw new Error("IngestionProviderConfigurationRejected");
      }
      return Object.freeze({
        registration: Object.freeze({
          sourceId: configuration.sourceId,
          provider: configuration.provider,
          provenance: "permitted_api" as const,
          enabled: configuration.enabled,
          adapter,
        }),
        adapterConfigSha256: providerConfigurationDigest(configuration),
      });
    }),
  );
}

export function preflightProviderSourceConfigurations(
  value: string,
): readonly ProviderSourcePreflightDescriptor[] {
  return Object.freeze(
    parseProviderSourceConfigurations(value, false).map((source) => {
      const provider = source.registration.provider;
      if (provider !== "greenhouse" && provider !== "lever" && provider !== "ashby") {
        throw new Error("IngestionProviderConfigurationRejected");
      }
      return Object.freeze({
        provider,
        sourceId: source.registration.sourceId,
        adapterVersion: source.registration.adapter.adapterVersion,
        adapterConfigSha256: source.adapterConfigSha256,
      });
    }),
  );
}

interface LambdaInvoker {
  send(command: InvokeCommand): Promise<{ StatusCode?: number; DurableExecutionArn?: string }>;
}

interface LambdaDurableReader {
  send(command: GetDurableExecutionCommand): Promise<GetDurableExecutionCommandOutput>;
}

export class AwsIngestionDurableStatusReader {
  constructor(private readonly client: LambdaDurableReader = new LambdaClient({})) {}

  async getStatus(
    durableExecutionArn: string,
  ): Promise<"RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "STOPPED"> {
    const match =
      /^(arn:(?:aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:([1-9][0-9]*))\/durable-execution\/([A-Za-z0-9_-]{1,64})\/[A-Za-z0-9_-]+$/u.exec(
        durableExecutionArn,
      );
    if (!match || durableExecutionArn.length > 1_024)
      throw new Error("IngestionDurableReconciliationRejected");
    try {
      const result = await this.client.send(
        new GetDurableExecutionCommand({
          DurableExecutionArn: durableExecutionArn,
          IncludeExecutionData: false,
        }),
      );
      if (
        result.ExecutionDataIncluded !== false ||
        result.DurableExecutionArn !== durableExecutionArn ||
        result.FunctionArn !== match[1]?.replace(/:[1-9][0-9]*$/u, "") ||
        result.Version !== match[2] ||
        result.DurableExecutionName !== match[3] ||
        !result.StartTimestamp ||
        !Number.isFinite(result.StartTimestamp.getTime()) ||
        !["RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "STOPPED"].includes(
          String(result.Status),
        ) ||
        result.InputPayload !== undefined ||
        result.Result !== undefined ||
        result.Error !== undefined ||
        (result.Status === "RUNNING" && result.EndTimestamp !== undefined) ||
        (result.Status !== "RUNNING" &&
          (!result.EndTimestamp ||
            !Number.isFinite(result.EndTimestamp.getTime()) ||
            result.EndTimestamp < result.StartTimestamp))
      ) {
        throw new Error("IngestionDurableReconciliationRejected");
      }
      return result.Status as "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "STOPPED";
    } catch (error) {
      if (error instanceof Error && error.message === "IngestionDurableReconciliationRejected") {
        throw error;
      }
      throw new Error("IngestionDurableReconciliationUnavailable");
    }
  }
}

interface SqsSender {
  send(command: SendMessageCommand): Promise<{ MessageId?: string }>;
}

export function buildIngestionDispatchNudge(input: {
  dispatchId: string;
  executionId: string;
  checkpointRevision: number;
  workflowGeneration: number;
}): IngestionDispatchNudgeV1 {
  const fields = { schemaVersion: 1 as const, ...input };
  return {
    ...fields,
    integrity: {
      algorithm: "sha256",
      digest: createHash("sha256")
        .update(ingestionDispatchNudgeIntegrityInput(fields), "utf8")
        .digest("hex"),
    },
  };
}

export function verifyIngestionDispatchNudge(value: unknown): value is IngestionDispatchNudgeV1 {
  if (!validateIngestionDispatchNudge(value)) return false;
  const expected = buildIngestionDispatchNudge(value).integrity.digest;
  return value.integrity.digest === expected;
}

export class AwsIngestionNudgePublisher {
  constructor(
    private readonly queueUrl: string,
    private readonly sender: SqsSender = new SQSClient({}),
  ) {}

  async publish(nudge: IngestionDispatchNudgeV1): Promise<void> {
    const result = await this.sender.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(nudge) }),
    );
    if (!result.MessageId) throw new Error("IngestionNudgeNotAccepted");
  }
}

export class AwsIngestionDurableClient {
  constructor(private readonly invoker: LambdaInvoker = new LambdaClient({})) {}

  async start(
    functionArn: string,
    executionName: string,
    payload: IngestionWorkflowInputV1,
  ): Promise<{ executionArn: string }> {
    const result = await this.invoker.send(
      new InvokeCommand({
        FunctionName: functionArn,
        InvocationType: "Event",
        DurableExecutionName: executionName,
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    if (result.StatusCode !== 202 || !result.DurableExecutionArn) {
      throw new Error("IngestionDurableStartNotAccepted");
    }
    return { executionArn: result.DurableExecutionArn };
  }
}

interface IngestionRuntime {
  store: PostgresIngestionOrchestrationStore;
  coordinators: ReadonlyMap<string, DurableIngestionCoordinator>;
  configuredSources: readonly ConfiguredIngestionSource[];
  sourceExecutionGate: SourceExecutionGate;
}

let runtime: IngestionRuntime | undefined;

export function createModeratedSourceExecutionGate(
  moderation: Pick<PostgresJobModerationStore, "isSourcePaused">,
  expectedInput:
    | Readonly<{
        sourceId: string;
        adapterVersion: string;
        adapterConfigSha256: string;
      }>
    | readonly Readonly<{
        sourceId: string;
        adapterVersion: string;
        adapterConfigSha256: string;
      }>[],
): SourceExecutionGate {
  const expectedValues = Array.isArray(expectedInput) ? expectedInput : [expectedInput];
  const expected = new Map<string, (typeof expectedValues)[number]>();
  for (const value of expectedValues) {
    const key = `${value.sourceId}\0${value.adapterVersion}`;
    if (
      !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(value.sourceId) ||
      !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(value.adapterVersion) ||
      !/^[a-f0-9]{64}$/u.test(value.adapterConfigSha256) ||
      expected.has(key)
    ) {
      throw new Error("The moderated source execution identity is invalid");
    }
    expected.set(key, value);
  }
  return async (identity) => {
    const value = expected.get(`${identity.sourceId}\0${identity.adapterVersion}`);
    if (!value) return false;
    try {
      return !(await moderation.isSourcePaused({
        kind: "source",
        sourceId: value.sourceId,
        adapterVersion: value.adapterVersion,
        adapterConfigSha256: value.adapterConfigSha256,
      }));
    } catch {
      throw new Error("IngestionSourceControlUnavailable");
    }
  };
}

export async function generatedSyntheticSourceMayRun(
  configuredEnabled: boolean,
  sourceExecutionGate: SourceExecutionGate,
): Promise<boolean> {
  return (
    configuredEnabled &&
    (await sourceExecutionGate({
      sourceId: generatedSyntheticSourceId,
      adapterVersion: generatedSyntheticAdapterVersion,
    }))
  );
}

async function createRuntime(): Promise<IngestionRuntime> {
  const durableFunctionArn = process.env.INGESTION_DURABLE_FUNCTION_ARN;
  const activityFunctionArn = process.env.INGESTION_ACTIVITY_FUNCTION_ARN;
  if (
    (durableFunctionArn && !isExactNumericLambdaVersionArn(durableFunctionArn)) ||
    (activityFunctionArn && !isExactNumericLambdaVersionArn(activityFunctionArn))
  ) {
    throw new Error("Exact ingestion durable and activity version ARNs are required");
  }
  const databaseUrl = await resolveLambdaDatabaseUrl(
    {
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.DATABASE_SECRET_ID
        ? { DATABASE_SECRET_ID: process.env.DATABASE_SECRET_ID }
        : {}),
    },
    { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
  );
  const database = createJobCatalogDatabase(databaseUrl, { maxConnections: 1 });
  const store = new PostgresIngestionOrchestrationStore(database);
  const syntheticEnabled = process.env.INGESTION_SYNTHETIC_SOURCE_ENABLED === "true";
  const providerActivationAllowed = process.env.INGESTION_PROVIDER_ACTIVATION_ALLOWED === "true";
  const seed = process.env.INGESTION_SYNTHETIC_SEED;
  if (!seed || !/^[a-z0-9]{8,64}$/u.test(seed)) {
    throw new Error("INGESTION_SYNTHETIC_SEED is required and must be canonical");
  }
  const syntheticAdapter = new GeneratedSyntheticIngestionAdapter(seed);
  const configuredSources: ConfiguredIngestionSource[] = [
    {
      registration: {
        sourceId: generatedSyntheticSourceId,
        provider: "other",
        provenance: "authorized_fixture",
        enabled: syntheticEnabled,
        adapter: syntheticAdapter,
      },
      adapterConfigSha256: generatedSyntheticConfigSha256(seed),
    },
    ...parseProviderSourceConfigurations(
      process.env.INGESTION_PROVIDER_SOURCES ?? "[]",
      providerActivationAllowed,
    ),
  ];
  const sourceExecutionGate = createModeratedSourceExecutionGate(
    new PostgresJobModerationStore(database),
    configuredSources.map(({ registration, adapterConfigSha256 }) => ({
      sourceId: registration.sourceId,
      adapterVersion: registration.adapter.adapterVersion,
      adapterConfigSha256,
    })),
  );
  const registry = new SourceRegistry(
    configuredSources.map(({ registration }) => registration),
    () => true,
    { providerActivationAllowed },
  );
  const catalog = new PostgresJobCatalog(database, {
    acceptedProvenance: new Set<"authorized_fixture" | "permitted_api">([
      "authorized_fixture",
      ...(providerActivationAllowed ? (["permitted_api"] as const) : []),
    ]),
    searchCursorKeys: {
      active: { id: "ingestion-unused", key: randomBytes(32) },
    },
  });
  const runner = new SourceNeutralIngestionRunner(registry, catalog, { sourceExecutionGate });
  const coordinators = new Map(
    configuredSources.map(({ registration, adapterConfigSha256 }) => [
      registration.sourceId,
      new DurableIngestionCoordinator(store, registry, runner, {
        ...(durableFunctionArn ? { durableFunctionArn } : {}),
        ...(activityFunctionArn ? { activityFunctionArn } : {}),
        adapterConfigSha256,
        sourceExecutionGate,
        durableExecutionStatusReader: new AwsIngestionDurableStatusReader(),
      }),
    ]),
  );
  return {
    store,
    sourceExecutionGate,
    coordinators,
    configuredSources: Object.freeze(configuredSources),
  };
}

async function getRuntime(): Promise<IngestionRuntime> {
  runtime ??= await createRuntime();
  return runtime;
}

export function safeIngestionTransportErrorCode(error: unknown): IngestionDispatchErrorCode {
  const value =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "IngestionDispatchFailure";
  switch (value) {
    case "IngestionNudgeNotAccepted":
    case "ServiceUnavailableException":
    case "ThrottlingException":
    case "TimeoutError":
    case "TooManyRequestsException":
      return value;
    default:
      return "IngestionDispatchFailure";
  }
}

export async function publishClaimedIngestionDispatch(
  dispatch: PersistedIngestionDispatch,
  claimId: string,
  publisher: Pick<AwsIngestionNudgePublisher, "publish">,
  store: Pick<
    PostgresIngestionOrchestrationStore,
    "recordDispatchFailure" | "recordDispatchNudged"
  >,
): Promise<{ accepted: boolean; confirmed: boolean }> {
  try {
    await publisher.publish(
      buildIngestionDispatchNudge({
        dispatchId: dispatch.id,
        executionId: dispatch.executionId,
        checkpointRevision: dispatch.checkpointRevision,
        workflowGeneration: dispatch.generation,
      }),
    );
  } catch (error) {
    await store.recordDispatchFailure(dispatch.id, claimId, safeIngestionTransportErrorCode(error));
    return { accepted: false, confirmed: false };
  }
  try {
    await store.recordDispatchNudged(dispatch.id, claimId);
    return { accepted: true, confirmed: true };
  } catch {
    return { accepted: true, confirmed: false };
  }
}

export function requireScheduledEvent(
  event: EventBridgeEvent<"Scheduled Event", Record<string, never>>,
  now: Date = new Date(),
): void {
  const ruleArn = process.env.INGESTION_SCHEDULE_RULE_ARN;
  const account = process.env.AWS_ACCOUNT_ID;
  const region = process.env.AWS_REGION;
  const eventTime = record(event) ? canonicalAwsTimestamp(event.time) : undefined;
  if (
    !ruleArn ||
    !account ||
    !region ||
    !record(event) ||
    !hasExactKeys(event, [
      "version",
      "id",
      "detail-type",
      "source",
      "account",
      "time",
      "region",
      "resources",
      "detail",
    ]) ||
    event.version !== "0" ||
    typeof event.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(event.id) ||
    event.source !== "aws.events" ||
    event["detail-type"] !== "Scheduled Event" ||
    event.account !== account ||
    event.region !== region ||
    event.resources.length !== 1 ||
    event.resources[0] !== ruleArn ||
    !record(event.detail) ||
    Object.keys(event.detail).length !== 0 ||
    !eventTime ||
    !Number.isFinite(now.getTime()) ||
    eventTime.getTime() < now.getTime() - 65 * 60 * 1_000 ||
    eventTime.getTime() > now.getTime() + 5 * 60 * 1_000 ||
    new Date(eventTime).setUTCMinutes(0, 0, 0) > now.getTime()
  ) {
    throw new Error("IngestionScheduleEventRejected");
  }
}

export function hourlyIngestionScheduleSlot(eventTime: string): string {
  const parsed = canonicalAwsTimestamp(eventTime);
  if (!parsed) {
    throw new Error("IngestionScheduleEventRejected");
  }
  const slot = new Date(parsed);
  slot.setUTCMinutes(0, 0, 0);
  return slot.toISOString();
}

export const coordinator: Handler<
  EventBridgeEvent<"Scheduled Event", Record<string, never>>,
  {
    scheduled: number;
    resumed: number;
    recovered: number;
    claimed: number;
    sent: number;
    failed: number;
  }
> = async (event) => {
  requireScheduledEvent(event);
  const current = await getRuntime();
  let scheduled = 0;
  let resumed = 0;
  let recovered = 0;
  for (const source of current.configuredSources) {
    const sourceId = source.registration.sourceId;
    const sourceCoordinator = current.coordinators.get(sourceId);
    if (!sourceCoordinator) throw new Error("IngestionSourceRuntimeUnavailable");
    recovered += await sourceCoordinator.recoverTransport(sourceId);
    if (
      source.registration.enabled === true &&
      (await current.sourceExecutionGate({
        sourceId,
        adapterVersion: source.registration.adapter.adapterVersion,
      }))
    ) {
      resumed += await sourceCoordinator.resumePaused(sourceId);
      const result = await sourceCoordinator.schedule({
        sourceId,
        adapterVersion: source.registration.adapter.adapterVersion,
        scheduledFor: hourlyIngestionScheduleSlot(event.time),
      });
      scheduled += result.created ? 1 : 0;
    }
  }
  const queueUrl = process.env.INGESTION_QUEUE_URL;
  if (!queueUrl) throw new Error("INGESTION_QUEUE_URL is required");
  const publisher = new AwsIngestionNudgePublisher(queueUrl);
  const claimId = uuidv7();
  const dispatches = await current.store.claimDispatches(25, claimId);
  let sent = 0;
  let failed = 0;
  for (const dispatch of dispatches) {
    const result = await publishClaimedIngestionDispatch(
      dispatch,
      claimId,
      publisher,
      current.store,
    );
    if (result.accepted) sent += 1;
    if (!result.confirmed) failed += 1;
  }
  logger.info(
    { scheduled, resumed, recovered, claimed: dispatches.length, sent, failed },
    "ingestion coordinator completed",
  );
  if (failed > 0) throw new Error("IngestionDispatchPublishFailed");
  return { scheduled, resumed, recovered, claimed: dispatches.length, sent, failed };
};

export function createIngestionStarterHandler(
  store: PostgresIngestionOrchestrationStore,
  durableClient: Pick<AwsIngestionDurableClient, "start">,
  currentDurableFunctionArn: string,
  activityFunctionArn: string,
  queueBoundary: { queueArn: string; accountId: string; region: string },
) {
  const match = sqsQueueArnPattern.exec(queueBoundary.queueArn);
  if (
    !match ||
    match[2] !== queueBoundary.region ||
    match[3] !== queueBoundary.accountId ||
    !/^[0-9]{12}$/u.test(queueBoundary.accountId) ||
    !/^[a-z0-9-]+$/u.test(queueBoundary.region)
  ) {
    throw new Error("IngestionQueueBoundaryRejected");
  }
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    if (event.Records.length < 1 || event.Records.length > 10) {
      throw new Error("IngestionQueueBoundaryRejected");
    }
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        requireIngestionQueueRecord(record, queueBoundary);
        if (Buffer.byteLength(record.body, "utf8") > maximumNudgeBytes) {
          throw new Error("IngestionNudgeTooLarge");
        }
        const value: unknown = JSON.parse(record.body);
        if (!verifyIngestionDispatchNudge(value)) throw new Error("IngestionNudgeRejected");
        const dispatch = await store.confirmDispatchDelivery(value, {
          durableFunctionArn: currentDurableFunctionArn,
          activityFunctionArn,
        });
        if (
          !dispatch ||
          dispatch.executionId !== value.executionId ||
          dispatch.checkpointRevision !== value.checkpointRevision ||
          dispatch.generation !== value.workflowGeneration ||
          dispatch.durableExecutionName !==
            durableIngestionExecutionName(value.executionId, value.workflowGeneration) ||
          !sameVersionedLambdaFunction(dispatch.durableFunctionArn, currentDurableFunctionArn) ||
          !sameVersionedLambdaFunction(dispatch.activityFunctionArn, activityFunctionArn)
        ) {
          throw new Error("IngestionDispatchMismatch");
        }
        if (
          dispatch.state === "started" ||
          dispatch.state === "terminal" ||
          dispatch.state === "recovery_exhausted"
        ) {
          continue;
        }
        if (dispatch.state !== "nudged") throw new Error("IngestionDispatchNotReady");
        const started = await durableClient.start(
          dispatch.durableFunctionArn,
          dispatch.durableExecutionName,
          {
            schemaVersion: 1,
            workflowDefinitionVersion: 1,
            dispatchId: dispatch.id,
            executionId: dispatch.executionId,
            workflowGeneration: dispatch.generation,
          },
        );
        await store.recordDurableStart(dispatch.id, started.executionArn);
      } catch {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

export function requireIngestionQueueRecord(
  record: SQSRecord,
  boundary: { queueArn: string; accountId: string; region: string },
): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(record.messageId) ||
    record.eventSource !== "aws:sqs" ||
    record.eventSourceARN !== boundary.queueArn ||
    record.awsRegion !== boundary.region ||
    !/^[a-f0-9]{32}$/u.test(record.md5OfBody) ||
    createHash("md5").update(record.body, "utf8").digest("hex") !== record.md5OfBody
  ) {
    throw new Error("IngestionQueueBoundaryRejected");
  }
  const match = sqsQueueArnPattern.exec(record.eventSourceARN);
  if (!match || match[2] !== boundary.region || match[3] !== boundary.accountId) {
    throw new Error("IngestionQueueBoundaryRejected");
  }
}

export function assertIngestionActivityDispatch(
  dispatch: PersistedIngestionDispatch | undefined,
  input: { dispatchId: string; executionId: string; workflowGeneration: number },
  invokedActivityArn: string,
  currentAdapterConfigSha256: string,
): asserts dispatch is PersistedIngestionDispatch {
  if (
    !dispatch ||
    dispatch.id !== input.dispatchId ||
    dispatch.executionId !== input.executionId ||
    dispatch.generation !== input.workflowGeneration ||
    !["nudged", "started"].includes(dispatch.state) ||
    dispatch.activityFunctionArn !== invokedActivityArn ||
    dispatch.adapterConfigSha256 !== currentAdapterConfigSha256
  ) {
    throw new Error("IngestionActivityDispatchRejected");
  }
}

let starterHandler: ReturnType<typeof createIngestionStarterHandler> | undefined;
export const starter: Handler<SQSEvent, SQSBatchResponse> = async (event) => {
  if (!starterHandler) {
    const durableArn = process.env.INGESTION_DURABLE_FUNCTION_ARN;
    const activityArn = process.env.INGESTION_ACTIVITY_FUNCTION_ARN;
    const queueArn = process.env.INGESTION_QUEUE_ARN;
    const accountId = process.env.AWS_ACCOUNT_ID;
    const region = process.env.AWS_REGION;
    if (!durableArn || !activityArn || !queueArn || !accountId || !region) {
      throw new Error("Exact ingestion runtime boundary is required");
    }
    starterHandler = createIngestionStarterHandler(
      (await getRuntime()).store,
      new AwsIngestionDurableClient(),
      durableArn,
      activityArn,
      { queueArn, accountId, region },
    );
  }
  return starterHandler(event);
};

export function requireInvokedActivityVersionArn(
  context: Pick<Context, "invokedFunctionArn">,
): string {
  const version = process.env.AWS_LAMBDA_FUNCTION_VERSION;
  if (
    !version ||
    !/^[1-9][0-9]*$/u.test(version) ||
    !isExactNumericLambdaVersionArn(context.invokedFunctionArn) ||
    !context.invokedFunctionArn.endsWith(`:${version}`)
  ) {
    throw new Error("IngestionActivityVersionRejected");
  }
  return context.invokedFunctionArn;
}

export const activity: Handler<unknown, IngestionActivityResultV1> = async (event, context) => {
  if (!validateIngestionActivityInput(event)) throw new Error("IngestionActivityInputRejected");
  const activityArn = requireInvokedActivityVersionArn(context);
  const current = await getRuntime();
  const dispatch = await current.store.getDispatch(event.dispatchId);
  const checkpoint = dispatch ? await current.store.getCheckpoint(dispatch.executionId) : undefined;
  const source = checkpoint
    ? current.configuredSources.find(
        (candidate) => candidate.registration.sourceId === checkpoint.sourceId,
      )
    : undefined;
  const sourceCoordinator = source
    ? current.coordinators.get(source.registration.sourceId)
    : undefined;
  if (!checkpoint || !source || !sourceCoordinator) {
    throw new Error("IngestionActivityDispatchRejected");
  }
  assertIngestionActivityDispatch(dispatch, event, activityArn, source.adapterConfigSha256);
  if (event.action === "advance") {
    const result = await sourceCoordinator.advance(event.executionId);
    if (result.action === "run") {
      return {
        schemaVersion: 1,
        dispatchId: event.dispatchId,
        workflowGeneration: event.workflowGeneration,
        ...result,
      };
    }
    if (result.action === "wait") {
      return {
        schemaVersion: 1,
        dispatchId: event.dispatchId,
        workflowGeneration: event.workflowGeneration,
        ...result,
      };
    }
    if (result.disposition.action === "retry") {
      throw new Error("IngestionTerminalDispositionRejected");
    }
    return {
      schemaVersion: 1,
      action: "terminal",
      dispatchId: event.dispatchId,
      executionId: result.executionId,
      workflowGeneration: event.workflowGeneration,
      revision: result.revision,
      status: result.disposition.status,
      progressKnown: result.disposition.progressKnown,
      observationCount: result.disposition.observationCount,
      createdCount: result.disposition.createdCount,
      updatedCount: result.disposition.updatedCount,
    };
  }
  const controller = new AbortController();
  const remaining = new Date(event.leaseExpiresAt).getTime() - Date.now() - 10_000;
  if (remaining <= 0) controller.abort();
  const timeout = remaining > 0 ? setTimeout(() => controller.abort(), remaining) : undefined;
  try {
    const result = await sourceCoordinator.runAndSettle({
      executionId: event.executionId,
      revision: event.revision,
      leaseId: event.leaseId,
      attempt: event.attempt,
      leaseExpiresAt: event.leaseExpiresAt,
      signal: controller.signal,
    });
    if (result.disposition.action === "retry") {
      return {
        schemaVersion: 1,
        action: "wait",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: result.revision,
        waitMilliseconds: result.waitMilliseconds ?? 1,
      };
    }
    return {
      schemaVersion: 1,
      action: "terminal",
      dispatchId: event.dispatchId,
      executionId: event.executionId,
      workflowGeneration: event.workflowGeneration,
      revision: result.revision,
      status: result.disposition.status,
      progressKnown: result.disposition.progressKnown,
      observationCount: result.disposition.observationCount,
      createdCount: result.disposition.createdCount,
      updatedCount: result.disposition.updatedCount,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

interface IngestionTerminalEvent {
  version: "0";
  id: string;
  account: string;
  time: string;
  region: string;
  resources: [string];
  source: "aws.lambda";
  "detail-type": "Durable Execution Status Change";
  detail: {
    durableExecutionArn: string;
    durableExecutionName: string;
    functionArn: string;
    status: "FAILED" | "STOPPED" | "SUCCEEDED" | "TIMED_OUT";
    startTimestamp: string;
    endTimestamp: string;
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function canonicalAwsTimestamp(value: unknown): Date | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : undefined;
}

function matchesDurableExecutionArn(
  executionArn: string,
  functionArn: string,
  executionName: string,
): boolean {
  const escapedArn = functionArn.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedName = executionName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (
    new RegExp(`^${escapedArn}\\/durable-execution\\/${escapedName}\\/[A-Za-z0-9_-]+$`, "u").test(
      executionArn,
    ) && executionArn.length <= 1_024
  );
}

function functionArnMatchesScope(functionArn: string, account: string, region: string): boolean {
  const match =
    /^arn:(aws|aws-us-gov|aws-cn):lambda:([a-z0-9-]+):([0-9]{12}):function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$/u.exec(
      functionArn,
    );
  return match?.[2] === region && match[3] === account;
}

function sameVersionedLambdaFunction(left: string, right: string): boolean {
  const unqualified = (value: string) => value.replace(/:[1-9][0-9]*$/u, "");
  return (
    isExactNumericLambdaVersionArn(left) &&
    isExactNumericLambdaVersionArn(right) &&
    unqualified(left) === unqualified(right)
  );
}

export function createIngestionTerminalHandler(
  store: PostgresIngestionOrchestrationStore,
  config: {
    account: string;
    region: string;
    currentDurableFunctionArn: string;
    currentActivityFunctionArn: string;
    currentAdapterConfigSha256: string | ((executionId: string) => Promise<string | undefined>);
    now?: () => Date;
    dispatchId?: () => string;
  },
) {
  return async (event: unknown): Promise<{ handled: boolean }> => {
    const now = (config.now ?? (() => new Date()))();
    if (
      !/^[0-9]{12}$/u.test(config.account) ||
      !/^[a-z0-9-]+$/u.test(config.region) ||
      !isExactNumericLambdaVersionArn(config.currentDurableFunctionArn) ||
      !isExactNumericLambdaVersionArn(config.currentActivityFunctionArn) ||
      (typeof config.currentAdapterConfigSha256 !== "function" &&
        !/^[a-f0-9]{64}$/u.test(config.currentAdapterConfigSha256)) ||
      !Number.isFinite(now.getTime())
    ) {
      throw new Error("IngestionTerminalConfigurationRejected");
    }
    const envelopeTime = record(event) ? canonicalAwsTimestamp(event.time) : undefined;
    if (
      !record(event) ||
      !hasExactKeys(event, [
        "version",
        "id",
        "detail-type",
        "source",
        "account",
        "time",
        "region",
        "resources",
        "detail",
      ]) ||
      event.version !== "0" ||
      typeof event.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(event.id) ||
      event.account !== config.account ||
      event.region !== config.region ||
      event.source !== "aws.lambda" ||
      event["detail-type"] !== "Durable Execution Status Change" ||
      !envelopeTime ||
      envelopeTime.getTime() < now.getTime() - 2 * 60 * 60 * 1_000 ||
      envelopeTime.getTime() > now.getTime() + 5 * 60 * 1_000 ||
      !Array.isArray(event.resources) ||
      event.resources.length !== 1 ||
      !record(event.detail) ||
      !hasExactKeys(event.detail, [
        "durableExecutionArn",
        "durableExecutionName",
        "functionArn",
        "status",
        "startTimestamp",
        "endTimestamp",
      ])
    ) {
      throw new Error("IngestionTerminalEventRejected");
    }
    const detail = event.detail as unknown as IngestionTerminalEvent["detail"];
    const startTimestamp = canonicalAwsTimestamp(detail.startTimestamp);
    const endTimestamp = canonicalAwsTimestamp(detail.endTimestamp);
    if (
      !detail ||
      !isExactNumericLambdaVersionArn(detail.functionArn) ||
      !functionArnMatchesScope(detail.functionArn, config.account, config.region) ||
      event.resources[0] !== detail.functionArn ||
      !/^[a-f0-9]{64}$/u.test(detail.durableExecutionName) ||
      !["FAILED", "STOPPED", "SUCCEEDED", "TIMED_OUT"].includes(detail.status) ||
      !matchesDurableExecutionArn(
        detail.durableExecutionArn,
        detail.functionArn,
        detail.durableExecutionName,
      ) ||
      !startTimestamp ||
      !endTimestamp ||
      startTimestamp.getTime() > endTimestamp.getTime() ||
      endTimestamp.getTime() < envelopeTime.getTime() - 5 * 60 * 1_000 ||
      endTimestamp.getTime() > envelopeTime.getTime() + 5 * 60 * 1_000
    ) {
      throw new Error("IngestionTerminalEventRejected");
    }
    const dispatch = await store.recordDurableTerminal(
      detail.durableExecutionName,
      detail.status,
      detail.durableExecutionArn,
      detail.functionArn,
    );
    if (detail.status === "SUCCEEDED") return { handled: true };
    const currentAdapterConfigSha256 =
      typeof config.currentAdapterConfigSha256 === "function"
        ? await config.currentAdapterConfigSha256(dispatch.executionId)
        : config.currentAdapterConfigSha256;
    if (!currentAdapterConfigSha256 || !/^[a-f0-9]{64}$/u.test(currentAdapterConfigSha256)) {
      throw new Error("IngestionTerminalConfigurationRejected");
    }
    await store.ensureRecoveryDispatch(
      dispatch.executionId,
      dispatch.generation,
      (config.dispatchId ?? uuidv7)(),
      config.currentDurableFunctionArn,
      config.currentActivityFunctionArn,
      currentAdapterConfigSha256,
    );
    return { handled: true };
  };
}

export const terminal: Handler<unknown, { handled: boolean }> = async (event) => {
  const account = process.env.AWS_ACCOUNT_ID;
  const region = process.env.AWS_REGION;
  const durableArn = process.env.INGESTION_DURABLE_FUNCTION_ARN;
  const activityArn = process.env.INGESTION_ACTIVITY_FUNCTION_ARN;
  if (!account || !region || !durableArn || !activityArn) {
    throw new Error("Exact ingestion terminal environment is required");
  }
  const current = await getRuntime();
  return createIngestionTerminalHandler(current.store, {
    account,
    region,
    currentDurableFunctionArn: durableArn,
    currentActivityFunctionArn: activityArn,
    currentAdapterConfigSha256: async (executionId) => {
      const checkpoint = await current.store.getCheckpoint(executionId);
      return current.configuredSources.find(
        (source) => source.registration.sourceId === checkpoint?.sourceId,
      )?.adapterConfigSha256;
    },
  })(event);
};
