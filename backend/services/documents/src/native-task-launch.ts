import { createHash } from "node:crypto";
import {
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
  type Task,
  type TaskDefinition,
} from "@aws-sdk/client-ecs";
import type {
  NativeMaterialLaunchRecord,
  NativeMaterialLaunchScope,
  PostgresNativeMaterialRegistry,
} from "./native-material-registry.js";
import {
  type NativeTaskAllocation,
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";

type Registry = Pick<PostgresNativeMaterialRegistry, "claimLaunch" | "readLaunch" | "bindTask">;
interface TaskClient {
  send(
    command: DescribeTaskDefinitionCommand | DescribeTasksCommand | RunTaskCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}
export interface NativeTaskLaunchConfiguration {
  clusterArn: string;
  taskDefinitionArn: string;
  containerName: string;
  image: string;
  executionRoleArn: string;
  taskRoleArn: string;
  cpu: "256" | "512" | "1024";
  memory: "512" | "1024" | "2048";
  subnets: readonly string[];
  securityGroups: readonly string[];
  assignPublicIp: "ENABLED" | "DISABLED";
}
const unavailable = () => Error("NativeTaskLaunchUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function closed(value: object, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    !keys.every((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable && "value" in d;
    })
  )
    throw unavailable();
}
function configuration(input: NativeTaskLaunchConfiguration) {
  closed(input, [
    "clusterArn",
    "taskDefinitionArn",
    "containerName",
    "image",
    "executionRoleArn",
    "taskRoleArn",
    "cpu",
    "memory",
    "subnets",
    "securityGroups",
    "assignPublicIp",
  ]);
  const fixed = input;
  if (
    ![fixed.clusterArn, fixed.taskDefinitionArn, fixed.containerName, fixed.image].every(
      (v) => typeof v === "string",
    )
  )
    throw unavailable();
  const region = nativeTaskDeploymentRegion(fixed);
  const account = fixed.clusterArn.split(":")[4];
  const list = (values: readonly string[], pattern: RegExp, maximum: number) => {
    if (
      !Array.isArray(values) ||
      Object.getPrototypeOf(values) !== Array.prototype ||
      values.length < 1 ||
      values.length > maximum ||
      Reflect.ownKeys(values).length !== values.length + 1 ||
      !Array.from({ length: values.length }, (_, index) =>
        Object.getOwnPropertyDescriptor(values, String(index)),
      ).every(
        (d) =>
          d?.enumerable && "value" in d && typeof d.value === "string" && pattern.test(d.value),
      ) ||
      new Set(values).size !== values.length
    )
      throw unavailable();
    return Object.freeze([...values].sort());
  };
  if (
    !fixed.image.startsWith(`${account}.dkr.ecr.${region}.amazonaws.com/`) ||
    !/^[a-z0-9][a-z0-9/_-]{0,200}@sha256:[a-f0-9]{64}$/u.test(
      fixed.image.split("amazonaws.com/")[1] ?? "",
    ) ||
    ![fixed.executionRoleArn, fixed.taskRoleArn].every(
      (arn) =>
        typeof arn === "string" &&
        new RegExp(`^arn:aws:iam::${account}:role/[A-Za-z0-9_+=,.@/-]{1,128}$`, "u").test(arn),
    ) ||
    !["256", "512", "1024"].includes(fixed.cpu) ||
    !["512", "1024", "2048"].includes(fixed.memory) ||
    (fixed.cpu === "512" && fixed.memory === "512") ||
    (fixed.cpu === "1024" && fixed.memory !== "2048") ||
    !["ENABLED", "DISABLED"].includes(fixed.assignPublicIp)
  )
    throw unavailable();
  return Object.freeze({
    clusterArn: fixed.clusterArn,
    taskDefinitionArn: fixed.taskDefinitionArn,
    containerName: fixed.containerName,
    image: fixed.image,
    executionRoleArn: fixed.executionRoleArn,
    taskRoleArn: fixed.taskRoleArn,
    cpu: fixed.cpu,
    memory: fixed.memory,
    assignPublicIp: fixed.assignPublicIp,
    subnets: list(fixed.subnets, /^subnet-[a-f0-9]{17}$/u, 4),
    securityGroups: list(fixed.securityGroups, /^sg-[a-f0-9]{17}$/u, 4),
  });
}
function scope(input: NativeMaterialLaunchScope) {
  const keys = ["allocationId", "ownerUserId", "applicationId", "generationId", "epochId"] as const;
  closed(input, keys);
  const fixed = structuredClone(input);
  if (!keys.every((key) => typeof fixed[key] === "string" && uuid.test(fixed[key])))
    throw unavailable();
  return Object.freeze(fixed);
}
function checkedRecord(
  record: NativeMaterialLaunchRecord,
  fixed: NativeMaterialLaunchScope,
  config: NativeTaskLaunchConfiguration,
  sha256: string,
) {
  if (
    !record?.intent ||
    !record.original ||
    !record.deployment ||
    Object.keys(fixed).some(
      (key) =>
        record.intent[key as keyof NativeMaterialLaunchScope] !==
        fixed[key as keyof NativeMaterialLaunchScope],
    ) ||
    record.original.documentId !== fixed.generationId ||
    record.original.purpose !== "provider_dispatch" ||
    !uuid.test(record.original.id) ||
    !/^[a-f0-9]{64}$/u.test(record.original.requestSha256) ||
    record.configurationSha256 !== sha256 ||
    !Number.isSafeInteger(record.claimedAtEpochMs) ||
    (record.claimedAtEpochMs ?? 0) <= 0 ||
    record.deployment.clusterArn !== config.clusterArn ||
    record.deployment.taskDefinitionArn !== config.taskDefinitionArn ||
    record.deployment.containerName !== config.containerName
  )
    throw unavailable();
  if (record.intent.allocation) {
    const a = record.intent.allocation;
    nativeTaskAllocationRegion(a);
    if (
      a.allocationId !== fixed.allocationId ||
      a.ownerUserId !== fixed.ownerUserId ||
      a.applicationId !== fixed.applicationId ||
      a.generationId !== fixed.generationId ||
      a.clusterArn !== config.clusterArn ||
      a.taskDefinitionArn !== config.taskDefinitionArn ||
      a.containerName !== config.containerName ||
      record.intent.state === "pending"
    )
      throw unavailable();
  } else if (record.intent.state !== "pending") throw unavailable();
}
function taskDefinition(value: unknown, config: NativeTaskLaunchConfiguration) {
  const d = (value as { taskDefinition?: TaskDefinition } | null)?.taskDefinition;
  const c = d?.containerDefinitions?.[0];
  if (
    !d ||
    d.taskDefinitionArn !== config.taskDefinitionArn ||
    d.status !== "ACTIVE" ||
    d.networkMode !== "awsvpc" ||
    !d.requiresCompatibilities?.includes("FARGATE") ||
    d.runtimePlatform?.operatingSystemFamily !== "LINUX" ||
    d.runtimePlatform.cpuArchitecture !== "X86_64" ||
    d.cpu !== config.cpu ||
    d.memory !== config.memory ||
    d.executionRoleArn !== config.executionRoleArn ||
    d.taskRoleArn !== config.taskRoleArn ||
    !Array.isArray(d.containerDefinitions) ||
    d.containerDefinitions.length !== 1 ||
    !c ||
    c.name !== config.containerName ||
    c.image !== config.image ||
    c.essential !== true ||
    c.readonlyRootFilesystem !== true ||
    c.user !== "65532:65532" ||
    c.privileged === true ||
    c.logConfiguration !== undefined ||
    c.firelensConfiguration !== undefined ||
    c.healthCheck !== undefined ||
    c.interactive === true ||
    c.pseudoTerminal === true ||
    (c.systemControls?.length ?? 0) !== 0 ||
    JSON.stringify(c.entryPoint) !== JSON.stringify(["/usr/local/bin/node"]) ||
    JSON.stringify(c.command) !== JSON.stringify(["native-material/main.mjs"]) ||
    c.workingDirectory !== "/materials" ||
    d.pidMode !== undefined ||
    d.ipcMode !== undefined ||
    d.proxyConfiguration !== undefined ||
    (c.secrets?.length ?? 0) !== 0 ||
    (c.environment?.length ?? 0) !== 0 ||
    (c.environmentFiles?.length ?? 0) !== 0 ||
    (c.mountPoints?.length ?? 0) !== 0 ||
    (c.volumesFrom?.length ?? 0) !== 0 ||
    (d.volumes?.length ?? 0) !== 0 ||
    (c.linuxParameters?.capabilities?.add?.length ?? 0) !== 0 ||
    !c.linuxParameters?.capabilities?.drop?.includes("ALL") ||
    c.linuxParameters?.initProcessEnabled === true ||
    (c.linuxParameters?.devices?.length ?? 0) !== 0 ||
    (c.linuxParameters?.tmpfs?.length ?? 0) !== 0 ||
    !c.ulimits?.some(
      (limit) => limit.name === "core" && limit.softLimit === 0 && limit.hardLimit === 0,
    )
  )
    throw unavailable();
}
function actualTask(
  value: unknown,
  fixed: NativeMaterialLaunchScope,
  config: NativeTaskLaunchConfiguration,
  expectedTaskArn?: string,
): NativeTaskAllocation {
  const r = value as { tasks?: Task[]; failures?: unknown[] } | null;
  const t = r?.tasks?.[0];
  if (
    !r ||
    !Array.isArray(r.tasks) ||
    r.tasks.length !== 1 ||
    (r.failures !== undefined && (!Array.isArray(r.failures) || r.failures.length !== 0)) ||
    !t ||
    t.clusterArn !== config.clusterArn ||
    t.taskDefinitionArn !== config.taskDefinitionArn ||
    t.startedBy !== fixed.allocationId ||
    t.launchType !== "FARGATE" ||
    t.platformVersion !== "1.4.0" ||
    t.enableExecuteCommand !== false ||
    typeof t.taskArn !== "string" ||
    (expectedTaskArn !== undefined && t.taskArn !== expectedTaskArn) ||
    !Array.isArray(t.containers) ||
    t.containers.length !== 1 ||
    t.containers[0]?.name !== config.containerName ||
    t.containers[0].taskArn !== t.taskArn ||
    ![
      "PROVISIONING",
      "PENDING",
      "ACTIVATING",
      "RUNNING",
      "DEACTIVATING",
      "STOPPING",
      "DEPROVISIONING",
      "STOPPED",
    ].includes(t.lastStatus ?? "")
  )
    throw unavailable();
  const result = Object.freeze({
    allocationId: fixed.allocationId,
    ownerUserId: fixed.ownerUserId,
    applicationId: fixed.applicationId,
    generationId: fixed.generationId,
    clusterArn: config.clusterArn,
    taskDefinitionArn: config.taskDefinitionArn,
    containerName: config.containerName,
    taskArn: t.taskArn,
  });
  nativeTaskAllocationRegion(result);
  return result;
}

