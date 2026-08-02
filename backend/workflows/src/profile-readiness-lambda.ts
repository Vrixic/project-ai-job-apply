import type { ProfileStore } from "@ai-job-apply/profile-service";
import {
  createDatabase,
  errorCodeFromUnknown,
  PostgresProfileStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import type { Handler } from "aws-lambda";
import { createProfileReadinessActivities } from "./activities.js";
import {
  type ProfileReadinessActivityInputV1,
  type ProfileReadinessActivityResultV1,
  validateProfileReadinessActivityInput,
} from "./profile-readiness-durable.js";

type ReadinessActivityStore = Pick<
  ProfileStore,
  | "getPreferencesById"
  | "markOperationRunning"
  | "completeReadinessOperation"
  | "failReadinessOperation"
  | "failDurableReadinessOperation"
>;

export type DurableTerminalStatus = "FAILED" | "RUNNING" | "STOPPED" | "SUCCEEDED" | "TIMED_OUT";

export interface DurableTerminalEvent {
  source: "aws.lambda";
  "detail-type": "Durable Execution Status Change";
  detail: {
    durableExecutionArn: string;
    durableExecutionName: string;
    functionArn: string;
    status: DurableTerminalStatus;
  };
}

export type ProfileReadinessActivityHandler = (
  event: unknown,
) => Promise<ProfileReadinessActivityResultV1>;
export type DurableTerminalHandler = (event: unknown) => Promise<{ handled: boolean }>;

function safeFailureCode(error: unknown): string {
  const candidate =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(candidate)
    ? candidate
    : errorCodeFromUnknown(error);
}

function isRetryableActivityFailure(error: unknown): boolean {
  const code = safeFailureCode(error);
  return (
    /^08/u.test(code) ||
    /^53/u.test(code) ||
    [
      "40001",
      "40P01",
      "55P03",
      "57014",
      "57P01",
      "AbortError",
      "ConnectionError",
      "ETIMEDOUT",
      "TimeoutError",
    ].includes(code)
  );
}

function completed(
  action: ProfileReadinessActivityInputV1["action"],
): ProfileReadinessActivityResultV1 {
  return { schemaVersion: 1, action, outcome: "completed" };
}

export function createProfileReadinessActivityHandler(
  store: ReadinessActivityStore,
): ProfileReadinessActivityHandler {
  const activities = createProfileReadinessActivities(store);
  return async (event) => {
    if (!validateProfileReadinessActivityInput(event)) {
      return {
        schemaVersion: 1,
        action: "mark_running",
        outcome: "non_retryable_failure",
        errorCode: "ActivityInputRejected",
      };
    }
    try {
      if (event.action === "mark_running") {
        await activities.markRunning(event);
      } else if (event.action === "calculate_and_persist") {
        await activities.calculateAndPersist(event);
      } else {
        await store.failReadinessOperation(
          event.operationId,
          event.preferenceSetId,
          event.errorCode ?? "WorkflowFailure",
        );
      }
      return completed(event.action);
    } catch (error) {
      return {
        schemaVersion: 1,
        action: event.action,
        outcome: isRetryableActivityFailure(error) ? "retryable_failure" : "non_retryable_failure",
        errorCode: safeFailureCode(error),
      };
    }
  };
}

function isTerminalEvent(
  value: unknown,
  expectedFunctionArn: string,
): value is DurableTerminalEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Partial<DurableTerminalEvent>;
  const detail = event.detail;
  return (
    event.source === "aws.lambda" &&
    event["detail-type"] === "Durable Execution Status Change" &&
    typeof detail === "object" &&
    detail !== null &&
    detail.functionArn === expectedFunctionArn &&
    typeof detail.durableExecutionArn === "string" &&
    typeof detail.durableExecutionName === "string" &&
    /^outbox-[0-9a-f-]{36}$/iu.test(detail.durableExecutionName) &&
    ["FAILED", "RUNNING", "STOPPED", "SUCCEEDED", "TIMED_OUT"].includes(String(detail.status))
  );
}

export function createDurableTerminalHandler(
  store: Pick<ProfileStore, "failDurableReadinessOperation">,
  expectedFunctionArn: string,
): DurableTerminalHandler {
  return async (event) => {
    if (!isTerminalEvent(event, expectedFunctionArn)) {
      throw new Error("DurableTerminalEventRejected");
    }
    if (!["FAILED", "STOPPED", "TIMED_OUT"].includes(event.detail.status)) {
      return { handled: false };
    }
    const errorCode =
      event.detail.status === "STOPPED"
        ? "WorkflowStopped"
        : event.detail.status === "TIMED_OUT"
          ? "WorkflowTimedOut"
          : "WorkflowFailed";
    await store.failDurableReadinessOperation(event.detail.durableExecutionName, errorCode);
    return { handled: true };
  };
}

let runtimeStore: PostgresProfileStore | undefined;

async function getRuntimeStore(): Promise<PostgresProfileStore> {
  if (!runtimeStore) {
    const databaseUrl = await resolveLambdaDatabaseUrl(
      {
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        ...(process.env.DATABASE_SECRET_ID
          ? { DATABASE_SECRET_ID: process.env.DATABASE_SECRET_ID }
          : {}),
      },
      { ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) },
    );
    runtimeStore = new PostgresProfileStore(createDatabase(databaseUrl, { maxConnections: 1 }));
  }
  return runtimeStore;
}

export const activity: Handler<unknown, ProfileReadinessActivityResultV1> = async (event) =>
  createProfileReadinessActivityHandler(await getRuntimeStore())(event);

export const terminal: Handler<unknown, { handled: boolean }> = async (event) => {
  const durableFunctionArn = process.env.DURABLE_FUNCTION_ARN;
  if (!durableFunctionArn) {
    throw new Error("DURABLE_FUNCTION_ARN is required");
  }
  return createDurableTerminalHandler(await getRuntimeStore(), durableFunctionArn)(event);
};
