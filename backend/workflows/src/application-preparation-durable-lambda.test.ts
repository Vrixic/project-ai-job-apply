import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import type { Context } from "aws-lambda";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApplicationPreparationActivityInput } from "./application-preparation-contract.js";
import { createNativeApplicationPreparationDurableHandler } from "./application-preparation-durable-lambda.js";

const target = "arn:aws:lambda:us-east-2:123456789012:function:preparation-durable:9";
const activity = "arn:aws:lambda:us-east-2:123456789012:function:preparation-activity:7";
const input = {
  schemaVersion: 1,
  eventId: "01900000-0000-7000-8000-000000000001",
  eventType: "application.packet-preparation.requested.v1",
  data: { preparationId: "01900000-0000-7000-8000-000000000002" },
};
const environment = () => ({
  APPLICATION_PREPARATION_DURABLE_ENABLED: "true",
  AWS_REGION: "us-east-2",
  PLATFORM_AWS_ACCOUNT_ID: "123456789012",
  AWS_LAMBDA_FUNCTION_NAME: "preparation-durable",
  AWS_LAMBDA_FUNCTION_VERSION: "9",
  APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN: activity,
});
const raw = {} as Parameters<DurableLambdaHandler>[0];
const context = { invokedFunctionArn: target } as Context;
describe("native preparation durable qualification", () => {
  it.each([
    ["APPLICATION_PREPARATION_DURABLE_ENABLED", undefined],
    ["APPLICATION_PREPARATION_DURABLE_ENABLED", "TRUE"],
    ["AWS_REGION", "us-east-1"],
    ["PLATFORM_AWS_ACCOUNT_ID", "bad"],
    ["AWS_LAMBDA_FUNCTION_NAME", "bad:name"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "$LATEST"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "0"],
    ["AWS_LAMBDA_FUNCTION_VERSION", "09"],
    ["APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN", undefined],
    ["APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN", target],
    ["APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN", target.replace(":9", ":8")],
    [
      "APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN",
      activity.replace("123456789012", "999999999999"),
    ],
    ["APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN", activity.replace("us-east-2", "us-east-1")],
    ["APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN", activity.replace(":7", ":alias")],
    ["DATABASE_URL", ""],
    ["DATABASE_SECRET_ID", "synthetic"],
    ["OPENAI_API_KEY", ""],
    ["OPENAI_API_KEY_SECRET_ID", "synthetic"],
    ["COVER_LETTER_OPENAI_SECRET_ID", "synthetic"],
    ["CANDIDATE_DOCUMENT_BUCKET", "synthetic"],
    ["PLATFORM_KMS_KEY_ARN", "synthetic"],
    ["COVER_LETTER_PROVIDER_FUNCTION_ARN", activity],
  ] as const)("refuses %s=%s before SDK control-envelope handling", async (key, value) => {
    const env: Record<string, string | undefined> = environment();
    env[key] = value;
    const handler = createNativeApplicationPreparationDurableHandler({ environment: () => env });
    await expect(handler(raw, context)).rejects.toThrow(
      "ApplicationPreparationWorkflowUnavailable",
    );
  });
  it.each([target.replace(":9", ":8"), target.replace(":9", ":alias"), target.replace(":9", "")])(
    "refuses invoked target %s",
    async (arn) => {
      const handler = createNativeApplicationPreparationDurableHandler({ environment });
      await expect(handler(raw, { ...context, invokedFunctionArn: arn })).rejects.toThrow(
        "ApplicationPreparationWorkflowUnavailable",
      );
    },
  );
  it("sanitizes a configuration-reader exception", async () => {
    const handler = createNativeApplicationPreparationDurableHandler({
      environment: () => {
        throw Error("synthetic secret diagnostic");
      },
    });
    await expect(handler(raw, context)).rejects.toThrow(
      "ApplicationPreparationWorkflowUnavailable",
    );
  });
});
describe("installed SDK through native durable entrypoint", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });
  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });
  function fixture() {
    const env: Record<string, string | undefined> = environment();
    const native = createNativeApplicationPreparationDurableHandler({ environment: () => env });
    const qualified: DurableLambdaHandler = (event, lambdaContext) =>
      native(event, { ...lambdaContext, invokedFunctionArn: target });
    const runner = new LocalDurableTestRunner({ handlerFunction: qualified });
    const calls: ApplicationPreparationActivityInput[] = [];
    return { env, native, runner, calls };
  }
  const completed = (value: ApplicationPreparationActivityInput) => ({
    schemaVersion: 1,
    action: value.action,
    preparationId: value.preparationId,
    outcome: "completed",
  });
  it("replays completed checkpoints with one private effect and metadata-only state", async () => {
    const f = fixture();
    f.runner.registerFunction(activity, async (event) => {
      const value = event as ApplicationPreparationActivityInput;
      f.calls.push(value);
      return completed(value);
    });
    const result = await f.runner.run({ payload: input });
    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(f.calls).toHaveLength(1);
    expect(result.getInvocations().length).toBeGreaterThan(1);
    expect(result.getResult()).toEqual({
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      eventId: input.eventId,
      preparationId: input.data.preparationId,
      state: "completed",
    });
    f.env.APPLICATION_PREPARATION_ACTIVITY_FUNCTION_ARN = activity.replace(":7", ":8");
    await expect(f.native(raw, context)).rejects.toThrow(
      "ApplicationPreparationWorkflowUnavailable",
    );
    expect(f.calls).toHaveLength(1);
  });
  it("uses deterministic bounded retry before completing a pending original effect", async () => {
    const f = fixture();
    f.runner.registerFunction(activity, async (event) => {
      const value = event as ApplicationPreparationActivityInput;
      f.calls.push(value);
      return f.calls.length === 1
        ? { ...completed(value), outcome: "retryable_failure", errorCode: "generation_in_progress" }
        : completed(value);
    });
    expect((await f.runner.run({ payload: input })).getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).toEqual(f.calls[1]);
  });
  it("compensates after five pending advances without candidate data", async () => {
    const f = fixture();
    f.runner.registerFunction(activity, async (event) => {
      const value = event as ApplicationPreparationActivityInput;
      f.calls.push(value);
      return value.action === "advance"
        ? { ...completed(value), outcome: "retryable_failure", errorCode: "context_unavailable" }
        : completed(value);
    });
    expect((await f.runner.run({ payload: input })).getStatus()).toBe(ExecutionStatus.FAILED);
    expect(f.calls.map((call) => call.action)).toEqual([...Array(5).fill("advance"), "fail"]);
  });
  it("rejects injected activity selection or candidate text before private invocation", async () => {
    const f = fixture();
    const invoke = vi.fn();
    f.runner.registerFunction(activity, invoke);
    expect(
      (
        await f.runner.run({ payload: { ...input, activityArn: activity, text: "synthetic" } })
      ).getStatus(),
    ).toBe(ExecutionStatus.FAILED);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("withdrawn activation refuses a warm entrypoint before SDK state access", async () => {
    const f = fixture();
    f.runner.registerFunction(activity, async (event) =>
      completed(event as ApplicationPreparationActivityInput),
    );
    await f.runner.run({ payload: input });
    f.env.APPLICATION_PREPARATION_DURABLE_ENABLED = "false";
    await expect(f.native(raw, context)).rejects.toThrow(
      "ApplicationPreparationWorkflowUnavailable",
    );
  });
});
