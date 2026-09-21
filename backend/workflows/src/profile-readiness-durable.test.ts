import type { ProfileStore } from "@ai-job-apply/profile-service";
import { withDurableExecution } from "@aws/durable-execution-sdk-js";
import {
  ExecutionStatus,
  LocalDurableTestRunner,
  WaitingOperationStatus,
} from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCandidateRightsActivityHandler } from "./candidate-rights-activities.js";
import {
  type CandidateRightsActivityInputV1,
  type CandidateRightsActivityResultV1,
  candidateRightsOperationNames,
  createCandidateRightsDurableHandler,
  validateCandidateRightsActivityInput,
  validateCandidateRightsDurableInput,
} from "./candidate-rights-durable.js";
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
  createCandidateRightsMaintenanceHandler,
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

const exportId = "019c2b89-79b2-7000-8000-000000000004";
const deletionRequestId = "019c2b89-79b2-7000-8000-000000000005";
const exportInput: DurableExecutionPayloadV1 = {
  schemaVersion: 1,
  eventId,
  eventType: "profile.data-export.requested.v1",
  data: { dataExportId: exportId, operationId, policyVersion: "policy-2026-08" },
};
const deletionInput: DurableExecutionPayloadV1 = {
  schemaVersion: 1,
  eventId,
  eventType: "profile.account-deletion.confirmed.v1",
  data: { deletionRequestId, operationId, policyVersion: "policy-2026-08" },
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

function candidateRightsActivityResult(
  input: CandidateRightsActivityInputV1,
  outcome: CandidateRightsActivityResultV1["outcome"] = "completed",
  errorCode?: string,
): CandidateRightsActivityResultV1 {
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

  it("runs the candidate export stages and compensates a rejected assembly", async () => {
    const actions: CandidateRightsActivityInputV1[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createCandidateRightsDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      expect(validateCandidateRightsActivityInput(event)).toBe(true);
      const input = event as CandidateRightsActivityInputV1;
      actions.push(input);
      return input.action === "export_assemble"
        ? candidateRightsActivityResult(input, "non_retryable_failure", "InventoryIncomplete")
        : candidateRightsActivityResult(input);
    });

    const result = await runner.run({ payload: exportInput });

    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(actions.map((input) => input.action)).toEqual([
      "export_begin",
      "export_assemble",
      "export_fail",
    ]);
    expect(actions[2]?.errorCode).toBe("WorkflowNonRetryableFailure");
  });

  it("runs irreversible deletion in ordered durable stages", async () => {
    const actions: string[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createCandidateRightsDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as CandidateRightsActivityInputV1;
      actions.push(input.action);
      return candidateRightsActivityResult(input);
    });

    const result = await runner.run({ payload: deletionInput });

    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toMatchObject({
      resourceId: deletionRequestId,
      operationId,
      kind: "account_deletion",
      state: "succeeded",
    });
    expect(actions).toEqual([
      "deletion_record_recovery",
      "deletion_delete_active_systems",
      "deletion_reconcile_subprocessors",
      "deletion_complete",
    ]);
    expect(
      runner.getOperation(`${candidateRightsOperationNames.deletionComplete}.attempt-1`),
    ).toBeDefined();
  });

  it("strictly rejects malformed candidate-rights inputs", () => {
    expect(validateCandidateRightsDurableInput(exportInput)).toBe(true);
    expect(validateCandidateRightsDurableInput(deletionInput)).toBe(true);
    expect(validateCandidateRightsDurableInput({ ...exportInput, extra: true })).toBe(false);
    expect(
      validateCandidateRightsDurableInput({
        ...deletionInput,
        data: { ...deletionInput.data, policyVersion: "" },
      }),
    ).toBe(false);
  });

  it("dispatches strict candidate-rights activities and classifies safe failures", async () => {
    const store = {
      beginExport: vi.fn(async () => undefined),
      assembleExport: vi.fn(async () => {
        throw Object.assign(new Error("hidden"), { code: "40001" });
      }),
      failExport: vi.fn(async () => undefined),
      recordDeletionRecovery: vi.fn(async () => {
        throw new Error("CandidateDeletionRecoveryConflict");
      }),
      deleteActiveSystems: vi.fn(async () => undefined),
      reconcileSubprocessors: vi.fn(async () => undefined),
      completeDeletion: vi.fn(async () => undefined),
    };
    const handler = createCandidateRightsActivityHandler(store as never);
    const base = {
      schemaVersion: 1 as const,
      workflowDefinitionVersion: 1 as const,
      eventId,
      resourceId: exportId,
      operationId,
      policyVersion: "policy-2026-08",
    };

    await expect(handler({ ...base, action: "export_begin" })).resolves.toEqual({
      schemaVersion: 1,
      action: "export_begin",
      outcome: "completed",
    });
    await expect(handler({ ...base, action: "export_assemble" })).resolves.toEqual({
      schemaVersion: 1,
      action: "export_assemble",
      outcome: "retryable_failure",
      errorCode: "40001",
    });
    await expect(handler({ ...base, action: "export_fail" })).resolves.toMatchObject({
      outcome: "non_retryable_failure",
      errorCode: "ActivityInputRejected",
    });
    await expect(handler({ ...base, action: "deletion_record_recovery" })).resolves.toMatchObject({
      outcome: "non_retryable_failure",
      errorCode: "CandidateDeletionRecoveryConflict",
    });
    expect(store.beginExport).toHaveBeenCalledOnce();
    expect(store.assembleExport).toHaveBeenCalledOnce();
    expect(store.failExport).not.toHaveBeenCalled();
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
  it("accepts only the exact scheduled candidate-rights maintenance rule", async () => {
    const expireDueExports = vi.fn(async () => ({ scanned: 2, expired: 2 }));
    const purgeDeletedResumes = vi.fn(async () => ({
      scanned: 3,
      purged: 3,
      failed: 0,
      heldWaiting: 1,
    }));
    const ruleArn =
      "arn:aws:events:us-east-2:123456789012:rule/ai-job-apply-development-candidate-rights-maintenance";
    const handler = createCandidateRightsMaintenanceHandler(
      { expireDueExports, purgeDeletedResumes },
      ruleArn,
    );
    await expect(
      handler({
        source: "aws.events",
        "detail-type": "Scheduled Event",
        account: "123456789012",
        region: "us-east-2",
        resources: [ruleArn],
        detail: {},
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      scanned: 2,
      expired: 2,
      resumePurge: { scanned: 3, purged: 3, failed: 0, heldWaiting: 1 },
    });
    await expect(
      handler({
        source: "aws.events",
        "detail-type": "Scheduled Event",
        account: "123456789012",
        region: "us-east-2",
        resources: [`${ruleArn}-other`],
        detail: {},
      }),
    ).rejects.toThrow("CandidateRightsMaintenanceEventRejected");
    expect(expireDueExports).toHaveBeenCalledOnce();
    expect(purgeDeletedResumes).toHaveBeenCalledOnce();
  });

  it("runs both sweeps even when one fails, then raises so the alarms fire (ADR-034)", async () => {
    const ruleArn =
      "arn:aws:events:us-east-2:123456789012:rule/ai-job-apply-development-candidate-rights-maintenance";
    const event = {
      source: "aws.events",
      "detail-type": "Scheduled Event",
      account: "123456789012",
      region: "us-east-2",
      resources: [ruleArn],
      detail: {},
    };
    const ok = { scanned: 0, expired: 0 };
    const purged = { scanned: 1, purged: 1, failed: 0, heldWaiting: 0 };
    const exportsFail = vi.fn(async () => {
      throw new Error("ExportSweepFailed");
    });
    const purge = vi.fn(async () => purged);
    await expect(
      createCandidateRightsMaintenanceHandler(
        { expireDueExports: exportsFail, purgeDeletedResumes: purge },
        ruleArn,
      )(event),
    ).rejects.toThrow("ExportSweepFailed");
    expect(purge).toHaveBeenCalledOnce();

    const exportsOk = vi.fn(async () => ok);
    const purgeFails = vi.fn(async () => {
      throw new Error("PurgeSweepFailed");
    });
    await expect(
      createCandidateRightsMaintenanceHandler(
        { expireDueExports: exportsOk, purgeDeletedResumes: purgeFails },
        ruleArn,
      )(event),
    ).rejects.toThrow("PurgeSweepFailed");
    expect(exportsOk).toHaveBeenCalledOnce();

    const partial = vi.fn(async () => ({ scanned: 2, purged: 1, failed: 1, heldWaiting: 0 }));
    await expect(
      createCandidateRightsMaintenanceHandler(
        { expireDueExports: exportsOk, purgeDeletedResumes: partial },
        ruleArn,
      )(event),
    ).rejects.toThrow("ResumePurgeIncomplete");
  });

  it("rejects malformed direct activity invocation before touching persistence", async () => {
    const store = {
      markOperationRunning: vi.fn(),
      getPreferencesById: vi.fn(),
      completeReadinessOperation: vi.fn(),
      failReadinessOperation: vi.fn(),
      reconcileDurableOperationFailure: vi.fn(),
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
      const reconcileDurableOperationFailure = vi.fn(async () => undefined);
      const handler = createDurableTerminalHandler(
        { reconcileDurableOperationFailure },
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
      expect(reconcileDurableOperationFailure).toHaveBeenCalledWith(`outbox-${eventId}`, code);
    },
  );

  it("ignores non-terminal success and rejects a cross-function terminal event", async () => {
    const reconcileDurableOperationFailure = vi.fn(async () => undefined);
    const expectedFunctionArn = activityArn.replace(
      "profile-readiness-activity",
      "profile-readiness-workflow",
    );
    const handler = createDurableTerminalHandler(
      { reconcileDurableOperationFailure },
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
    expect(reconcileDurableOperationFailure).not.toHaveBeenCalled();
  });
});
