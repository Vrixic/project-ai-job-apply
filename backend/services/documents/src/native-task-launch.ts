import {
  type NativeTaskLaunchConfiguration,
  nativeLaunchedTask,
  nativeMaterialLaunchEnvironment,
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
  NativeMaterialLaunchRecord,
  NativeMaterialLaunchScope,
  PostgresNativeMaterialRegistry,
} from "./native-material-registry.js";
import {
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
const unavailable = () => Error("NativeTaskLaunchUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
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
  let config: ReturnType<typeof nativeTaskLaunchConfiguration>;
  try {
    config = nativeTaskLaunchConfiguration(options.configuration);
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
        validateNativeTaskDefinition(definition, config, "native-material/main.mjs");
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
                  environment: nativeMaterialLaunchEnvironment(fixed, record.original),
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
          nativeMaterialLaunchEnvironment(fixed, record.original),
        );
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
      const allocation = nativeLaunchedTask(
        response,
        fixed,
        config,
        nativeMaterialLaunchEnvironment(fixed, record.original),
        taskArn,
      );
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
