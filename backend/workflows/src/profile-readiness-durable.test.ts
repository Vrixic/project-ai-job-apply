import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  ExecutionStatus,
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import type { ProfileStore } from "@ai-job-apply/profile-service";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createProfileReadinessDurableHandler,
  isExactNumericVersionFunctionArn,
  PROFILE_READINESS_WORKFLOW_DEFINITION_VERSION,
  type ProfileReadinessActivityInputV1,
  type ProfileReadinessActivityResultV1,
  profileReadinessOperationNames,
  validateProfileReadinessActivityInput,
  validateProfileReadinessDurableInput,
} from "./profile-readiness-durable.js";
import {
  createDurableTerminalHandler,
  createProfileReadinessActivityHandler,
  type DurableTerminalEvent,
} from "./profile-readiness-lambda.js";
import type { DurableExecutionPayloadV1 } from "./serverless-outbox.js";

const activityArn = "arn:aws:lambda:us-east-2:123456789012:function:profile-readiness-activity:7";
const eventId = "019c2b89-79b2-7000-8000-000000000001";
const operationId = "019c2b89-79b2-7000-8000-000000000002";
const preferenceSetId = "019c2b89-79b2-7000-8000-000000000003";

const durableInput: DurableExecutionPayloadV1 = {
  schemaVersion: 1,
  eventId,
  eventType: "profile.preferences.updated.v1",
  data: { operationId, preferenceSetId, version: 1 },
};

function activityResult(
  input: ProfileReadinessActivityInputV1,
  outcome: ProfileReadinessActivityResultV1["outcome"] = "completed",
  errorCode?: string,
): ProfileReadinessActivityResultV1 {
  return {
    schemaVersion: 1,
    action: input.action,
    outcome,
    ...(errorCode ? { errorCode } : {}),
  };
}

describe("profile readiness Lambda durable workflow", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });

  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  it("replays checkpoints without repeating completed activity effects", async () => {
    const calls: ProfileReadinessActivityInputV1[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createProfileReadinessDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      expect(validateProfileReadinessActivityInput(event)).toBe(true);
      const input = event as ProfileReadinessActivityInputV1;
      calls.push(input);
      return activityResult(input);
    });

    const result = await runner.run({ payload: durableInput });

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toEqual({
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      eventId,
      operationId,
      state: "succeeded",
    });
    expect(calls.map((call) => call.action)).toEqual(["mark_running", "calculate_and_persist"]);
    expect(result.getInvocations().length).toBeGreaterThan(1);
  });

  it("retries a classified transient activity failure with bounded durable backoff", async () => {
    let calculateAttempts = 0;
    const runner = new LocalDurableTestRunner({
      handlerFunction: createProfileReadinessDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as ProfileReadinessActivityInputV1;
      if (input.action === "calculate_and_persist") {
        calculateAttempts += 1;
        if (calculateAttempts < 3) {
          return activityResult(input, "retryable_failure", "40001");
        }
      }
      return activityResult(input);
    });

    const result = await runner.run({ payload: durableInput });

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(calculateAttempts).toBe(3);
    expect(
      runner.getOperation(`${profileReadinessOperationNames.calculateAndPersist}.backoff-1`),
    ).toBeDefined();
  });

  it("does not retry a rejected activity and runs idempotent failure compensation", async () => {
    const actions: string[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createProfileReadinessDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as ProfileReadinessActivityInputV1;
      actions.push(input.action);
      if (input.action === "calculate_and_persist") {
        return activityResult(input, "non_retryable_failure", "ProfileReadinessInputNotFound");
      }
      return activityResult(input);
    });

    const result = await runner.run({ payload: durableInput });

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(result.getError().errorType).toBeDefined();
    expect(actions).toEqual(["mark_running", "calculate_and_persist", "mark_failed"]);
  });

  it("stops after the bounded retry budget and compensates the terminal failure", async () => {
    let calculateAttempts = 0;
    let compensationAttempts = 0;
    const runner = new LocalDurableTestRunner({
      handlerFunction: createProfileReadinessDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as ProfileReadinessActivityInputV1;
      if (input.action === "calculate_and_persist") {
        calculateAttempts += 1;
        return activityResult(input, "retryable_failure", "ETIMEDOUT");
      }
      if (input.action === "mark_failed") {
        compensationAttempts += 1;
      }
      return activityResult(input);
    });

    const result = await runner.run({ payload: durableInput });

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(calculateAttempts).toBe(5);
    expect(compensationAttempts).toBe(1);
  });

  it("rejects incompatible input and mutable activity targets", async () => {
    expect(validateProfileReadinessDurableInput({ ...durableInput, schemaVersion: 2 })).toBe(false);
    expect(validateProfileReadinessDurableInput({ ...durableInput, unexpected: true })).toBe(false);
    expect(isExactNumericVersionFunctionArn(activityArn)).toBe(true);
    expect(
      isExactNumericVersionFunctionArn(
        "arn:aws:lambda:us-east-2:123456789012:function:profile-readiness-activity:development",
      ),
    ).toBe(false);
    expect(() =>
      createProfileReadinessDurableHandler(
        "arn:aws:lambda:us-east-2:123456789012:function:profile-readiness-activity:development",
      ),
    ).toThrow(/exact numeric Lambda version ARN/u);
    expect(PROFILE_READINESS_WORKFLOW_DEFINITION_VERSION).toBe(1);
    expect(profileReadinessOperationNames).toEqual({
      markRunning: "profile-readiness.mark-running.v1",
      calculateAndPersist: "profile-readiness.calculate-and-persist.v1",
      compensateFailure: "profile-readiness.compensate-failure.v1",
    });
  });

  it("proves the bounded callback primitive without shipping a product callback", async () => {
    const submittedCallbackIds: string[] = [];
    const callbackHandler = withDurableExecution(async (_event: unknown, context) =>
      context.waitForCallback<string>(
        "synthetic-final-review-callback.v1",
        async (callbackId) => {
          submittedCallbackIds.push(callbackId);
        },
        { timeout: { minutes: 5 } },
      ),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: callbackHandler });
    const execution = runner.run({ payload: {} });
    const callback = await runner
      .getOperation("synthetic-final-review-callback.v1")
      .waitForData(WaitingOperationStatus.SUBMITTED);
    await callback.sendCallbackSuccess(JSON.stringify({ decision: "approved" }));

    const result = await execution;
    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(JSON.parse(result.getResult() ?? "null")).toEqual({ decision: "approved" });
    expect(submittedCallbackIds).toHaveLength(1);
  });

  it("proves a callback expires instead of waiting without a bound", async () => {
    const callbackHandler = withDurableExecution(async (_event: unknown, context) =>
      context.waitForCallback("synthetic-expiring-callback.v1", async () => undefined, {
        timeout: { seconds: 1 },
      }),
    );
    const runner = new LocalDurableTestRunner({ handlerFunction: callbackHandler });

    const result = await runner.run({ payload: {} });

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(result.getError().errorType).toMatch(/Callback/u);
  });
});

