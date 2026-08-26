import {
  generatedSyntheticProviderFaultAdapterVersion,
  generatedSyntheticProviderFaultSourceId,
} from "@ai-job-apply/ingestion-worker";
import type { DurableContext } from "@aws/durable-execution-sdk-js";
import { describe, expect, it, vi } from "vitest";
import {
  createIngestionProviderFailureWorkflow,
  INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
  validateIngestionProviderFailureActivityInput,
  validateIngestionProviderFailureActivityResult,
  validateIngestionProviderFailureWorkflowInput,
} from "./ingestion-provider-failure-durable.js";

const activityArn = "arn:aws:lambda:us-east-2:123456789012:function:synthetic-ingestion-activity:9";
const input = {
  schemaVersion: 1,
  workflowDefinitionVersion: 1,
  fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
  runId: "3f4d7a90-c1b2-4e6f-8a9b-0123456789ab",
  reviewedConfigSha256: "a".repeat(64),
  releaseSourceSha: "b".repeat(40),
} as const;
const retry = {
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
} as const;
const recovery = {
  schemaVersion: 1,
  fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
  attempt: 2,
  status: "succeeded",
  providerRequests: 0,
  observationCount: 0,
  createdCount: 0,
  updatedCount: 0,
} as const;

describe("ingestion provider-failure durable fixture", () => {
  it("accepts only the exact run, reviewed-config, and release-source binding", () => {
    expect(validateIngestionProviderFailureWorkflowInput(input)).toBe(true);
    expect(validateIngestionProviderFailureActivityInput({ ...input, attempt: 1 })).toBe(true);
    expect(validateIngestionProviderFailureActivityInput({ ...input, attempt: 2 })).toBe(true);
    for (const invalid of [
      { ...input, unexpected: "raw" },
      { ...input, runId: input.runId.toUpperCase() },
      { ...input, runId: "3f4d7a90-c1b2-7e6f-8a9b-0123456789ab" },
      { ...input, reviewedConfigSha256: "A".repeat(64) },
      { ...input, releaseSourceSha: "b".repeat(39) },
      { ...input, fixtureKind: "provider" },
    ]) {
      expect(validateIngestionProviderFailureWorkflowInput(invalid)).toBe(false);
    }
    expect(validateIngestionProviderFailureActivityInput({ ...input, attempt: 0 })).toBe(false);
    expect(validateIngestionProviderFailureActivityInput({ ...input, attempt: 3 })).toBe(false);
    expect(
      validateIngestionProviderFailureActivityInput({ ...input, attempt: 1, raw: "provider" }),
    ).toBe(false);
  });

  it("accepts only the fixed attempt-one fault and attempt-two empty recovery results", () => {
    expect(validateIngestionProviderFailureActivityResult(retry)).toBe(true);
    expect(validateIngestionProviderFailureActivityResult(recovery)).toBe(true);
    for (const invalid of [
      { ...retry, retryAfterMs: 999 },
      { ...retry, reason: "timeout" },
      { ...retry, attempt: 2 },
      { ...retry, providerRequests: 1 },
      { ...retry, raw: "provider" },
      { ...recovery, attempt: 1 },
      { ...recovery, observationCount: 1 },
      { ...recovery, withdrawals: [] },
    ]) {
      expect(validateIngestionProviderFailureActivityResult(invalid)).toBe(false);
    }
  });

  it("runs one exact fault, one durable wait, and one empty recovery", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(retry).mockResolvedValueOnce(recovery);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      createIngestionProviderFailureWorkflow(activityArn)(input, {
        invoke,
        wait,
      } as unknown as DurableContext),
    ).resolves.toEqual({
      schemaVersion: 1,
      profile: "d1_deployed_provider_failure_durable_v1",
      fixtureKind: INGESTION_PROVIDER_FAILURE_FIXTURE_KIND,
      sourceId: generatedSyntheticProviderFaultSourceId,
      adapterVersion: generatedSyntheticProviderFaultAdapterVersion,
      runId: input.runId,
      reviewedConfigSha256: input.reviewedConfigSha256,
      releaseSourceSha: input.releaseSourceSha,
      providerFaultsInjected: 1,
      providerFailuresObserved: 1,
      recoveryAttempts: 1,
      recoveriesSucceeded: 1,
      providerRequests: 0,
      observationCount: 0,
      createdCount: 0,
      updatedCount: 0,
    });
    expect(invoke.mock.calls).toEqual([
      ["ingestion.provider-failure.attempt.1", activityArn, { ...input, attempt: 1 }],
      ["ingestion.provider-failure.attempt.2", activityArn, { ...input, attempt: 2 }],
    ]);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith("ingestion.provider-failure.retry.1", { seconds: 1 });
  });

  it("fails closed before or between effects on every malformed boundary", async () => {
    const invoke = vi.fn();
    const wait = vi.fn();
    await expect(
      createIngestionProviderFailureWorkflow(activityArn)(
        { ...input, unexpected: "raw" } as never,
        { invoke, wait } as unknown as DurableContext,
      ),
    ).rejects.toThrow("IngestionProviderFailureWorkflowInputRejected");
    expect(invoke).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();

    for (const invalidFirst of [
      recovery,
      { ...retry, retryAfterMs: 2_000 },
      { ...retry, providerRequests: 1 },
      { ...retry, raw: "provider" },
    ]) {
      invoke.mockReset().mockResolvedValue(invalidFirst);
      wait.mockReset();
      await expect(
        createIngestionProviderFailureWorkflow(activityArn)(input, {
          invoke,
          wait,
        } as unknown as DurableContext),
      ).rejects.toThrow("IngestionProviderFailureActivityContractRejected");
      expect(wait).not.toHaveBeenCalled();
    }

    invoke
      .mockReset()
      .mockResolvedValueOnce(retry)
      .mockResolvedValueOnce({
        ...recovery,
        observationCount: 1,
      });
    wait.mockReset().mockResolvedValue(undefined);
    await expect(
      createIngestionProviderFailureWorkflow(activityArn)(input, {
        invoke,
        wait,
      } as unknown as DurableContext),
    ).rejects.toThrow("IngestionProviderFailureActivityContractRejected");
    expect(wait).toHaveBeenCalledOnce();
  });

  it("requires the existing activity's exact numeric Lambda version", () => {
    for (const invalid of [
      activityArn.replace(/:9$/u, ":development"),
      activityArn.replace(/:9$/u, ":$LATEST"),
      activityArn.replace(/:9$/u, ""),
      activityArn.replace("us-east-2", "US-EAST-2"),
    ]) {
      expect(() => createIngestionProviderFailureWorkflow(invalid)).toThrow(
        "exact numeric Lambda version ARN",
      );
    }
  });
});
