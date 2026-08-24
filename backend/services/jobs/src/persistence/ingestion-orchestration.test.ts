import { describe, expect, it } from "vitest";
import {
  assertPersistedIngestionCheckpoint,
  durableIngestionExecutionName,
} from "./ingestion-orchestration.js";

const executionId = "a".repeat(64);

describe("ingestion orchestration persistence contract", () => {
  it("accepts the exact synthetic pending checkpoint and derives a stable generation name", () => {
    const checkpoint = {
      schemaVersion: 1,
      executionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
      state: "pending",
      revision: 0,
      attempt: 1,
      withdrawalInferred: false,
    } as const;
    expect(() => assertPersistedIngestionCheckpoint(checkpoint)).not.toThrow();
    expect(durableIngestionExecutionName(executionId, 1)).toMatch(/^[a-f0-9]{64}$/u);
    expect(durableIngestionExecutionName(executionId, 1)).toBe(
      durableIngestionExecutionName(executionId, 1),
    );
    expect(durableIngestionExecutionName(executionId, 2)).not.toBe(
      durableIngestionExecutionName(executionId, 1),
    );
  });

  it("rejects excess keys, malformed source IDs, and malformed settled aggregates", () => {
    const base = {
      schemaVersion: 1,
      executionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
      state: "pending",
      revision: 0,
      attempt: 1,
      withdrawalInferred: false,
    };
    expect(() => assertPersistedIngestionCheckpoint({ ...base, secret: "value" })).toThrow();
    expect(() => assertPersistedIngestionCheckpoint({ ...base, sourceId: "Greenhouse" })).toThrow();
    expect(() =>
      assertPersistedIngestionCheckpoint({
        ...base,
        state: "succeeded",
        revision: 2,
        settledAttempt: 1,
        settledLeaseId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d",
        settledAt: "2026-08-16T12:01:00.000Z",
        settlementKey: "b".repeat(64),
        progressKnown: true,
        observationCount: 2,
        createdCount: 1,
        updatedCount: 0,
      }),
    ).toThrow();
  });

  it("aligns source and adapter boundaries with the worker contract", () => {
    const base = {
      schemaVersion: 1,
      executionId,
      sourceId: `synthetic-${"a".repeat(54)}`,
      adapterVersion: `a${"_".repeat(99)}`,
      scheduledFor: "2026-08-16T12:00:00.000Z",
      state: "pending",
      revision: 0,
      attempt: 1,
      withdrawalInferred: false,
    } as const;
    expect(base.sourceId).toHaveLength(64);
    expect(base.adapterVersion).toHaveLength(100);
    expect(() => assertPersistedIngestionCheckpoint(base)).not.toThrow();
    for (const sourceId of [
      "greenhouse-reviewed-board",
      "lever-reviewed-site",
      "ashby-reviewed-board",
    ]) {
      expect(() => assertPersistedIngestionCheckpoint({ ...base, sourceId })).not.toThrow();
    }
    expect(() =>
      assertPersistedIngestionCheckpoint({ ...base, sourceId: `${base.sourceId}a` }),
    ).toThrow();
    expect(() =>
      assertPersistedIngestionCheckpoint({ ...base, adapterVersion: `${base.adapterVersion}_` }),
    ).toThrow();
  });

  it("accepts only the distinct durable recovery-exhaustion checkpoint shape", () => {
    const exhausted = {
      schemaVersion: 1,
      executionId,
      sourceId: "synthetic-foundation-v1",
      adapterVersion: "synthetic-ingestion-v1",
      scheduledFor: "2026-08-16T12:00:00.000Z",
      state: "dead_lettered",
      revision: 1,
      attempt: 1,
      withdrawalInferred: false,
      exhaustedDispatchId: "018f47a6-7b2c-7ee1-8c09-3ea174e80e2d",
      failureCode: "recovery_generation_exhausted",
    } as const;
    expect(() => assertPersistedIngestionCheckpoint(exhausted)).not.toThrow();
    expect(() =>
      assertPersistedIngestionCheckpoint({
        ...exhausted,
        settledLeaseId: exhausted.exhaustedDispatchId,
      }),
    ).toThrow();
  });
});
