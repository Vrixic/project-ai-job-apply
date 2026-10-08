import type postgres from "postgres";
import { expect, it, vi } from "vitest";
import {
  type NativeResumeReservation,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const input: NativeResumeReservation = {
  identity: {
    generationId: id(1),
    ownerUserId: id(2),
    applicationId: id(3),
    version: 1,
    baseDocumentId: id(4),
    baseVersion: 1,
    baseSha256: "a".repeat(64),
    jobContextSha256: "b".repeat(64),
  },
  application: {
    ownerUserId: id(2),
    applicationId: id(3),
    canonicalJobId: id(5),
    expectedRevision: 1,
    packetId: id(6),
    packetHash: "c".repeat(64),
    jobRevision: "d".repeat(64),
  },
  normalizedSha256: "e".repeat(64),
  previousEpochId: null,
  deployment: {
    clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic",
    taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic:1",
    containerName: "synthetic",
  },
};
it("defaults off before SQL or owner ports and denies unrecognized/accessor intent", async () => {
  const begin = vi.fn(),
    owner = vi.fn(),
    getter = vi.fn();
  const sql = { begin } as unknown as postgres.Sql,
    ports = { application: owner, job: owner };
  await expect(new PostgresNativeResumeGenerationStore(sql, ports).reserve(input)).rejects.toThrow(
    /^NativeResumeGenerationUnavailable$/,
  );
  const s = new PostgresNativeResumeGenerationStore(sql, ports, () => true);
  for (const value of [
    { ...input, body: "synthetic-private" },
    { ...input, identity: { ...input.identity, version: 0 } },
    { ...input, application: { ...input.application, ownerUserId: id(7) } },
    {
      ...input,
      identity: Object.defineProperty({ ...input.identity }, "baseSha256", {
        enumerable: true,
        get: getter,
      }),
    },
  ])
    await expect(s.reserve(value)).rejects.toThrow(/^NativeResumeGenerationUnavailable$/);
  expect(begin).not.toHaveBeenCalled();
  expect(owner).not.toHaveBeenCalled();
  expect(getter).not.toHaveBeenCalled();
});
it("returns a fixed refusal for unknown persistence outcomes without inventing completion", async () => {
  const begin = vi.fn().mockRejectedValue(Error("synthetic-private-db-error")),
    owner = vi.fn();
  const s = new PostgresNativeResumeGenerationStore(
    { begin } as unknown as postgres.Sql,
    { application: owner, job: owner },
    () => true,
  );
  await expect(s.reserve(input)).rejects.toThrow(/^NativeResumeGenerationUnavailable$/);
  expect(owner).not.toHaveBeenCalled();
});