describe("profile readiness activity and terminal boundaries", () => {
  it("rejects malformed direct activity invocation before touching persistence", async () => {
    const store = {
      markOperationRunning: vi.fn(),
      getPreferencesById: vi.fn(),
      completeReadinessOperation: vi.fn(),
      failReadinessOperation: vi.fn(),
      failDurableReadinessOperation: vi.fn(),
    } as unknown as ProfileStore;

    const result = await createProfileReadinessActivityHandler(store)({
      action: "calculate_and_persist",
      preferences: { targetRoles: ["must-not-cross-boundary"] },
    });

    expect(result).toEqual({
      schemaVersion: 1,
      action: "mark_running",
      outcome: "non_retryable_failure",
      errorCode: "ActivityInputRejected",
    });
    expect(store.getPreferencesById).not.toHaveBeenCalled();
  });

  it.each([
    ["FAILED", "WorkflowFailed"],
    ["STOPPED", "WorkflowStopped"],
    ["TIMED_OUT", "WorkflowTimedOut"],
  ] as const)(
    "maps %s terminal state to one idempotent product-state reconciliation",
    async (status, code) => {
      const failDurableReadinessOperation = vi.fn(async () => undefined);
      const handler = createDurableTerminalHandler(
        { failDurableReadinessOperation },
        activityArn.replace("profile-readiness-activity", "profile-readiness-workflow"),
      );
      const event: DurableTerminalEvent = {
        source: "aws.lambda",
        "detail-type": "Durable Execution Status Change",
        detail: {
          durableExecutionArn: "arn:synthetic:durable-execution",
          durableExecutionName: `outbox-${eventId}`,
          functionArn: activityArn.replace(
            "profile-readiness-activity",
            "profile-readiness-workflow",
          ),
          status,
        },
      };

      await expect(handler(event)).resolves.toEqual({ handled: true });
      expect(failDurableReadinessOperation).toHaveBeenCalledWith(`outbox-${eventId}`, code);
    },
  );

  it("ignores non-terminal success and rejects a cross-function terminal event", async () => {
    const failDurableReadinessOperation = vi.fn(async () => undefined);
    const expectedFunctionArn = activityArn.replace(
      "profile-readiness-activity",
      "profile-readiness-workflow",
    );
    const handler = createDurableTerminalHandler(
      { failDurableReadinessOperation },
      expectedFunctionArn,
    );
    const event: DurableTerminalEvent = {
      source: "aws.lambda",
      "detail-type": "Durable Execution Status Change",
      detail: {
        durableExecutionArn: "arn:synthetic:durable-execution",
        durableExecutionName: `outbox-${eventId}`,
        functionArn: expectedFunctionArn,
        status: "SUCCEEDED",
      },
    };

    await expect(handler(event)).resolves.toEqual({ handled: false });
    await expect(
      handler({ ...event, detail: { ...event.detail, functionArn: activityArn } }),
    ).rejects.toThrow("DurableTerminalEventRejected");
    expect(failDurableReadinessOperation).not.toHaveBeenCalled();
  });
});
