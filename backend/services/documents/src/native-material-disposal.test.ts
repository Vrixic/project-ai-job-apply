import { afterEach, expect, it, vi } from "vitest";
import { createNativeMaterialDisposal } from "./native-material-disposal.js";
import type { NativeMaterialIntent } from "./native-material-registry.js";
import type {
  NativeTaskAllocation,
  NativeTaskRetirementReceipt,
} from "./native-task-allocation.js";

const allocation: NativeTaskAllocation = {
  allocationId: "019d04cf-1f80-7000-8000-000000000101",
  ownerUserId: "019d04cf-1f80-7000-8000-000000000102",
  applicationId: "019d04cf-1f80-7000-8000-000000000103",
  generationId: "019d04cf-1f80-7000-8000-000000000104",
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
  taskArn:
    "arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/12345678901234567890123456789012",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
  containerName: "materials",
};
const epochId = "019d04cf-1f80-7000-8000-000000000105";
const receipt: NativeTaskRetirementReceipt = {
  schemaVersion: 1,
  kind: "native_task_stopped",
  allocationId: allocation.allocationId,
  ownerUserId: allocation.ownerUserId,
  applicationId: allocation.applicationId,
  generationId: allocation.generationId,
  clusterArn: allocation.clusterArn,
  taskArn: allocation.taskArn,
  taskDefinitionArn: allocation.taskDefinitionArn,
  stoppedAtEpochMs: 1000,
  observedAtEpochMs: 1001,
};
const intent = (): NativeMaterialIntent => ({
  allocationId: allocation.allocationId,
  ownerUserId: allocation.ownerUserId,
  applicationId: allocation.applicationId,
  generationId: allocation.generationId,
  epochId,
  state: "bound",
  allocation,
});
function setup(intents = [intent()]) {
  const registry = {
    sealApplication: vi.fn(async () => ({ epochId, intents })),
    recordRetirement: vi.fn(async (_receipt: NativeTaskRetirementReceipt) => undefined),
    confirmApplicationDisposed: vi.fn(async () => true),
  };
  const retire = vi.fn(async (_allocation: NativeTaskAllocation) => receipt);
  const create = (enabled = () => true) =>
    createNativeMaterialDisposal({ registry, enabled, testRetire: retire });
  return { registry, retire, create };
}
const discard = (client: ReturnType<typeof createNativeMaterialDisposal>) =>
  client.discardApplication(allocation.ownerUserId, allocation.applicationId);
afterEach(() => vi.unstubAllEnvs());

it("refuses default-off before sealing or remote effects", async () => {
  const { registry, retire } = setup();
  await expect(
    discard(createNativeMaterialDisposal({ registry, testRetire: retire })),
  ).rejects.toThrow("NativeMaterialDisposalUnavailable");
  expect(registry.sealApplication).not.toHaveBeenCalled();
  expect(retire).not.toHaveBeenCalled();
});

it.each(["pending", "foreign_owner", "foreign_generation", "foreign_epoch", "multiple"] as const)(
  "refuses %s intent before remote effects",
  async (fault) => {
    const original = intent();
    if (fault === "pending") {
      original.state = "pending";
      original.allocation = null;
    }
    if (fault === "foreign_owner") original.ownerUserId = epochId;
    if (fault === "foreign_generation") original.generationId = epochId;
    if (fault === "foreign_epoch") original.epochId = allocation.generationId;
    const { create, retire, registry } = setup(
      fault === "multiple" ? [original, intent()] : [original],
    );
    await expect(discard(create())).rejects.toThrow("NativeMaterialDisposalUnavailable");
    expect(retire).not.toHaveBeenCalled();
    expect(registry.recordRetirement).not.toHaveBeenCalled();
    expect(registry.confirmApplicationDisposed).not.toHaveBeenCalled();
  },
);