/** Private control-plane launcher only. No content, provider, SQL driver, credential issuer,
 * task listing or stop/settlement capability. Registry ports must be owning/authenticated.
 * Exactly one persisted attempt: a lost claim/RunTask/bind ACK never authorizes another RunTask.
 * Recovery captures only a positively described original task, including after sealing. */
export function createNativeTaskLaunch(options: {
  registry: Registry;
  configuration: NativeTaskLaunchConfiguration;
  enabled?: () => boolean;
  /** New launches may be disabled while positive original-task recovery remains enabled. */
  launchEnabled?: () => boolean;
  timeoutMs?: number;
  /** Test-only; production uses fixed signed regional ECS, never an endpoint override. */
  testClient?: TaskClient;
}) {
  let config: ReturnType<typeof configuration>;
  try {
    config = configuration(options.configuration);
  } catch {
    throw unavailable();
  }
  const region = nativeTaskDeploymentRegion(config);
  const configSha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-material-launch.v1", ...config }))
    .digest("hex");
  const enabled = options.enabled ?? (() => false);
  const launchEnabled = options.launchEnabled ?? (() => false);
  const timeout = options.timeoutMs ?? 10_000;
  const testClient = options.testClient;
  const registry = options.registry;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    (testClient && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  let active = false;
  async function run(
    input: NativeMaterialLaunchScope,
    mode: "launch" | "recover",
    taskArn?: string,
  ) {
    if (
      active ||
      !enabled() ||
      (mode === "launch" && !launchEnabled()) ||
      (mode === "launch" && !launchEnabled()) ||
      (testClient && process.env.NODE_ENV !== "test")
    )
      throw unavailable();
    let fixed: ReturnType<typeof scope>;
    try {
      fixed = scope(input);
      if (mode === "recover")
        nativeTaskAllocationRegion({ ...fixed, ...config, taskArn: taskArn ?? "" });
    } catch {
      throw unavailable();
    }
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref();
    const began = performance.now();
    let owned: ECSClient | undefined;
    const permitted = () => {
      if (
        !enabled() ||
        (mode === "launch" && !launchEnabled()) ||
        controller.signal.aborted ||
        performance.now() - began >= timeout ||
        (testClient && process.env.NODE_ENV !== "test")
      )
        throw unavailable();
    };
    const client = (): TaskClient => {
      permitted();
      if (!owned && !testClient)
        owned = new ECSClient({
          region,
          maxAttempts: 1,
          endpoint: `https://ecs.${region}.amazonaws.com`,
          ignoreConfiguredEndpointUrls: true,
          logger: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        });
      return testClient ?? (owned as ECSClient);
    };
    const send = (command: DescribeTaskDefinitionCommand | DescribeTasksCommand | RunTaskCommand) =>
      client().send(command, { abortSignal: controller.signal });
    try {
      let record: NativeMaterialLaunchRecord;
      if (mode === "launch") {
        const definition = await send(
          new DescribeTaskDefinitionCommand({ taskDefinition: config.taskDefinitionArn }),
        );
        permitted();
        taskDefinition(definition, config);
        const claim = await registry.claimLaunch(fixed, configSha);
        permitted();
        if (typeof claim?.claimed !== "boolean") throw unavailable();
        record = structuredClone(claim.record);
        checkedRecord(record, fixed, config, configSha);
        if (!claim.claimed) {
          if (!record.intent.allocation || record.intent.state !== "bound") throw unavailable();
          return record.intent.allocation;
        }
        if (record.intent.state !== "pending" || record.intent.allocation !== null)
          throw unavailable();
        const response = await send(
          new RunTaskCommand({
            cluster: config.clusterArn,
            taskDefinition: config.taskDefinitionArn,
            launchType: "FARGATE",
            platformVersion: "1.4.0",
            count: 1,
            startedBy: fixed.allocationId,
            clientToken: fixed.allocationId,
            enableExecuteCommand: false,
            enableECSManagedTags: false,
            propagateTags: "NONE",
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: [...config.subnets],
                securityGroups: [...config.securityGroups],
                assignPublicIp: config.assignPublicIp,
              },
            },
            overrides: {
              containerOverrides: [
                {
                  name: config.containerName,
                  environment: [
                    { name: "NATIVE_MATERIAL_ALLOCATION_ID", value: fixed.allocationId },
                    { name: "NATIVE_MATERIAL_OWNER_USER_ID", value: fixed.ownerUserId },
                    { name: "NATIVE_MATERIAL_APPLICATION_ID", value: fixed.applicationId },
                    { name: "NATIVE_MATERIAL_GENERATION_ID", value: fixed.generationId },
                    { name: "NATIVE_MATERIAL_EPOCH_ID", value: fixed.epochId },
                    { name: "NATIVE_MATERIAL_WORK_ID", value: record.original.id },
                    {
                      name: "NATIVE_MATERIAL_REQUEST_SHA256",
                      value: record.original.requestSha256,
                    },
                  ],
                },
              ],
            },
          }),
        );
        // An actually fulfilled late launch must be captured even after timeout/withdrawal.
        // The owning registry keeps capture authority independent of new-launch activation.
        const allocation = actualTask(response, fixed, config);
        const bound = await registry.bindTask(allocation);
        if (!bound.allocation || bound.allocation.taskArn !== allocation.taskArn)
          throw unavailable();
        permitted();
        return allocation;
      }
      record = structuredClone(await registry.readLaunch(fixed, configSha));
      permitted();
      checkedRecord(record, fixed, config, configSha);
      if (record.intent.allocation && record.intent.allocation.taskArn !== taskArn)
        throw unavailable();
      const response = await send(
        new DescribeTasksCommand({ cluster: config.clusterArn, tasks: [taskArn as string] }),
      );
      permitted();
      const allocation = actualTask(response, fixed, config, taskArn);
      const bound = await registry.bindTask(allocation);
      if (!bound.allocation || bound.allocation.taskArn !== allocation.taskArn) throw unavailable();
      permitted();
      return allocation;
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      owned?.destroy();
      // No competing launch/SDK call until the original promise (including late capture) settles.
      active = false;
    }
  }
  return Object.freeze({
    launch: (input: NativeMaterialLaunchScope) => run(input, "launch"),
    recover: (input: NativeMaterialLaunchScope, originalTaskArn: string) =>
      run(input, "recover", originalTaskArn),
  });
}
