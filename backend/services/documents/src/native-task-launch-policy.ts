import type { Task, TaskDefinition } from "@aws-sdk/client-ecs";
import {
  type NativeTaskAllocation,
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";
export interface NativeTaskLaunchScope {
  allocationId: string;
  ownerUserId: string;
  applicationId: string;
  generationId: string;
  epochId: string;
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
/** Original scalar overrides shared by launch and subsequent task observations. */
export function nativeResumeLaunchEnvironment(
  fixed: NativeTaskLaunchScope,
  configurationSha256: string,
) {
  return [
    { name: "NATIVE_MATERIAL_ALLOCATION_ID", value: fixed.allocationId },
    { name: "NATIVE_MATERIAL_OWNER_USER_ID", value: fixed.ownerUserId },
    { name: "NATIVE_MATERIAL_APPLICATION_ID", value: fixed.applicationId },
    { name: "NATIVE_MATERIAL_GENERATION_ID", value: fixed.generationId },
    { name: "NATIVE_MATERIAL_EPOCH_ID", value: fixed.epochId },
    { name: "NATIVE_RESUME_CONFIGURATION_SHA256", value: configurationSha256 },
  ];
}
export function nativeMaterialLaunchEnvironment(
  fixed: NativeTaskLaunchScope,
  original: { id: string; requestSha256: string },
) {
  return [
    { name: "NATIVE_MATERIAL_ALLOCATION_ID", value: fixed.allocationId },
    { name: "NATIVE_MATERIAL_OWNER_USER_ID", value: fixed.ownerUserId },
    { name: "NATIVE_MATERIAL_APPLICATION_ID", value: fixed.applicationId },
    { name: "NATIVE_MATERIAL_GENERATION_ID", value: fixed.generationId },
    { name: "NATIVE_MATERIAL_EPOCH_ID", value: fixed.epochId },
    { name: "NATIVE_MATERIAL_WORK_ID", value: original.id },
    { name: "NATIVE_MATERIAL_REQUEST_SHA256", value: original.requestSha256 },
  ];
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
export function nativeTaskLaunchConfiguration(input: NativeTaskLaunchConfiguration) {
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
export function nativeTaskLaunchScope(input: NativeTaskLaunchScope) {
  const keys = ["allocationId", "ownerUserId", "applicationId", "generationId", "epochId"] as const;
  closed(input, keys);
  const fixed = structuredClone(input);
  if (!keys.every((key) => typeof fixed[key] === "string" && uuid.test(fixed[key])))
    throw unavailable();
  return Object.freeze(fixed);
}
export function validateNativeTaskDefinition(
  value: unknown,
  config: NativeTaskLaunchConfiguration,
  command: "native-material/main.mjs" | "native-resume/main.mjs",
) {
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
    JSON.stringify(c.command) !== JSON.stringify([command]) ||
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
    // Kernel SIGKILL deadlines must target a child of container init, not namespace PID 1.
    c.linuxParameters?.initProcessEnabled !== true ||
    (c.linuxParameters?.devices?.length ?? 0) !== 0 ||
    (c.linuxParameters?.tmpfs?.length ?? 0) !== 0 ||
    !c.ulimits?.some(
      (limit) => limit.name === "core" && limit.softLimit === 0 && limit.hardLimit === 0,
    )
  )
    throw unavailable();
}
export function nativeLaunchedTask(
  value: unknown,
  fixed: NativeTaskLaunchScope,
  config: NativeTaskLaunchConfiguration,
  expected: readonly { name: string; value: string }[],
  expectedTaskArn?: string,
): NativeTaskAllocation {
  const r = value as { tasks?: Task[]; failures?: unknown[] } | null;
  const t = r?.tasks?.[0];
  const overrides = t?.overrides;
  const container = overrides?.containerOverrides?.[0];
  const environment = container?.environment;
  if (
    !overrides ||
    !Array.isArray(overrides.containerOverrides) ||
    overrides.containerOverrides.length !== 1 ||
    !container ||
    container.name !== config.containerName ||
    !Array.isArray(environment) ||
    environment.length !== expected.length ||
    new Set(environment.map((entry) => entry?.name)).size !== expected.length ||
    !environment.every(
      (entry) =>
        entry &&
        typeof entry.name === "string" &&
        typeof entry.value === "string" &&
        Object.keys(entry).every((key) => key === "name" || key === "value") &&
        expected.some((wanted) => wanted.name === entry.name && wanted.value === entry.value),
    ) ||
    (container.command?.length ?? 0) !== 0 ||
    (container.environmentFiles?.length ?? 0) !== 0 ||
    (container.resourceRequirements?.length ?? 0) !== 0 ||
    (container.cpu !== undefined && container.cpu !== 0) ||
    (container.memory !== undefined && container.memory !== 0) ||
    (container.memoryReservation !== undefined && container.memoryReservation !== 0) ||
    (overrides.cpu !== undefined && overrides.cpu !== config.cpu) ||
    (overrides.memory !== undefined && overrides.memory !== config.memory) ||
    (overrides.taskRoleArn !== undefined && overrides.taskRoleArn !== config.taskRoleArn) ||
    (overrides.executionRoleArn !== undefined &&
      overrides.executionRoleArn !== config.executionRoleArn) ||
    (overrides.inferenceAcceleratorOverrides?.length ?? 0) !== 0 ||
    overrides.ephemeralStorage !== undefined
  )
    throw unavailable();
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
