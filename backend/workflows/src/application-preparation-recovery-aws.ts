import {
  matchesPreparationExecutionArn,
  type PreparationDispatch,
  PreparationDispatchError,
  preparationExecutionName,
} from "@ai-job-apply/applications-service";
import {
  GetDurableExecutionCommand,
  type GetDurableExecutionCommandOutput,
} from "@aws-sdk/client-lambda";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { validateApplicationPreparationDurableInput } from "./application-preparation-contract.js";
import { PreparationDispatchPendingError } from "./application-preparation-errors.js";
import type {
  PreparationExecutionMetadata,
  PreparationNudgePublisher,
  PreparationStatusReader,
} from "./application-preparation-recovery.js";

export interface PreparationLambdaReader {
  send(
    command: GetDurableExecutionCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<Partial<GetDurableExecutionCommandOutput>>;
}
export function createAwsPreparationStatusReader(
  client: PreparationLambdaReader,
): PreparationStatusReader {
  return {
    async read(dispatch: PreparationDispatch): Promise<PreparationExecutionMetadata> {
      if (
        !dispatch.executionArn ||
        dispatch.executionName !== preparationExecutionName(dispatch.eventId) ||
        !matchesPreparationExecutionArn(
          dispatch.executionArn,
          dispatch.functionArn,
          dispatch.executionName,
        )
      )
        throw new PreparationDispatchError();
      try {
        const result = await client.send(
          new GetDurableExecutionCommand({
            DurableExecutionArn: dispatch.executionArn,
            IncludeExecutionData: false,
          }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        const split = dispatch.functionArn.lastIndexOf(":");
        if (
          result.ExecutionDataIncluded !== false ||
          result.DurableExecutionArn !== dispatch.executionArn ||
          result.FunctionArn !== dispatch.functionArn.slice(0, split) ||
          result.Version !== dispatch.functionArn.slice(split + 1) ||
          result.DurableExecutionName !== dispatch.executionName ||
          !(result.StartTimestamp instanceof Date) ||
          !Number.isFinite(result.StartTimestamp.getTime()) ||
          result.InputPayload !== undefined ||
          result.Result !== undefined ||
          result.Error !== undefined
        )
          throw new PreparationDispatchError();
        if (result.Status === "RUNNING") {
          if (result.EndTimestamp !== undefined) throw new PreparationDispatchError();
          return { status: "RUNNING", startTimestamp: new Date(result.StartTimestamp) };
        }
        if (
          (result.Status !== "SUCCEEDED" &&
            result.Status !== "FAILED" &&
            result.Status !== "STOPPED" &&
            result.Status !== "TIMED_OUT") ||
          !(result.EndTimestamp instanceof Date) ||
          !Number.isFinite(result.EndTimestamp.getTime()) ||
          result.EndTimestamp < result.StartTimestamp
        )
          throw new PreparationDispatchError();
        return {
          status: result.Status,
          startTimestamp: new Date(result.StartTimestamp),
          endTimestamp: new Date(result.EndTimestamp),
        };
      } catch (error) {
        if (error instanceof PreparationDispatchError) throw error;
        throw new PreparationDispatchPendingError();
      }
    },
  };
}

export interface PreparationSqsSender {
  send(
    command: SendMessageCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<{ MessageId?: string }>;
}
export function createAwsPreparationNudgePublisher(
  queueUrl: string,
  sender: PreparationSqsSender,
): PreparationNudgePublisher {
  if (
    !/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/\d{12}\/[A-Za-z0-9_-]{1,80}$/u.test(
      queueUrl,
    )
  )
    throw new PreparationDispatchError();
  return {
    async publish(payload) {
      if (!validateApplicationPreparationDurableInput(payload))
        throw new PreparationDispatchError();
      const canonical = {
        schemaVersion: 1,
        eventId: payload.eventId.toLowerCase(),
        eventType: payload.eventType,
        data: { preparationId: payload.data.preparationId.toLowerCase() },
      };
      try {
        const response = await sender.send(
          new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(canonical) }),
          { abortSignal: AbortSignal.timeout(10_000) },
        );
        if (!response.MessageId) throw new PreparationDispatchPendingError();
      } catch {
        throw new PreparationDispatchPendingError();
      }
    },
  };
}

/** Only source handlers: no environment clients, event mappings or activation defaults. */
export function createPreparationSqsHandler(
  queueArn: string,
  starter: (value: unknown) => Promise<void>,
) {
  if (!/^arn:(aws|aws-us-gov|aws-cn):sqs:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,80}$/u.test(queueArn))
    throw new PreparationDispatchError();
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    if (
      !Array.isArray(event.Records) ||
      event.Records.length > 25 ||
      event.Records.some(
        (record) =>
          typeof record.messageId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/u.test(record.messageId),
      ) ||
      new Set(event.Records.map((record) => record.messageId)).size !== event.Records.length
    )
      throw new PreparationDispatchError();
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        if (
          record.eventSource !== "aws:sqs" ||
          record.eventSourceARN !== queueArn ||
          typeof record.body !== "string" ||
          Buffer.byteLength(record.body, "utf8") > 2_048
        )
          throw new PreparationDispatchError();
        await starter(JSON.parse(record.body));
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
