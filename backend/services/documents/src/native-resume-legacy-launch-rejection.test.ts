import type postgres from "postgres";
import { expect, it, vi } from "vitest";
import {
  type NativeResumeLegacyLaunchRejectionEvidence,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";

const id = (value: number) => `019d04cf-1f80-7000-8000-${String(value).padStart(12, "0")}`;
const scope = {
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(3),
  allocationId: id(4),
  epochId: id(5),
};
const evidence: NativeResumeLegacyLaunchRejectionEvidence = {
  configurationSha256: "a".repeat(64),
  claimedAtMicros: "1791720000000123",
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-resume",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-resume:1",
  containerName: "synthetic",
  requestId: "12345678-1234-4234-8234-123456789012",
  evidenceSha256: "b".repeat(64),
};
function setup(enabled = true) {
  const statements: string[] = [];
  const tx = vi.fn(async (parts: TemplateStringsArray) => {
    statements.push(parts.join("?"));
    return [];
  });
  const begin = vi.fn(async (work: (query: unknown) => Promise<unknown>) => work(tx));
  const admission = vi.fn(async () => {
    throw Error("UnexpectedPreparationAdmission");
  });
  const store = new PostgresNativeResumeGenerationStore(
    { begin } as unknown as postgres.Sql,
    { application: admission, job: admission },
    () => enabled,
  );
  return { store, begin, admission, statements };
}

it.each<[string, unknown]>([
  ["absent", null],
  ["unknown field", { ...evidence, taskArn: "forbidden" }],
  ["missing field", { ...evidence, requestId: undefined }],
  ["non-string configuration", { ...evidence, configurationSha256: 1 }],
  ["invalid configuration", { ...evidence, configurationSha256: "A".repeat(64) }],
  ["invalid evidence hash", { ...evidence, evidenceSha256: "not-a-proof" }],
  ["numeric claim", { ...evidence, claimedAtMicros: 1791720000000123 }],
  ["rounded claim", { ...evidence, claimedAtMicros: "1791720000000" }],
  ["noncanonical claim", { ...evidence, claimedAtMicros: "01791720000000123" }],
  ["invalid request ID", { ...evidence, requestId: "unknown" }],
  [
    "foreign task account",
    {
      ...evidence,
      taskDefinitionArn: evidence.taskDefinitionArn.replace("123456789012", "999900001111"),
    },
  ],
  [
    "task alias",
    { ...evidence, taskDefinitionArn: evidence.taskDefinitionArn.replace(/:1$/u, ":latest") },
  ],
  ["invalid container", { ...evidence, containerName: "synthetic/foreign" }],
  ["inherited shape", Object.assign(Object.create({ inherited: true }), evidence)],
])("refuses %s legacy evidence before SQL or preparation admission", async (_label, input) => {
  const x = setup();
  await expect(
    x.store.recordLegacyLaunchRejection(scope, input as NativeResumeLegacyLaunchRejectionEvidence),
  ).rejects.toThrow("NativeResumeGenerationUnavailable");
  expect(x.begin).not.toHaveBeenCalled();
  expect(x.admission).not.toHaveBeenCalled();
});

it("does not evaluate an evidence getter", async () => {
  const x = setup();
  const getter = vi.fn(() => evidence.evidenceSha256);
  const input = { ...evidence };
  Object.defineProperty(input, "evidenceSha256", { enumerable: true, get: getter });
  await expect(x.store.recordLegacyLaunchRejection(scope, input)).rejects.toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(x.begin).not.toHaveBeenCalled();
});

it("refuses an altered original scope or disabled owner before SQL", async () => {
  const x = setup();
  await expect(
    x.store.recordLegacyLaunchRejection({ ...scope, epochId: "unknown" }, evidence),
  ).rejects.toThrow();
  expect(x.begin).not.toHaveBeenCalled();
  const disabled = setup(false);
  await expect(disabled.store.recordLegacyLaunchRejection(scope, evidence)).rejects.toThrow();
  expect(disabled.begin).not.toHaveBeenCalled();
});

it("does not seal or settle when the original head is absent", async () => {
  const x = setup();
  await expect(x.store.recordLegacyLaunchRejection(scope, evidence)).rejects.toThrow();
  expect(x.begin).toHaveBeenCalledOnce();
  expect(x.statements).toHaveLength(3);
  expect(x.statements.every((statement) => /^\s*SELECT\b/u.test(statement))).toBe(true);
  expect(x.admission).not.toHaveBeenCalled();
});
