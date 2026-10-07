import type { NativeEvidenceBinding } from "@ai-job-apply/documents-service/native-evidence-binding";
import type { NativeMaterialLaunchRecord } from "@ai-job-apply/documents-service/native-material-registry";
import { afterEach, expect, it, vi } from "vitest";
import { createNativeMaterialRouteOwner } from "./native-material-route-owner.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  allocationId: id(1),
  ownerUserId: id(2),
  applicationId: id(3),
  generationId: id(4),
  epochId: id(5),
};
const deployment = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/material",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/material:7",
  containerName: "native-material",
};
const allocation = {
  allocationId: scope.allocationId,
  ownerUserId: scope.ownerUserId,
  applicationId: scope.applicationId,
  generationId: scope.generationId,
  ...deployment,
  taskArn: "arn:aws:ecs:us-east-2:123456789012:task/material/12345678901234567890123456789012",
};
const binding: NativeEvidenceBinding = {
  scope,
  allocation,
  original: {
    id: id(6),
    documentId: scope.generationId,
    purpose: "provider_dispatch",
    requestSha256: "a".repeat(64),
  },
};
function setup() {
  const completedAtMs = Date.now() - 1000;
  const reference = {
    schemaVersion: 1 as const,
    kind: "cover_letter" as const,
    ownerUserId: scope.ownerUserId,
    applicationId: scope.applicationId,
    generationId: scope.generationId,
    version: 2,
    contentSha256: "b".repeat(64),
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
  };
  const row: NativeMaterialLaunchRecord = {
    intent: { ...scope, state: "bound", allocation: structuredClone(allocation) },
    deployment,
    original: structuredClone(binding.original),
    configurationSha256: "c".repeat(64),
    claimedAtEpochMs: completedAtMs - 1000,
  };
  const readLaunch = vi.fn(async () => structuredClone(row));
  const checkEvidenceAdmission = vi.fn(async () => undefined);
  const read = vi.fn<Parameters<typeof createNativeMaterialRouteOwner>[0]["address"]["read"]>(
    async () => ({
      allocationId: scope.allocationId,
      taskArn: allocation.taskArn,
      networkInterfaceId: "eni-0123456789abcdef0",
      publicIp: "54.0.0.1",
      expiresAtMs: reference.expiresAtMs,
    }),
  );
  const enabled = vi.fn(() => true);
  const options = {
    registry: { readLaunch, checkEvidenceAdmission },
    address: { read },
    binding: structuredClone(binding),
    reference,
    configurationSha256: "c".repeat(64),
    route: { hostedZoneId: "ZSYNTHETIC123", baseHost: "materials.example.com" },
    enabled,
  };
  return {
    row,
    reference,
    readLaunch,
    checkEvidenceAdmission,
    read,
    enabled,
    options,
    owner: createNativeMaterialRouteOwner(options),
  };
}
afterEach(() => vi.restoreAllMocks());
it("captures only the pinned original work and rechecks admission around address observation", async () => {
  const x = setup();
  const snapshot = await x.owner.capture(scope);
  expect(snapshot).toEqual({
    intent: { ...x.options.route, allocationId: scope.allocationId, publicIp: "54.0.0.1" },
    expiresAtMs: x.reference.expiresAtMs,
  });
  expect(x.read).toHaveBeenCalledWith({ scope, reference: x.reference });
  expect(x.readLaunch).toHaveBeenCalledTimes(2);
  expect(x.checkEvidenceAdmission).toHaveBeenCalledTimes(2);
  expect(x.checkEvidenceAdmission).toHaveBeenCalledWith(binding);
  await expect(x.owner.admit(scope, snapshot)).resolves.toBe(true);
  await expect(
    x.owner.admit(scope, { ...snapshot, intent: { ...snapshot.intent, publicIp: "54.0.0.2" } }),
  ).resolves.toBe(false);
});
it.each([
  "sealed",
  "wrong work",
  "wrong epoch",
  "wrong config",
  "wrong task",
  "wrong deployment",
  "retired",
  "expired",
  "disabled",
])("rejects %s before address observation", async (kind) => {
  const x = setup();
  if (kind === "sealed") x.checkEvidenceAdmission.mockRejectedValue(Error("private details"));
  if (kind === "wrong work") x.row.original.id = id(99);
  if (kind === "wrong epoch") x.row.intent.epochId = id(99);
  if (kind === "wrong config") x.row.configurationSha256 = "f".repeat(64);
  if (kind === "wrong task")
    x.row.intent.allocation = { ...allocation, taskArn: allocation.taskArn.replace(/12$/u, "99") };
  if (kind === "wrong deployment") x.row.deployment = { ...deployment, containerName: "foreign" };
  if (kind === "retired") x.row.intent.state = "retired";
  if (kind === "expired") vi.spyOn(Date, "now").mockReturnValue(x.reference.expiresAtMs);
  if (kind === "disabled") x.enabled.mockReturnValue(false);
  await expect(x.owner.capture(scope)).rejects.toThrow(/^NativeMaterialRouteOwnerUnavailable$/u);
  expect(x.read).not.toHaveBeenCalled();
});
it.each(["sealed", "retired", "expiry mismatch", "task mismatch", "expired"])(
  "withholds %s after observation",
  async (kind) => {
    const x = setup();
    x.read.mockImplementation(async () => {
      if (kind === "sealed") x.checkEvidenceAdmission.mockRejectedValue(Error("sealed"));
      if (kind === "retired") x.row.intent.state = "retired";
      if (kind === "expired") vi.spyOn(Date, "now").mockReturnValue(x.reference.expiresAtMs);
      return {
        allocationId: scope.allocationId,
        taskArn: kind === "task mismatch" ? "foreign" : allocation.taskArn,
        networkInterfaceId: "eni-0123456789abcdef0",
        publicIp: "54.0.0.1",
        expiresAtMs: x.reference.expiresAtMs + (kind === "expiry mismatch" ? 1 : 0),
      };
    });
    await expect(x.owner.capture(scope)).rejects.toThrow("NativeMaterialRouteOwnerUnavailable");
  },
);
it("observes positive original retirement after sealing without treating failure or absence as death", async () => {
  const x = setup();
  x.checkEvidenceAdmission.mockRejectedValue(Error("sealed"));
  await expect(x.owner.retired(scope)).resolves.toBe(false);
  x.row.intent.state = "retired";
  await expect(x.owner.retired(scope)).resolves.toBe(true);
  expect(x.checkEvidenceAdmission).not.toHaveBeenCalled();
  expect(x.read).not.toHaveBeenCalled();
  x.readLaunch.mockRejectedValue(Error("missing"));
  await expect(x.owner.retired(scope)).rejects.toThrow("NativeMaterialRouteOwnerUnavailable");
});
it("pins configuration and reference and refuses foreign scope or default-off use", async () => {
  const x = setup();
  x.options.reference.version = 9;
  x.options.binding.original.id = id(99);
  await x.owner.capture(scope);
  expect(x.read.mock.calls[0]?.[0].reference.version).toBe(2);
  expect(x.checkEvidenceAdmission).toHaveBeenCalledWith(binding);
  await expect(x.owner.capture({ ...scope, epochId: id(99) })).rejects.toThrow(
    "NativeMaterialRouteOwnerUnavailable",
  );
  const { enabled: _, ...disabled } = setup().options;
  await expect(createNativeMaterialRouteOwner(disabled).capture(scope)).rejects.toThrow(
    "NativeMaterialRouteOwnerUnavailable",
  );
});