it("waits for actual seal commit before task observation and retains admission while observation is pending", async () => {
  const { registry, retire, create } = setup();
  let releaseSeal!: (plan: { epochId: string; intents: NativeMaterialIntent[] }) => void;
  registry.sealApplication.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseSeal = resolve;
      }),
  );
  let releaseRetirement!: (result: NativeTaskRetirementReceipt) => void;
  const observed = new Promise<void>((resolve) =>
    retire.mockImplementationOnce(() => {
      resolve();
      return new Promise((done) => {
        releaseRetirement = done;
      });
    }),
  );
  const client = create();
  const original = discard(client);
  expect(retire).not.toHaveBeenCalled();
  await expect(discard(client)).rejects.toThrow("NativeMaterialDisposalUnavailable");
  releaseSeal({ epochId, intents: [intent()] });
  await observed;
  expect(registry.recordRetirement).not.toHaveBeenCalled();
  await expect(discard(client)).rejects.toThrow("NativeMaterialDisposalUnavailable");
  releaseRetirement(receipt);
  expect(await original).toBe("discarded");
  expect(registry.recordRetirement).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(registry.confirmApplicationDisposed).toHaveBeenCalledWith(
    allocation.ownerUserId,
    allocation.applicationId,
    epochId,
  );
});

it.each(["record_failure", "changed_epoch", "disabled_after_observe"] as const)(
  "withholds acknowledgement after %s",
  async (fault) => {
    const { registry, retire, create } = setup();
    let enabled = true;
    if (fault === "record_failure")
      registry.recordRetirement.mockRejectedValueOnce(Error("synthetic"));
    if (fault === "changed_epoch") registry.confirmApplicationDisposed.mockResolvedValueOnce(false);
    if (fault === "disabled_after_observe")
      retire.mockImplementationOnce(async () => {
        enabled = false;
        return receipt;
      });
    await expect(discard(create(() => enabled))).rejects.toThrow(
      "NativeMaterialDisposalUnavailable",
    );
    if (fault !== "changed_epoch")
      expect(registry.confirmApplicationDisposed).not.toHaveBeenCalled();
  },
);

it("replays positive durable disposal without another task request", async () => {
  const { registry, retire, create } = setup([]);
  expect(await discard(create())).toBe("discarded");
  expect(retire).not.toHaveBeenCalled();
  expect(registry.recordRetirement).not.toHaveBeenCalled();
});

it("rejects test ports at construction and after environment changes", async () => {
  const { registry, retire, create } = setup();
  const client = create();
  vi.stubEnv("NODE_ENV", "production");
  expect(() =>
    createNativeMaterialDisposal({ registry, enabled: () => true, testRetire: retire }),
  ).toThrow("NativeMaterialDisposalUnavailable");
  await expect(discard(client)).rejects.toThrow("NativeMaterialDisposalUnavailable");
  expect(registry.sealApplication).not.toHaveBeenCalled();
});

it.each(["clusterArn", "taskDefinitionArn", "containerName"] as const)(
  "refuses an unretained %s before stopping any task",
  async (field) => {
    const { registry, retire } = setup();
    const deployment = {
      clusterArn: allocation.clusterArn,
      taskDefinitionArn: allocation.taskDefinitionArn,
      containerName: allocation.containerName,
    };
    deployment[field] += "different";
    const client = createNativeMaterialDisposal({
      registry,
      enabled: () => true,
      deployments: [deployment],
      testRetire: retire,
    });
    await expect(discard(client)).rejects.toThrow("NativeMaterialDisposalUnavailable");
    expect(retire).not.toHaveBeenCalled();
    expect(registry.recordRetirement).not.toHaveBeenCalled();
  },
);

it("snapshots the retained deployment before later caller mutation", async () => {
  const { registry, retire } = setup();
  const deployment = {
    clusterArn: allocation.clusterArn,
    taskDefinitionArn: allocation.taskDefinitionArn,
    containerName: allocation.containerName,
  };
  const client = createNativeMaterialDisposal({
    registry,
    enabled: () => true,
    deployments: [deployment],
    testRetire: retire,
  });
  deployment.taskDefinitionArn = "changed";
  expect(await discard(client)).toBe("discarded");
  expect(retire).toHaveBeenCalledExactlyOnceWith(allocation);
});
