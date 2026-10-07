import { createHash } from "node:crypto";
import { DescribeNetworkInterfacesCommand, type NetworkInterface } from "@aws-sdk/client-ec2";
import type { DescribeTasksCommand, Task } from "@aws-sdk/client-ecs";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeMaterialLaunchRecord } from "./native-material-registry.js";
import { createNativeMaterialTaskAddressReader } from "./native-material-task-address.js";
import {
  nativeMaterialLaunchEnvironment,
  nativeTaskLaunchConfiguration,
} from "./native-task-launch-policy.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  ownerUserId: id(1),
  applicationId: id(2),
  generationId: id(3),
  allocationId: id(4),
  epochId: id(5),
};
const configuration = nativeTaskLaunchConfiguration({
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/resume",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/resume:7",
  containerName: "native-material",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/resume@sha256:${"a".repeat(64)}`,
  executionRoleArn: "arn:aws:iam::123456789012:role/execution",
  taskRoleArn: "arn:aws:iam::123456789012:role/task",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-0123456789abcdef0"],
  securityGroups: ["sg-0123456789abcdef0"],
  assignPublicIp: "ENABLED",
});
const sha = createHash("sha256")
  .update(JSON.stringify({ protocol: "native-material-launch.v1", ...configuration }))
  .digest("hex");
const taskArn = "arn:aws:ecs:us-east-2:123456789012:task/resume/12345678901234567890123456789012";
const eniId = "eni-0123456789abcdef0";
const original = {
  id: id(6),
  documentId: scope.generationId,
  purpose: "provider_dispatch" as const,
  requestSha256: "c".repeat(64),
};
function setup() {
  const completedAtMs = Date.now() - 1000;
  const allocation = {
    allocationId: scope.allocationId,
    ownerUserId: scope.ownerUserId,
    applicationId: scope.applicationId,
    generationId: scope.generationId,
    taskArn,
    clusterArn: configuration.clusterArn,
    taskDefinitionArn: configuration.taskDefinitionArn,
    containerName: configuration.containerName,
  };
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
    intent: { ...scope, state: "bound", allocation },
    original,
    configurationSha256: sha,
    claimedAtEpochMs: completedAtMs - 1000,
    deployment: {
      clusterArn: configuration.clusterArn,
      taskDefinitionArn: configuration.taskDefinitionArn,
      containerName: configuration.containerName,
    },
  };
  const task: Task = {
    taskArn,
    clusterArn: configuration.clusterArn,
    taskDefinitionArn: configuration.taskDefinitionArn,
    startedBy: scope.allocationId,
    launchType: "FARGATE",
    platformVersion: "1.4.0",
    enableExecuteCommand: false,
    lastStatus: "RUNNING",
    desiredStatus: "RUNNING",
    overrides: {
      containerOverrides: [
        {
          name: configuration.containerName,
          environment: nativeMaterialLaunchEnvironment(scope, original),
        },
      ],
    },
    containers: [
      {
        name: configuration.containerName,
        taskArn,
        lastStatus: "RUNNING",
        image: configuration.image,
        imageDigest: `sha256:${"a".repeat(64)}`,
        networkInterfaces: [
          { attachmentId: "synthetic-attachment", privateIpv4Address: "10.0.1.5" },
        ],
      },
    ],
    attachments: [
      {
        id: "synthetic-attachment",
        type: "ElasticNetworkInterface",
        status: "ATTACHED",
        details: [
          { name: "networkInterfaceId", value: eniId },
          { name: "subnetId", value: configuration.subnets[0] },
          { name: "privateIPv4Address", value: "10.0.1.5" },
        ],
      },
    ],
  };
  const eni: NetworkInterface = {
    NetworkInterfaceId: eniId,
    OwnerId: "123456789012",
    Status: "in-use",
    SubnetId: configuration.subnets[0],
    PrivateIpAddress: "10.0.1.5",
    Groups: [{ GroupId: configuration.securityGroups[0] }],
    Association: { PublicIp: "54.0.0.1" },
  };
  const order: string[] = [];
  const readLaunch = vi.fn(async () => {
    order.push("registry");
    return structuredClone(row);
  });
  const ecs = vi.fn(
    async (
      _command: DescribeTasksCommand,
      _options: { abortSignal: AbortSignal },
    ): Promise<unknown> => {
      order.push("ecs");
      return { tasks: [structuredClone(task)] };
    },
  );
  const ec2 = vi.fn(
    async (
      _command: DescribeNetworkInterfacesCommand,
      _options: { abortSignal: AbortSignal },
    ): Promise<unknown> => {
      order.push("ec2");
      return { NetworkInterfaces: [structuredClone(eni)] };
    },
  );
  const readAllocation = vi.fn(async () => {
    order.push("ready");
    return scope.allocationId as string | null;
  });
  const enabled = vi.fn(() => true);
  const options = {
    configuration,
    registry: { readLaunch },
    ready: { readAllocation },
    testClients: { ecs: { send: ecs }, ec2: { send: ec2 } },
    enabled,
  };
  return {
    row,
    reference,
    input: { scope, reference },
    task,
    eni,
    order,
    readLaunch,
    readAllocation,
    ecs,
    ec2,
    enabled,
    options,
  };
}
afterEach(() => {
  vi.unstubAllEnvs();
});
it("observes only the original ready cover-letter task and rechecks ownership after AWS", async () => {
  const x = setup();
  await expect(createNativeMaterialTaskAddressReader(x.options).read(x.input)).resolves.toEqual({
    allocationId: scope.allocationId,
    taskArn,
    networkInterfaceId: eniId,
    publicIp: "54.0.0.1",
    expiresAtMs: x.reference.expiresAtMs,
  });
  expect(x.order).toEqual(["registry", "ready", "ecs", "ec2", "ecs", "registry", "ready"]);
  expect(x.readLaunch).toHaveBeenCalledWith(scope, sha);
  expect(x.readAllocation).toHaveBeenCalledWith(x.reference);
  expect(x.ec2.mock.calls[0]?.[0]).toBeInstanceOf(DescribeNetworkInterfacesCommand);
});
it.each([
  "not ready",
  "wrong epoch",
  "wrong owner",
  "wrong kind",
  "unclaimed",
  "wrong config",
  "retired",
  "expired",
])("refuses %s before AWS", async (kind) => {
  const x = setup();
  if (kind === "not ready") x.readAllocation.mockResolvedValue(null);
  if (kind === "wrong epoch") x.row.intent.epochId = id(99);
  if (kind === "wrong owner") x.row.intent.ownerUserId = id(99);
  if (kind === "wrong kind") Object.assign(x.reference, { kind: "tailored_resume" });
  if (kind === "unclaimed") x.row.claimedAtEpochMs = null;
  if (kind === "wrong config") x.row.configurationSha256 = "f".repeat(64);
  if (kind === "retired") x.row.intent.state = "retired";
  if (kind === "expired") {
    x.reference.expiresAtMs = Date.now() - 1;
    x.reference.completedAtMs = x.reference.expiresAtMs - 1_800_000;
  }
  await expect(createNativeMaterialTaskAddressReader(x.options).read(x.input)).rejects.toThrow(
    "NativeMaterialTaskAddressUnavailable",
  );
  expect(x.ecs).not.toHaveBeenCalled();
});
it.each([
  "withdrawn receipt",
  "retired task",
  "work changed",
  "wrong address",
  "stopped",
  "disabled",
])("withholds %s during network observation", async (kind) => {
  const x = setup();
  x.ec2.mockImplementation(async () => {
    if (kind === "withdrawn receipt") x.readAllocation.mockResolvedValue(null);
    if (kind === "retired task") x.row.intent.state = "retired";
    if (kind === "work changed") x.row.original = { ...original, id: id(99) };
    if (kind === "wrong address") x.eni.Association = { PublicIp: "10.0.0.1" };
    if (kind === "stopped") x.task.lastStatus = "STOPPED";
    if (kind === "disabled") x.enabled.mockReturnValue(false);
    return { NetworkInterfaces: [x.eni] };
  });
  await expect(createNativeMaterialTaskAddressReader(x.options).read(x.input)).rejects.toThrow(
    "NativeMaterialTaskAddressUnavailable",
  );
});
it("defaults off and disallows production injected clients", async () => {
  const x = setup();
  const { enabled: _, ...disabled } = x.options;
  await expect(createNativeMaterialTaskAddressReader(disabled).read(x.input)).rejects.toThrow(
    "NativeMaterialTaskAddressUnavailable",
  );
  expect(x.order).toEqual([]);
  vi.stubEnv("NODE_ENV", "production");
  expect(() => createNativeMaterialTaskAddressReader(x.options)).toThrow(
    "NativeMaterialTaskAddressUnavailable",
  );
});
