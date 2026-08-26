import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { describe, expect, it, vi } from "vitest";
import {
  createIngestionWorkflow,
  createProductionIngestionWorkflow,
  isExactNumericLambdaVersionArn,
  validateIngestionActivityInput,
  validateIngestionActivityResult,
  validateIngestionWorkflowInput,
} from "./ingestion-durable.js";
import { INGESTION_PROVIDER_FAILURE_FIXTURE_KIND } from "./ingestion-provider-failure-durable.js";

const activityArn = "arn:aws:lambda:us-east-1:123456789012:function:ingestion-activity:7";
const event = {
  schemaVersion: 1,
  workflowDefinitionVersion: 1,
  dispatchId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d",
  executionId: "a".repeat(64),
  workflowGeneration: 1,
} as const;

describe("ingestion durable workflow", () => {
  it("dispatches the strict provider-failure discriminator through the production workflow", async () => {
    const fixture = {
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
      runId: "3f4d7a90-c1b2-4e6f-8a9b-0123456789ab",
      reviewedConfigSha256: "a".repeat(64),
      releaseSourceSha: "b".repeat(40),
    } as const;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
        attempt: 2,
        status: "succeeded",
        providerRequests: 0,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
      });
    const context = { invoke, wait: vi.fn() } as unknown as DurableContext;

    await expect(
      createProductionIngestionWorkflow(activityArn)(fixture, context),
    ).resolves.toMatchObject({
      profile: "d1_deployed_provider_failure_durable_v1",
      runId: fixture.runId,
      reviewedConfigSha256: fixture.reviewedConfigSha256,
      releaseSourceSha: fixture.releaseSourceSha,
      providerFaultsInjected: 1,
      recoveriesSucceeded: 1,
    });
    await expect(
      createProductionIngestionWorkflow(activityArn)(
        { ...fixture, fixtureKind: "unknown-fixture" } as never,
        context,
      ),
    ).rejects.toThrow("IngestionProviderFailureWorkflowInputRejected");
  });

  it("requires exact versioned ARNs and strict identifier-only contracts", () => {
    expect(isExactNumericLambdaVersionArn(activityArn)).toBe(true);
    expect(isExactNumericLambdaVersionArn(activityArn.replace(":7", ":live"))).toBe(false);
    expect(
      isExactNumericLambdaVersionArn(
        `arn:aws:lambda:us-east-1:123456789012:function:${"a".repeat(64)}:7`,
      ),
    ).toBe(true);
    expect(
      isExactNumericLambdaVersionArn(
        `arn:aws:lambda:us-east-1:123456789012:function:${"a".repeat(65)}:7`,
      ),
    ).toBe(false);
    expect(validateIngestionWorkflowInput(event)).toBe(true);
    expect(validateIngestionWorkflowInput({ ...event, raw: "candidate" })).toBe(false);
    expect(validateIngestionActivityInput({ ...event, action: "advance" })).toBe(true);
    expect(
      validateIngestionActivityResult({
        schemaVersion: 1,
        action: "terminal",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 2,
        status: "succeeded",
        progressKnown: true,
        observationCount: 1,
        createdCount: 1,
        updatedCount: 0,
      }),
    ).toBe(true);
  });

  it("replays waits and activities using deterministic operation names", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        action: "wait",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 0,
        waitMilliseconds: 1_500,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        action: "run",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 1,
        leaseId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d",
        leaseExpiresAt: "2026-08-16T12:05:00.000Z",
        attempt: 1,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        action: "terminal",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 2,
        status: "succeeded",
        progressKnown: true,
        observationCount: 2,
        createdCount: 2,
        updatedCount: 0,
      });
    const wait = vi.fn().mockResolvedValue(undefined);
    const context = { invoke, wait } as unknown as DurableContext;

    await expect(createIngestionWorkflow(activityArn)(event, context)).resolves.toEqual({
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      dispatchId: event.dispatchId,
      executionId: event.executionId,
      workflowGeneration: event.workflowGeneration,
      status: "succeeded",
      progressKnown: true,
      observationCount: 2,
      createdCount: 2,
      updatedCount: 0,
    });
    expect(wait).toHaveBeenCalledWith("ingestion.wait.0", { seconds: 2 });
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      "ingestion.advance.0",
      "ingestion.advance.0",
      "ingestion.run.1",
    ]);
  });

  it("rejects activity output containing raw or excess fields", async () => {
    const context = {
      invoke: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        action: "terminal",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 1,
        status: "succeeded",
        progressKnown: true,
        observationCount: 0,
        createdCount: 0,
        updatedCount: 0,
        sourceUrl: "https://candidate.example.test/private",
      }),
      wait: vi.fn(),
    } as unknown as DurableContext;
    await expect(createIngestionWorkflow(activityArn)(event, context)).rejects.toThrow(
      "IngestionActivityContractRejected",
    );
  });

  it("rejects a valid-shaped activity result from another dispatch or generation", async () => {
    for (const stale of [
      { dispatchId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e30" },
      { workflowGeneration: 2 },
    ]) {
      const context = {
        invoke: vi.fn().mockResolvedValue({
          schemaVersion: 1,
          action: "terminal",
          dispatchId: event.dispatchId,
          executionId: event.executionId,
          workflowGeneration: event.workflowGeneration,
          revision: 1,
          status: "succeeded",
          progressKnown: true,
          observationCount: 0,
          createdCount: 0,
          updatedCount: 0,
          ...stale,
        }),
        wait: vi.fn(),
      } as unknown as DurableContext;
      await expect(createIngestionWorkflow(activityArn)(event, context)).rejects.toThrow(
        "IngestionActivityContractRejected",
      );
    }
  });

  it("rejects a run settlement that does not advance the exact claimed revision", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1,
        action: "run",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 1,
        leaseId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d",
        leaseExpiresAt: "2026-08-16T12:05:00.000Z",
        attempt: 1,
      })
      .mockResolvedValueOnce({
        schemaVersion: 1,
        action: "wait",
        dispatchId: event.dispatchId,
        executionId: event.executionId,
        workflowGeneration: event.workflowGeneration,
        revision: 1,
        waitMilliseconds: 1_000,
      });
    await expect(
      createIngestionWorkflow(activityArn)(event, {
        invoke,
        wait: vi.fn(),
      } as unknown as DurableContext),
    ).rejects.toThrow("IngestionActivityLeaseSettlementRejected");
  });
});
