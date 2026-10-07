import {
  type NativeTaskLaunchConfiguration,
  nativeLaunchedTask,
  nativeTaskLaunchConfiguration,
  nativeTaskLaunchScope as scope,
  validateNativeTaskDefinition,
} from "./native-task-launch-policy.js";

export {
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
} from "./native-task-launch-policy.js";

import { createHash } from "node:crypto";
import {
  DescribeTaskDefinitionCommand,
  DescribeTasksCommand,
  ECSClient,
  RunTaskCommand,
} from "@aws-sdk/client-ecs";
import type {
  NativeResumeGenerationRecord,
  NativeResumeGenerationScope,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import {
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";

type Registry = Pick<
  PostgresNativeResumeGenerationStore,
  "claimLaunch" | "readLaunch" | "bindTask"
>;
interface TaskClient {
  send(
    command: DescribeTaskDefinitionCommand | DescribeTasksCommand | RunTaskCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}
const unavailable = () => Error("NativeTaskLaunchUnavailable");
function checkedRecord(
  record: NativeResumeGenerationRecord,
  fixed: NativeResumeGenerationScope,
  config: NativeTaskLaunchConfiguration,
  sha256: string,
) {
  const reservation = record?.reservation;
  if (
    !reservation?.identity ||
    !reservation.deployment ||
    record.configurationSha256 !== sha256 ||
    record.allocationId !== fixed.allocationId ||
    record.epochId !== fixed.epochId ||
    reservation.identity.ownerUserId !== fixed.ownerUserId ||
    reservation.identity.applicationId !== fixed.applicationId ||
    reservation.identity.generationId !== fixed.generationId ||
    reservation.deployment.clusterArn !== config.clusterArn ||
    reservation.deployment.taskDefinitionArn !== config.taskDefinitionArn ||
    reservation.deployment.containerName !== config.containerName ||
    !["pending", "bound", "retired", "abandoned"].includes(record.state)
  )
    throw unavailable();
  if (record.allocation) {
    nativeTaskAllocationRegion(record.allocation);
    for (const key of ["allocationId", "ownerUserId", "applicationId", "generationId"] as const)
      if (record.allocation[key] !== fixed[key]) throw unavailable();
    for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
      if (record.allocation[key] !== config[key]) throw unavailable();
    if (record.state === "pending" || record.state === "abandoned") throw unavailable();
  } else if (record.state !== "pending" && record.state !== "abandoned") throw unavailable();
}
function originalEnvironment(fixed: NativeResumeGenerationScope, configurationSha256: string) {
  return [
    { name: "NATIVE_MATERIAL_ALLOCATION_ID", value: fixed.allocationId },
    { name: "NATIVE_MATERIAL_OWNER_USER_ID", value: fixed.ownerUserId },
    { name: "NATIVE_MATERIAL_APPLICATION_ID", value: fixed.applicationId },
    { name: "NATIVE_MATERIAL_GENERATION_ID", value: fixed.generationId },
    { name: "NATIVE_MATERIAL_EPOCH_ID", value: fixed.epochId },
    { name: "NATIVE_RESUME_CONFIGURATION_SHA256", value: configurationSha256 },
  ];
}

/** Private control-plane launcher only. No content, provider, SQL driver, credential issuer,
 * task listing or stop/settlement capability. Registry ports must be owning/authenticated.
 * Exactly one persisted attempt: a lost claim/RunTask/bind ACK never authorizes another RunTask.
 * Recovery captures only a positively described original task, including after sealing. */
export function createNativeResumeTaskLaunch(options: {
  registry: Registry;
  configuration: NativeTaskLaunchConfiguration;
  enabled?: () => boolean;
  /** New launches may be disabled while positive original-task recovery remains enabled. */
  launchEnabled?: () => boolean;
  timeoutMs?: number;
  /** Test-only; production uses fixed signed regional ECS, never an endpoint override. */
  testClient?: TaskClient;
}) {
  let config: ReturnType<typeof nativeTaskLaunchConfiguration>;
  try {
    config = nativeTaskLaunchConfiguration(options.configuration);
  } catch {
    throw unavailable();
  }
  const region = nativeTaskDeploymentRegion(config);
  const configSha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...config }))
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
    input: NativeResumeGenerationScope,
    mode: "launch" | "recover",
    taskArn?: string,
  ) {
    if (
      active ||
      !enabled() ||
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
      let record: NativeResumeGenerationRecord;
      if (mode === "launch") {
        const definition = await send(
          new DescribeTaskDefinitionCommand({ taskDefinition: config.taskDefinitionArn }),
        );
        permitted();
        validateNativeTaskDefinition(definition, config, "native-resume/main.mjs");
        const claim = await registry.claimLaunch(fixed, configSha);
        permitted();
        if (typeof claim?.claimed !== "boolean") throw unavailable();
        record = structuredClone(claim.record);
        checkedRecord(record, fixed, config, configSha);
        if (!claim.claimed) {
          if (!record.allocation || record.state !== "bound") throw unavailable();
          return record.allocation;
        }
        if (record.state !== "pending" || record.allocation !== null) throw unavailable();
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
                  environment: originalEnvironment(fixed, configSha),
                },
              ],
            },
          }),
        );
        // An actually fulfilled late launch must be captured even after timeout/withdrawal.
        // The owning registry keeps capture authority independent of new-launch activation.
        const allocation = nativeLaunchedTask(
          response,
          fixed,
          config,
          originalEnvironment(fixed, configSha),
        );
        const bound = await registry.bindTask(fixed, configSha, allocation.taskArn);
        if (!bound.allocation || bound.allocation.taskArn !== allocation.taskArn)
          throw unavailable();
        permitted();
        return allocation;
      }
      record = structuredClone(await registry.readLaunch(fixed, configSha));
      permitted();
      checkedRecord(record, fixed, config, configSha);
      if (record.allocation && record.allocation.taskArn !== taskArn) throw unavailable();
      const response = await send(
        new DescribeTasksCommand({ cluster: config.clusterArn, tasks: [taskArn as string] }),
      );
      permitted();
      const allocation = nativeLaunchedTask(
        response,
        fixed,
        config,
        originalEnvironment(fixed, configSha),
        taskArn,
      );
      const bound = await registry.bindTask(fixed, configSha, allocation.taskArn);
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
    configurationSha256: configSha,
    launch: (input: NativeResumeGenerationScope) => run(input, "launch"),
    recover: (input: NativeResumeGenerationScope, originalTaskArn: string) =>
      run(input, "recover", originalTaskArn),
  });
}
