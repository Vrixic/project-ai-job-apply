import {
  type CoverLetterPreparationPort,
  type PreparationActivityStore,
  PreparationNotFoundError,
  type PreparationRecord,
} from "@ai-job-apply/applications-service";
import { ExecutionStatus, LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApplicationPreparationActivityHandler } from "./application-preparation-activity.js";
import {
  type ApplicationPreparationActivityInput,
  type ApplicationPreparationActivityResult,
  type ApplicationPreparationDurableInput,
  validateApplicationPreparationActivityInput,
  validateApplicationPreparationActivityResult,
  validateApplicationPreparationDurableInput,
} from "./application-preparation-contract.js";
import {
  applicationPreparationOperations,
  createApplicationPreparationDurableHandler,
} from "./application-preparation-durable.js";

const activityArn =
  "arn:aws:lambda:us-east-2:123456789012:function:application-preparation-activity:7";
const eventId = "019d04cf-1f80-7000-8000-000000000001";
const preparationId = "019d04cf-1f80-7000-8000-000000000002";
const durableInput: ApplicationPreparationDurableInput = {
  schemaVersion: 1,
  eventId,
  eventType: "application.packet-preparation.requested.v1",
  data: { preparationId },
};
const activityInput: ApplicationPreparationActivityInput = {
  schemaVersion: 1,
  workflowDefinitionVersion: 1,
  eventId,
  preparationId,
  action: "advance",
};
function completed(
  input: ApplicationPreparationActivityInput,
): ApplicationPreparationActivityResult {
  return {
    schemaVersion: 1,
    action: input.action,
    preparationId: input.preparationId,
    outcome: "completed",
  };
}

describe("application preparation durable workflow", () => {
  beforeAll(async () => {
    await LocalDurableTestRunner.setupTestEnvironment({ skipTime: true });
  });
  afterAll(async () => {
    await LocalDurableTestRunner.teardownTestEnvironment();
  });

  it("replays one checkpointed activity without repeating its completed effect", async () => {
    const calls: ApplicationPreparationActivityInput[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createApplicationPreparationDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      expect(validateApplicationPreparationActivityInput(event)).toBe(true);
      const input = event as ApplicationPreparationActivityInput;
      calls.push(input);
      return completed(input);
    });
    const result = await runner.run({ payload: durableInput });
    expect(result.getStatus()).toBe(ExecutionStatus.SUCCEEDED);
    expect(result.getResult()).toEqual({
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      eventId,
      preparationId,
      state: "completed",
    });
    expect(calls).toEqual([activityInput]);
    expect(result.getInvocations().length).toBeGreaterThan(1);
    expect(
      runner.getOperation(`${applicationPreparationOperations.advance}.attempt-1`),
    ).toBeDefined();
  });

  it("retries a classified pending result and never places the draft into durable inputs", async () => {
    let attempts = 0;
    const calls: ApplicationPreparationActivityInput[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createApplicationPreparationDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as ApplicationPreparationActivityInput;
      calls.push(input);
      return ++attempts === 1
        ? { ...completed(input), outcome: "retryable_failure", errorCode: "generation_in_progress" }
        : completed(input);
    });
    expect((await runner.run({ payload: durableInput })).getStatus()).toBe(
      ExecutionStatus.SUCCEEDED,
    );
    expect(calls).toEqual([activityInput, activityInput]);
    expect(
      runner.getOperation(`${applicationPreparationOperations.advance}.attempt-2`),
    ).toBeDefined();
  });

  it("stops after five advances and compensates without an error payload", async () => {
    const calls: ApplicationPreparationActivityInput[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createApplicationPreparationDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as ApplicationPreparationActivityInput;
      calls.push(input);
      return input.action === "advance"
        ? { ...completed(input), outcome: "retryable_failure", errorCode: "context_unavailable" }
        : completed(input);
    });
    const result = await runner.run({ payload: durableInput });
    expect(result.getStatus()).toBe(ExecutionStatus.FAILED);
    expect(calls.map((input) => input.action)).toEqual([...Array(5).fill("advance"), "fail"]);
    expect(calls.at(-1)).toEqual({ ...activityInput, action: "fail" });
  });

  it.each(["rejected", "invalid_result", "foreign_identity"])(
    "does not retry %s before compensation",
    async (reason) => {
      const calls: ApplicationPreparationActivityInput[] = [];
      const runner = new LocalDurableTestRunner({
        handlerFunction: createApplicationPreparationDurableHandler(activityArn),
      });
      runner.registerFunction(activityArn, async (event) => {
        const input = event as ApplicationPreparationActivityInput;
        calls.push(input);
        if (input.action === "fail") return completed(input);
        if (reason === "rejected")
          return {
            ...completed(input),
            outcome: "non_retryable_failure",
            errorCode: "candidate_inactive",
          };
        if (reason === "foreign_identity") return { ...completed(input), preparationId: eventId };
        return { ...completed(input), surplus: true };
      });
      expect((await runner.run({ payload: durableInput })).getStatus()).toBe(
        ExecutionStatus.FAILED,
      );
      expect(calls.map((input) => input.action)).toEqual(["advance", "fail"]);
    },
  );

  it("bounds failed compensation as well as advance attempts", async () => {
    const calls: ApplicationPreparationActivityInput[] = [];
    const runner = new LocalDurableTestRunner({
      handlerFunction: createApplicationPreparationDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, async (event) => {
      const input = event as ApplicationPreparationActivityInput;
      calls.push(input);
      return { ...completed(input), outcome: "retryable_failure", errorCode: "store_unavailable" };
    });
    expect((await runner.run({ payload: durableInput })).getStatus()).toBe(ExecutionStatus.FAILED);
    expect(calls.map((input) => input.action)).toEqual([
      ...Array(5).fill("advance"),
      ...Array(5).fill("fail"),
    ]);
  });

  it("rejects invalid inputs before any activity dispatch", async () => {
    const invoke = vi.fn(async () => completed(activityInput));
    const runner = new LocalDurableTestRunner({
      handlerFunction: createApplicationPreparationDurableHandler(activityArn),
    });
    runner.registerFunction(activityArn, invoke);
    expect(
      (
        await runner.run({
          payload: { ...durableInput, data: { preparationId, candidateText: "synthetic-only" } },
        })
      ).getStatus(),
    ).toBe(ExecutionStatus.FAILED);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses aliases, unqualified ARNs and unrelated targets", () => {
    for (const arn of [
      activityArn.replace(/:7$/u, ":live"),
      activityArn.replace(/:7$/u, ":$LATEST"),
      activityArn.replace(/:7$/u, ""),
      "https://example.invalid",
    ]) {
      expect(() => createApplicationPreparationDurableHandler(arn)).toThrow("exact numeric");
    }
  });
});

