import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createLogger } from "@ai-job-apply/observability";
import {
  createDatabase,
  type OutboxNudgePublisher,
  PostgresProfileStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import type { EventBridgeEvent, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import {
  type DurableExecutionClient,
  type DurableExecutionPayloadV1,
  ServerlessOutboxReconciler,
  ServerlessOutboxStarter,
} from "./serverless-outbox.js";

const textEncoder = new TextEncoder();
const MAXIMUM_NUDGE_BYTES = 4_096;

interface LambdaInvoker {
  send(command: InvokeCommand): Promise<{ StatusCode?: number; DurableExecutionArn?: string }>;
}

interface SqsSender {
  send(command: SendMessageCommand): Promise<{ MessageId?: string }>;
}

export class AwsDurableExecutionClient implements DurableExecutionClient {
  private readonly invoker: LambdaInvoker;

  constructor(
    private readonly functionArn: string,
    invoker: LambdaInvoker = new LambdaClient({}),
  ) {
    this.invoker = invoker;
  }

  async start(input: {
    executionName: string;
    payload: DurableExecutionPayloadV1;
  }): Promise<{ executionArn?: string }> {
    const result = await this.invoker.send(
      new InvokeCommand({
        FunctionName: this.functionArn,
        InvocationType: "Event",
        DurableExecutionName: input.executionName,
        Payload: textEncoder.encode(JSON.stringify(input.payload)),
      }),
    );
    if (result.StatusCode !== 202) {
      throw new Error("DurableExecutionNotAccepted");
    }
    return result.DurableExecutionArn ? { executionArn: result.DurableExecutionArn } : {};
  }
}

export class AwsSqsOutboxNudgePublisher implements OutboxNudgePublisher {
  private readonly sender: SqsSender;

  constructor(
    private readonly queueUrl: string,
    sender: SqsSender = new SQSClient({}),
  ) {
    this.sender = sender;
  }

  async publish(nudge: Parameters<OutboxNudgePublisher["publish"]>[0]): Promise<void> {
    const result = await this.sender.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(nudge) }),
    );
    if (!result.MessageId) {
      throw new Error("SqsMessageNotAccepted");
    }
  }
}

export function createStarterHandler(starter: ServerlessOutboxStarter) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await processSqsRecord(starter, record);
      } catch {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

async function processSqsRecord(
  starter: ServerlessOutboxStarter,
  record: SQSRecord,
): Promise<void> {
  if (Buffer.byteLength(record.body, "utf8") > MAXIMUM_NUDGE_BYTES) {
    throw new Error("OutboxNudgeTooLarge");
  }
  let value: unknown;
  try {
    value = JSON.parse(record.body);
  } catch {
    throw new Error("OutboxNudgeMalformed");
  }
  await starter.process(value);
}

interface RuntimeComposition {
  store: PostgresProfileStore;
  close(): Promise<void>;
}

async function createRuntimeComposition(): Promise<RuntimeComposition> {
  const databaseUrl = await resolveLambdaDatabaseUrl(
    {
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.DATABASE_SECRET_ID
        ? { DATABASE_SECRET_ID: process.env.DATABASE_SECRET_ID }
        : {}),
    },
    { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
  );
  const database = createDatabase(databaseUrl, { maxConnections: 1 });
  const store = new PostgresProfileStore(database);
  return { store, close: () => store.close() };
}

let starterHandler: ReturnType<typeof createStarterHandler> | undefined;

export async function starter(event: SQSEvent): Promise<SQSBatchResponse> {
  if (!starterHandler) {
    const durableFunctionArn = process.env.DURABLE_FUNCTION_ARN;
    if (!durableFunctionArn) {
      throw new Error("DURABLE_FUNCTION_ARN is required");
    }
    const runtime = await createRuntimeComposition();
    const logger = createLogger({
      service: "outbox-starter",
      level: "info",
      releaseSha: process.env.RELEASE_SHA ?? "local",
    });
    starterHandler = createStarterHandler(
      new ServerlessOutboxStarter(
        runtime.store,
        new AwsDurableExecutionClient(durableFunctionArn),
        logger,
      ),
    );
  }
  return starterHandler(event);
}

let reconciler: ServerlessOutboxReconciler | undefined;

export async function reconcile(
  _event: EventBridgeEvent<"Scheduled Event", Record<string, never>>,
): Promise<{ claimed: number; sent: number; failed: number }> {
  if (!reconciler) {
    const queueUrl = process.env.OUTBOX_QUEUE_URL;
    if (!queueUrl) {
      throw new Error("OUTBOX_QUEUE_URL is required");
    }
    const runtime = await createRuntimeComposition();
    const logger = createLogger({
      service: "outbox-reconciler",
      level: "info",
      releaseSha: process.env.RELEASE_SHA ?? "local",
    });
    reconciler = new ServerlessOutboxReconciler(
      runtime.store,
      new AwsSqsOutboxNudgePublisher(queueUrl),
      logger,
    );
  }
  return reconciler.reconcileOnce();
}
