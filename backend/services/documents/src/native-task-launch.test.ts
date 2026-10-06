import {
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  RunTaskCommand,
} from "@aws-sdk/client-ecs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NativeMaterialLaunchRecord,
  NativeMaterialLaunchScope,
} from "./native-material-registry.js";
import type { NativeTaskAllocation } from "./native-task-allocation.js";
import {
  createNativeTaskLaunch,
  type NativeTaskLaunchConfiguration,
} from "./native-task-launch.js";

const configuration: NativeTaskLaunchConfiguration = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
  containerName: "materials",
  image: `123456789012.dkr.ecr.us-east-2.amazonaws.com/synthetic-materials@sha256:${"a".repeat(64)}`,
  executionRoleArn: "arn:aws:iam::123456789012:role/synthetic-execution",
  taskRoleArn: "arn:aws:iam::123456789012:role/synthetic-materials",
  cpu: "256",
  memory: "512",
  subnets: ["subnet-12345678901234567"],
  securityGroups: ["sg-12345678901234567"],
  assignPublicIp: "ENABLED",
};
function required<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw Error("MissingSyntheticFixture");
  return value;
}
const id = (suffix: string) => `019d04cf-1f80-7000-8000-${suffix.padStart(12, "0")}`;
const scope: NativeMaterialLaunchScope = {
  allocationId: id("1"),
  ownerUserId: id("2"),
  applicationId: id("3"),
  generationId: id("4"),
  epochId: id("5"),
};
const taskArn =
  "arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/12345678901234567890123456789012";