describe("application preparation internal contracts", () => {
  it("requires exact data-only identifiers and fixed result codes", () => {
    expect(validateApplicationPreparationDurableInput(durableInput)).toBe(true);
    expect(validateApplicationPreparationActivityInput(activityInput)).toBe(true);
    expect(
      validateApplicationPreparationActivityResult(completed(activityInput), activityInput),
    ).toBe(true);
    for (const input of [
      null,
      [],
      { ...activityInput, schemaVersion: 2 },
      { ...activityInput, workflowDefinitionVersion: 2 },
      { ...activityInput, ownerUserId: eventId },
      { ...activityInput, eventId: "invalid" },
      { ...activityInput, action: "generate" },
    ])
      expect(validateApplicationPreparationActivityInput(input)).toBe(false);
    for (const result of [
      { ...completed(activityInput), errorCode: undefined },
      { ...completed(activityInput), action: "fail" },
      { ...completed(activityInput), preparationId: eventId },
      {
        ...completed(activityInput),
        outcome: "retryable_failure",
        errorCode: "provider diagnostic",
      },
      { ...completed(activityInput), outcome: "completed", text: "synthetic-only" },
    ])
      expect(validateApplicationPreparationActivityResult(result, activityInput)).toBe(false);
  });

  it("rejects hidden, inherited and accessor fields without evaluating them", () => {
    const getter = vi.fn(() => eventId);
    const accessor = { ...activityInput };
    Object.defineProperty(accessor, "eventId", { enumerable: true, get: getter });
    expect(validateApplicationPreparationActivityInput(accessor)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const hidden = { ...activityInput };
    Object.defineProperty(hidden, "eventId", { enumerable: false });
    expect(validateApplicationPreparationActivityInput(hidden)).toBe(false);
    expect(
      validateApplicationPreparationActivityInput(
        Object.assign(Object.create({ extra: true }), activityInput),
      ),
    ).toBe(false);
    expect(
      validateApplicationPreparationActivityInput({
        ...activityInput,
        [Symbol("hidden")]: "synthetic-only",
      }),
    ).toBe(false);
    expect(
      validateApplicationPreparationDurableInput({
        ...durableInput,
        data: { preparationId, extra: true },
      }),
    ).toBe(false);
  });
});

const preparation: PreparationRecord = {
  id: preparationId,
  ownerUserId: eventId,
  applicationId: eventId,
  basePacketId: eventId,
  expectedRevision: 2,
  jobContextHash: "a".repeat(64),
  confirmedFactsHash: "b".repeat(64),
  noticeVersion: "openai-cover-letter.v1",
  approvedAt: new Date("2026-10-02T12:00:00Z"),
  expiresAt: new Date("2026-10-02T12:15:00Z"),
  generationClaimedAt: null,
  state: "queued",
  resultPacketId: null,
  errorCode: null,
  createdAt: new Date("2026-10-02T12:00:00Z"),
  updatedAt: new Date("2026-10-02T12:00:00Z"),
};
function activityFixture() {
  const store = {
    getPreparationVaultReferences: vi.fn<PreparationActivityStore["getPreparationVaultReferences"]>(
      async () => [],
    ),
    getPreparationForEvent: vi.fn(async () => preparation),
    claimPreparationGeneration: vi.fn<PreparationActivityStore["claimPreparationGeneration"]>(
      async () => ({ kind: "claimed", preparation }),
    ),
    completePreparation: vi.fn(async () => ({ ...preparation, state: "succeeded" as const })),
    failPreparation: vi.fn(async () => ({ ...preparation, state: "failed" as const })),
  };
  const documents: CoverLetterPreparationPort = {
    context: async () => ({
      jobContextHash: preparation.jobContextHash,
      confirmedFactsHash: preparation.confirmedFactsHash,
    }),
    recover: async () => null,
    generate: async () => ({
      kind: "ready",
      letter: { contentSha256: "c".repeat(64), sourceFactIds: [preparationId], confidence: 1 },
    }),
  };
  return {
    store,
    documents,
    handler: createApplicationPreparationActivityHandler(store, documents),
  };
}
describe("private application preparation activity boundary", () => {
  it("returns only identifiers/status and performs idempotent fixed-code compensation", async () => {
    const { handler, store } = activityFixture();
    expect(await handler(activityInput)).toEqual(completed(activityInput));
    expect(await handler({ ...activityInput, action: "fail" })).toEqual(
      completed({ ...activityInput, action: "fail" }),
    );
    expect(store.failPreparation).toHaveBeenCalledWith(
      eventId,
      preparationId,
      "generation_unavailable",
    );
  });
  it.each([
    [new PreparationNotFoundError(), "non_retryable_failure", "preparation_missing"],
    [
      Object.assign(new Error("synthetic-private-diagnostic"), { code: "42501" }),
      "non_retryable_failure",
      "candidate_inactive",
    ],
    [
      Object.assign(new Error("synthetic-private-diagnostic"), { code: "40001" }),
      "retryable_failure",
      "store_unavailable",
    ],
    [new Error("synthetic-private-diagnostic"), "non_retryable_failure", "activity_failed"],
  ] as const)(
    "maps exceptions to fixed codes without reflection",
    async (error, outcome, errorCode) => {
      const { handler, store } = activityFixture();
      store.getPreparationForEvent.mockRejectedValueOnce(error);
      expect(await handler(activityInput)).toEqual({
        schemaVersion: 1,
        action: "advance",
        preparationId,
        outcome,
        errorCode,
      });
    },
  );
  it("does not evaluate an exception's injected code accessor", async () => {
    const { handler, store } = activityFixture();
    const getter = vi.fn(() => {
      throw new Error("synthetic-private-diagnostic");
    });
    store.getPreparationForEvent.mockRejectedValueOnce(
      Object.defineProperty(new Error("hidden"), "code", { get: getter }),
    );
    expect(await handler(activityInput)).toMatchObject({
      outcome: "non_retryable_failure",
      errorCode: "activity_failed",
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects extra payload values before database work", async () => {
    const { handler, store } = activityFixture();
    await expect(handler({ ...activityInput, candidateText: "synthetic-only" })).rejects.toThrow(
      "ApplicationPreparationActivityInputRejected",
    );
    expect(store.getPreparationForEvent).not.toHaveBeenCalled();
    expect(store.failPreparation).not.toHaveBeenCalled();
  });
});
