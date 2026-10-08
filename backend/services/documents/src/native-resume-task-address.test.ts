import { createHash } from "node:crypto";
import { DescribeNetworkInterfacesCommand, type NetworkInterface } from "@aws-sdk/client-ec2";
import { DescribeTasksCommand, type Task } from "@aws-sdk/client-ecs";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeResumeGenerationRecord } from "./native-resume-generation-store.js";
import { createNativeResumeTaskAddressReader } from "./native-resume-task-address.js";
import {
  nativeResumeLaunchEnvironment,
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
  containerName: "native-resume",
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
  .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...configuration }))
  .digest("hex");
const taskArn = "arn:aws:ecs:us-east-2:123456789012:task/resume/12345678901234567890123456789012";
const eniId = "eni-0123456789abcdef0";
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
  const row = {
    state: "bound",
    ready: true,
    allocation,
    allocationId: scope.allocationId,
    epochId: scope.epochId,
    configurationSha256: sha,
    reservation: { identity: scope, deployment: configuration },
    reference: {
      schemaVersion: 1,
      kind: "tailored_resume",
      ownerUserId: scope.ownerUserId,
      applicationId: scope.applicationId,
      generationId: scope.generationId,
      version: 1,
      contentSha256: "b".repeat(64),
      completedAtMs,
      expiresAtMs: completedAtMs + 1_800_000,
    },
  } as unknown as NativeResumeGenerationRecord;
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
          environment: nativeResumeLaunchEnvironment(scope, sha),
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
  const enabled = vi.fn(() => true);
  const options = {
    configuration,
    registry: { readLaunch },
    testClients: { ecs: { send: ecs }, ec2: { send: ec2 } },
    enabled,
  };
  return { row, task, eni, order, readLaunch, ecs, ec2, enabled, options };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("binds the original ready ledger task through exact ECS/ENI reads and rechecks before returning", async () => {
  const x = setup();
  await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).resolves.toEqual({
    allocationId: scope.allocationId,
    taskArn,
    networkInterfaceId: eniId,
    publicIp: "54.0.0.1",
    expiresAtMs: x.row.reference?.expiresAtMs,
  });
  expect(x.order).toEqual(["registry", "ecs", "ec2", "ecs", "registry"]);
  expect(x.readLaunch).toHaveBeenCalledWith(scope, sha);
  for (const [command, options] of x.ecs.mock.calls) {
    expect(command).toBeInstanceOf(DescribeTasksCommand);
    expect(command.input).toEqual({ cluster: configuration.clusterArn, tasks: [taskArn] });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  }
  expect(x.ec2.mock.calls[0]?.[0]).toBeInstanceOf(DescribeNetworkInterfacesCommand);
  expect(x.ec2.mock.calls[0]?.[0].input).toEqual({ NetworkInterfaceIds: [eniId] });
});
it("defaults off before owner or network access", async () => {
  const x = setup();
  const { enabled: _, ...options } = x.options;
  await expect(createNativeResumeTaskAddressReader(options).read(scope)).rejects.toThrow(
    "NativeResumeTaskAddressUnavailable",
  );
  expect(x.order).toEqual([]);
});
it.each([
  "pending",
  "retired",
  "wrong owner",
  "wrong epoch",
  "wrong config",
  "not ready",
  "expired",
])("refuses %s original ledger before AWS", async (kind) => {
  const x = setup();
  if (kind === "pending" || kind === "retired") x.row.state = kind;
  if (kind === "wrong owner")
    x.row.reservation = {
      ...x.row.reservation,
      identity: { ...x.row.reservation.identity, ownerUserId: id(99) },
    };
  if (kind === "wrong epoch") x.row.epochId = id(99);
  if (kind === "wrong config") x.row.configurationSha256 = "c".repeat(64);
  if (kind === "not ready") x.row.ready = false;
  if (kind === "expired" && x.row.reference) {
    const expiresAtMs = Date.now() - 1;
    x.row.reference = { ...x.row.reference, completedAtMs: expiresAtMs - 1_800_000, expiresAtMs };
  }
  await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).rejects.toThrow(
    "NativeResumeTaskAddressUnavailable",
  );
  expect(x.ecs).not.toHaveBeenCalled();
  expect(x.ec2).not.toHaveBeenCalled();
});
it.each([
  "stopping",
  "foreign task",
  "wrong image",
  "changed overrides",
  "duplicate detail",
  "foreign subnet",
  "detached",
  "missing attachment",
  "extra task",
])("refuses %s task before resolving an interface", async (kind) => {
  const x = setup();
  if (kind === "stopping") x.task.desiredStatus = "STOPPED";
  if (kind === "foreign task") x.task.taskArn = taskArn.replace(/12$/u, "99");
  if (kind === "wrong image" && x.task.containers?.[0])
    x.task.containers[0].imageDigest = `sha256:${"f".repeat(64)}`;
  if (kind === "changed overrides") x.task.overrides = { containerOverrides: [] };
  if (kind === "duplicate detail")
    x.task.attachments?.[0]?.details?.push({ name: "networkInterfaceId", value: eniId });
  if (kind === "foreign subnet" && x.task.attachments?.[0]?.details?.[1])
    x.task.attachments[0].details[1].value = "subnet-99999999999999999";
  if (kind === "detached" && x.task.attachments?.[0]) x.task.attachments[0].status = "DETACHED";
  if (kind === "missing attachment") x.task.attachments = [];
  if (kind === "extra task") x.ecs.mockResolvedValue({ tasks: [x.task, x.task] });
  await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).rejects.toThrow(
    "NativeResumeTaskAddressUnavailable",
  );
  expect(x.ec2).not.toHaveBeenCalled();
});
it.each([
  "foreign owner",
  "foreign eni",
  "wrong subnet",
  "wrong private ip",
  "extra group",
  "available",
  "missing public ip",
  "extra eni",
  "pagination",
])("refuses %s network result", async (kind) => {
  const x = setup();
  if (kind === "foreign owner") x.eni.OwnerId = "999999999999";
  if (kind === "foreign eni") x.eni.NetworkInterfaceId = "eni-99999999999999999";
  if (kind === "wrong subnet") x.eni.SubnetId = "subnet-99999999999999999";
  if (kind === "wrong private ip") x.eni.PrivateIpAddress = "10.0.1.6";
  if (kind === "extra group") x.eni.Groups?.push({ GroupId: "sg-99999999999999999" });
  if (kind === "available") x.eni.Status = "available";
  if (kind === "missing public ip") x.eni.Association = {};
  if (kind === "extra eni") x.ec2.mockResolvedValue({ NetworkInterfaces: [x.eni, x.eni] });
  if (kind === "pagination")
    x.ec2.mockResolvedValue({ NetworkInterfaces: [x.eni], NextToken: "synthetic" });
  await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).rejects.toThrow(
    "NativeResumeTaskAddressUnavailable",
  );
  expect(x.ecs).toHaveBeenCalledTimes(1);
});
it.each([
  "0.0.0.0",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.0.1",
  "198.18.0.1",
  "192.0.2.1",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "54.0.0.1:8443",
])("refuses unsuitable public address %s", async (ip) => {
  const x = setup();
  x.eni.Association = { PublicIp: ip };
  await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).rejects.toThrow(
    "NativeResumeTaskAddressUnavailable",
  );
});
it.each(["task stopped", "interface changed", "ledger retired", "reference changed", "withdrawn"])(
  "withholds the result when %s during observation",
  async (kind) => {
    const x = setup();
    x.ec2.mockImplementation(async () => {
      if (kind === "task stopped") x.task.lastStatus = "STOPPED";
      if (kind === "interface changed" && x.task.attachments?.[0]?.details?.[0])
        x.task.attachments[0].details[0].value = "eni-99999999999999999";
      if (kind === "ledger retired") x.row.state = "retired";
      if (kind === "reference changed" && x.row.reference)
        x.row.reference = { ...x.row.reference, contentSha256: "c".repeat(64) };
      if (kind === "withdrawn") x.enabled.mockReturnValue(false);
      return { NetworkInterfaces: [x.eni] };
    });
    await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).rejects.toThrow(
      "NativeResumeTaskAddressUnavailable",
    );
  },
);
it("refuses caller address/task overrides before effects", async () => {
  const x = setup();
  await expect(
    createNativeResumeTaskAddressReader(x.options).read({ ...scope, taskArn } as typeof scope),
  ).rejects.toThrow();
  expect(x.order).toEqual([]);
});
it("keeps admission until a late SDK response settles and refuses it after timeout", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const x = setup();
  let fulfill!: (value: unknown) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  x.ecs.mockImplementation(
    async () =>
      new Promise((resolve) => {
        fulfill = resolve;
        started();
      }),
  );
  const reader = createNativeResumeTaskAddressReader({ ...x.options, timeoutMs: 10 });
  const read = reader.read(scope);
  const assertion = expect(read).rejects.toThrow("NativeResumeTaskAddressUnavailable");
  await began;
  await vi.advanceTimersByTimeAsync(20);
  await expect(reader.read(scope)).rejects.toThrow("NativeResumeTaskAddressUnavailable");
  expect(x.readLaunch).toHaveBeenCalledTimes(1);
  fulfill({ tasks: [x.task] });
  await assertion;
  expect(x.ec2).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("hides upstream diagnostics and refuses injected transports in production", async () => {
  const x = setup();
  x.ecs.mockRejectedValue(Error("synthetic private upstream details"));
  await expect(createNativeResumeTaskAddressReader(x.options).read(scope)).rejects.toThrow(
    /^NativeResumeTaskAddressUnavailable$/u,
  );
  vi.stubEnv("NODE_ENV", "production");
  expect(() => createNativeResumeTaskAddressReader(x.options)).toThrow(
    "NativeResumeTaskAddressUnavailable",
  );
});
it("refuses private-only launch configuration before effects", () => {
  const x = setup();
  expect(() =>
    createNativeResumeTaskAddressReader({
      ...x.options,
      configuration: { ...configuration, assignPublicIp: "DISABLED" },
    }),
  ).toThrow("NativeResumeTaskAddressUnavailable");
  expect(x.order).toEqual([]);
});