function definition() {
  return {
    taskDefinition: {
      taskDefinitionArn: configuration.taskDefinitionArn,
      status: "ACTIVE",
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "X86_64" },
      cpu: configuration.cpu,
      memory: configuration.memory,
      executionRoleArn: configuration.executionRoleArn,
      taskRoleArn: configuration.taskRoleArn,
      containerDefinitions: [
        {
          name: configuration.containerName,
          image: configuration.image,
          essential: true,
          readonlyRootFilesystem: true,
          user: "65532:65532",
          workingDirectory: "/materials",
          entryPoint: ["/usr/local/bin/node"],
          command: ["native-material/main.mjs"],
          linuxParameters: { capabilities: { drop: ["ALL"] } },
          ulimits: [{ name: "core", softLimit: 0, hardLimit: 0 }],
        },
      ],
    },
  };
}
function task() {
  return {
    tasks: [
      {
        taskArn,
        clusterArn: configuration.clusterArn,
        taskDefinitionArn: configuration.taskDefinitionArn,
        startedBy: scope.allocationId,
        launchType: "FARGATE",
        platformVersion: "1.4.0",
        enableExecuteCommand: false,
        lastStatus: "PENDING",
        containers: [{ name: configuration.containerName, taskArn }],
      },
    ],
    failures: [],
  };
}
function fixture() {
  let enabled = true;
  let record: NativeMaterialLaunchRecord = {
    intent: { ...scope, state: "pending", allocation: null },
    original: {
      id: id("6"),
      documentId: scope.generationId,
      purpose: "provider_dispatch",
      requestSha256: "b".repeat(64),
    },
    deployment: {
      clusterArn: configuration.clusterArn,
      taskDefinitionArn: configuration.taskDefinitionArn,
      containerName: configuration.containerName,
    },
    configurationSha256: null,
    claimedAtEpochMs: null,
  };
  const registry = {
    claimLaunch: vi.fn(async (_input: NativeMaterialLaunchScope, digest: string) => {
      const claimed = record.claimedAtEpochMs === null;
      if (!claimed && digest !== record.configurationSha256) throw Error("SyntheticConfigConflict");
      record = {
        ...record,
        configurationSha256: digest,
        claimedAtEpochMs: record.claimedAtEpochMs ?? Date.now(),
      };
      return { claimed, record: structuredClone(record) };
    }),
    readLaunch: vi.fn(async (_input: NativeMaterialLaunchScope, digest: string) => {
      if (digest !== record.configurationSha256) throw Error("SyntheticUnknownClaim");
      return structuredClone(record);
    }),
    bindTask: vi.fn(async (allocation: NativeTaskAllocation) => {
      record = { ...record, intent: { ...record.intent, state: "bound", allocation } };
      return structuredClone(record.intent);
    }),
  };
  const send = vi.fn(
    async (command: DescribeTaskDefinitionCommand | DescribeTasksCommand | RunTaskCommand) =>
      command instanceof DescribeTaskDefinitionCommand ? definition() : task(),
  );
  const options = {
    configuration: structuredClone(configuration),
    registry,
    enabled: () => enabled,
    launchEnabled: () => enabled,
    testClient: { send },
  };
  return {
    options,
    registry,
    send,
    enable: (value: boolean) => {
      enabled = value;
    },
    get record() {
      return record;
    },
    set record(value: NativeMaterialLaunchRecord) {
      record = value;
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("private one-attempt native ECS launch", () => {
  it("defaults off before any registry/AWS effect", async () => {
    const f = fixture();
    const launch = createNativeTaskLaunch({
      registry: f.registry,
      configuration,
      testClient: { send: f.send },
      launchEnabled: () => true,
    });
    await expect(launch.launch(scope)).rejects.toThrow("NativeTaskLaunchUnavailable");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.registry.claimLaunch).not.toHaveBeenCalled();
  });
  it("checks the exact immutable task envelope before committing one claim and launching one task", async () => {
    const f = fixture();
    const launcher = createNativeTaskLaunch(f.options);
    const allocation = await launcher.launch(scope);
    expect(allocation.taskArn).toBe(taskArn);
    expect(f.send.mock.calls.map(([c]) => c.constructor.name)).toEqual([
      "DescribeTaskDefinitionCommand",
      "RunTaskCommand",
    ]);
    expect(f.registry.claimLaunch.mock.invocationCallOrder[0]).toBeLessThan(
      f.send.mock.invocationCallOrder[1] as number,
    );
    expect(f.registry.bindTask).toHaveBeenCalledWith(allocation);
    const request = (required(f.send.mock.calls[1]?.[0]) as RunTaskCommand).input;
    expect(request).toMatchObject({
      count: 1,
      startedBy: scope.allocationId,
      clientToken: scope.allocationId,
      launchType: "FARGATE",
      platformVersion: "1.4.0",
      enableExecuteCommand: false,
      enableECSManagedTags: false,
      propagateTags: "NONE",
    });
    expect(Object.keys(request.overrides ?? {})).toEqual(["containerOverrides"]);
    expect(request.overrides?.containerOverrides?.[0]?.environment).toHaveLength(7);
    expect(request.overrides?.containerOverrides?.[0]?.command).toBeUndefined();
    expect(JSON.stringify(request)).not.toMatch(/Bearer|provider_secret|candidate text/iu);
  });
  it("replays the bound exact task without another RunTask", async () => {
    const f = fixture();
    const launch = createNativeTaskLaunch(f.options);
    const first = await launch.launch(scope);
    await expect(launch.launch(scope)).resolves.toEqual(first);
    expect(f.send.mock.calls.filter(([c]) => c instanceof RunTaskCommand)).toHaveLength(1);
  });
  it.each(["lostRunAck", "failedCapture", "lostClaimAck"])(
    "%s remains pending and never reissues RunTask",
    async (failure) => {
      const f = fixture();
      if (failure === "lostRunAck")
        f.send.mockImplementation(async (c) => {
          if (c instanceof RunTaskCommand) throw Error("SyntheticLostAck");
          return definition();
        });
      if (failure === "failedCapture")
        f.registry.bindTask.mockRejectedValue(Error("SyntheticFailedCapture"));
      if (failure === "lostClaimAck") {
        const original = required(f.registry.claimLaunch.getMockImplementation());
        f.registry.claimLaunch.mockImplementation(async (...args) => {
          await original(...args);
          throw Error("SyntheticLostClaimAck");
        });
      }
      const launch = createNativeTaskLaunch(f.options);
      await expect(launch.launch(scope)).rejects.toThrow("NativeTaskLaunchUnavailable");
      expect(f.record.intent.state).toBe("pending");
      expect(f.record.claimedAtEpochMs).not.toBeNull();
      const before = f.send.mock.calls.filter(([c]) => c instanceof RunTaskCommand).length;
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 48 * 60 * 60 * 1000);
      await expect(createNativeTaskLaunch(f.options).launch(scope)).rejects.toThrow(
        "NativeTaskLaunchUnavailable",
      );
      expect(f.send.mock.calls.filter(([c]) => c instanceof RunTaskCommand)).toHaveLength(before);
    },
  );
  it("positively recovers the exact original stopped task with no new launch or retirement receipt", async () => {
    const f = fixture();
    const launch = createNativeTaskLaunch(f.options);
    f.send
      .mockImplementationOnce(async () => definition())
      .mockRejectedValueOnce(Error("SyntheticLostAck"));
    await expect(launch.launch(scope)).rejects.toThrow("NativeTaskLaunchUnavailable");
    f.send.mockImplementation(async () => {
      const response = task();
      required(response.tasks[0]).lastStatus = "STOPPED";
      return response;
    });
    const result = await launch.recover(scope, taskArn);
    expect(result.taskArn).toBe(taskArn);
    expect(f.record.intent.state).toBe("bound");
    expect(f.send.mock.lastCall?.[0]).toBeInstanceOf(DescribeTasksCommand);
    expect(f.send.mock.calls.filter(([c]) => c instanceof RunTaskCommand)).toHaveLength(1);
  });
  it("captures a fulfilled late RunTask before returning timeout refusal and retains call admission", async () => {
    const f = fixture();
    let resolve!: (value: ReturnType<typeof task>) => void;
    f.send.mockImplementation(async (c) =>
      c instanceof RunTaskCommand
        ? new Promise<ReturnType<typeof task>>((r) => {
            resolve = r;
          })
        : definition(),
    );
    const launch = createNativeTaskLaunch({ ...f.options, timeoutMs: 10 });
    const pending = launch.launch(scope);
    const assertion = expect(pending).rejects.toThrow("NativeTaskLaunchUnavailable");
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await new Promise((r) => setTimeout(r, 20));
    await expect(launch.launch(scope)).rejects.toThrow("NativeTaskLaunchUnavailable");
    expect(f.registry.claimLaunch).toHaveBeenCalledTimes(1);
    resolve(task());
    await assertion;
    expect(f.record.intent.state).toBe("bound");
  });
  it("captures an actually fulfilled task after withdrawal without granting new work", async () => {
    const f = fixture();
    f.send.mockImplementation(async (c) => {
      if (c instanceof RunTaskCommand) {
        f.enable(false);
        return task();
      }
      return definition();
    });
    await expect(createNativeTaskLaunch(f.options).launch(scope)).rejects.toThrow(
      "NativeTaskLaunchUnavailable",
    );
    expect(f.record.intent.state).toBe("bound");
  });
  it("refuses RunTask if authority is withdrawn after the SQL claim", async () => {
    const f = fixture();
    const original = required(f.registry.claimLaunch.getMockImplementation());
    f.registry.claimLaunch.mockImplementation(async (...args) => {
      const result = await original(...args);
      f.enable(false);
      return result;
    });
    await expect(createNativeTaskLaunch(f.options).launch(scope)).rejects.toThrow(
      "NativeTaskLaunchUnavailable",
    );
    expect(f.send.mock.calls.filter(([c]) => c instanceof RunTaskCommand)).toHaveLength(0);
    expect(f.record.intent.state).toBe("pending");
  });
  it.each([
    "mutable image",
    "exec",
    "wrong task",
    "wrong allocation",
    "extra task",
    "missing task",
    "foreign cluster",
  ])("refuses %s capture", async (kind) => {
    const f = fixture();
    f.send.mockImplementation(async (c) => {
      if (c instanceof DescribeTaskDefinitionCommand) return definition();
      const r = task();
      if (kind === "mutable image")
        required(r.tasks[0]).taskDefinitionArn = configuration.taskDefinitionArn.replace(
          ":7",
          ":8",
        );
      if (kind === "exec") required(r.tasks[0]).enableExecuteCommand = true;
      if (kind === "wrong task")
        required(r.tasks[0]).taskArn =
          "arn:aws:ecs:us-east-2:123456789012:task/foreign/12345678901234567890123456789012";
      if (kind === "wrong allocation") required(r.tasks[0]).startedBy = id("9");
      if (kind === "extra task") r.tasks.push({ ...required(r.tasks[0]) });
      if (kind === "missing task") r.tasks = [];
      if (kind === "foreign cluster")
        required(r.tasks[0]).clusterArn = configuration.clusterArn.replace("materials", "foreign");
      return r;
    });
    await expect(createNativeTaskLaunch(f.options).launch(scope)).rejects.toThrow(
      "NativeTaskLaunchUnavailable",
    );
    expect(f.registry.bindTask).not.toHaveBeenCalled();
  });
  it.each([
    "image",
    "logs",
    "secret",
    "environment",
    "volume",
    "sidecar",
    "core",
    "root",
    "architecture",
    "command",
  ])("refuses unsafe %s envelope before claiming", async (kind) => {
    const f = fixture();
    f.send.mockImplementation(async () => {
      const r = definition();
      const c = required(r.taskDefinition.containerDefinitions[0]);
      if (kind === "image") c.image = "synthetic:latest";
      if (kind === "logs") Object.assign(c, { logConfiguration: { logDriver: "awslogs" } });
      if (kind === "secret")
        Object.assign(c, { secrets: [{ name: "UNSAFE", valueFrom: "synthetic" }] });
      if (kind === "environment")
        Object.assign(c, { environment: [{ name: "UNSAFE", value: "synthetic" }] });
      if (kind === "volume")
        Object.assign(c, { mountPoints: [{ sourceVolume: "scratch", containerPath: "/tmp" }] });
      if (kind === "sidecar") r.taskDefinition.containerDefinitions.push({ ...c });
      if (kind === "core") required(c.ulimits[0]).softLimit = 1;
      if (kind === "root") c.readonlyRootFilesystem = false;
      if (kind === "architecture") r.taskDefinition.runtimePlatform.cpuArchitecture = "ARM64";
      if (kind === "command") c.command = ["shell"];
      return r;
    });
    await expect(createNativeTaskLaunch(f.options).launch(scope)).rejects.toThrow(
      "NativeTaskLaunchUnavailable",
    );
    expect(f.registry.claimLaunch).not.toHaveBeenCalled();
  });
  it("detaches configuration and treats reordered keys/subnets identically", async () => {
    const f = fixture();
    const launch = createNativeTaskLaunch(f.options);
    f.options.configuration.image = "synthetic:latest";
    await launch.launch(scope);
    const reordered = Object.fromEntries(
      Object.entries(configuration).reverse(),
    ) as unknown as NativeTaskLaunchConfiguration;
    await expect(
      createNativeTaskLaunch({ ...f.options, configuration: reordered }).launch(scope),
    ).resolves.toMatchObject({ taskArn });
  });
  it("rejects a caller-supplied command or body before any effect", async () => {
    const f = fixture();
    const launch = createNativeTaskLaunch(f.options);
    await expect(
      launch.launch({ ...scope, body: "synthetic" } as NativeMaterialLaunchScope),
    ).rejects.toThrow("NativeTaskLaunchUnavailable");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.registry.claimLaunch).not.toHaveBeenCalled();
  });
  it.each([
    "duplicate subnet",
    "sparse subnet",
    "array extra",
    "array getter",
    "foreign role",
    "mutable image",
    "invalid cpu",
    "extra option",
    "hidden option",
    "option getter",
    "latest revision",
  ])("rejects %s configuration without evaluating accessors", (kind) => {
    const f = fixture();
    const config = structuredClone(configuration);
    let reads = 0;
    if (kind === "duplicate subnet")
      config.subnets = [config.subnets[0] as string, config.subnets[0] as string];
    if (kind === "sparse subnet") config.subnets = new Array(1) as string[];
    if (kind === "array extra") Object.assign(config.subnets, { extra: "synthetic" });
    if (kind === "array getter")
      Object.defineProperty(config.subnets, "0", {
        enumerable: true,
        get() {
          reads++;
          return "subnet-12345678901234567";
        },
      });
    if (kind === "foreign role") config.taskRoleArn = "arn:aws:iam::987654321012:role/foreign";
    if (kind === "mutable image") config.image = "synthetic:latest";
    if (kind === "invalid cpu") config.cpu = "4096" as "256";
    if (kind === "extra option") Object.assign(config, { command: "shell" });
    if (kind === "hidden option") Object.defineProperty(config, "hidden", { value: "synthetic" });
    if (kind === "option getter")
      Object.defineProperty(config, "image", {
        enumerable: true,
        get() {
          reads++;
          return configuration.image;
        },
      });
    if (kind === "latest revision")
      config.taskDefinitionArn = configuration.taskDefinitionArn.replace(":7", ":latest");
    expect(() => createNativeTaskLaunch({ ...f.options, configuration: config })).toThrow(
      "NativeTaskLaunchUnavailable",
    );
    expect(reads).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.registry.claimLaunch).not.toHaveBeenCalled();
  });
  it("keeps positive recovery available with new launches off", async () => {
    const f = fixture();
    const launch = createNativeTaskLaunch(f.options);
    await launch.launch(scope);
    const recovery = createNativeTaskLaunch({ ...f.options, launchEnabled: () => false });
    const before = f.send.mock.calls.length;
    await expect(recovery.launch(scope)).rejects.toThrow("NativeTaskLaunchUnavailable");
    expect(f.send.mock.calls).toHaveLength(before);
    await expect(recovery.recover(scope, taskArn)).resolves.toMatchObject({ taskArn });
    expect(f.send.mock.lastCall?.[0]).toBeInstanceOf(DescribeTasksCommand);
  });
  it("refuses injected transport outside test mode", () => {
    const f = fixture();
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => createNativeTaskLaunch(f.options)).toThrow("NativeTaskLaunchUnavailable");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
