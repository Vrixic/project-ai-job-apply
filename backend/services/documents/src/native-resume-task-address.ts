import { createHash } from "node:crypto";
import { isIPv4 } from "node:net";
import { isDeepStrictEqual } from "node:util";
import {
  DescribeNetworkInterfacesCommand,
  EC2Client,
  type NetworkInterface,
} from "@aws-sdk/client-ec2";
import { DescribeTasksCommand, ECSClient, type Task } from "@aws-sdk/client-ecs";
import type {
  NativeResumeGenerationRecord,
  NativeResumeGenerationScope,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import {
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";
import {
  type NativeTaskLaunchConfiguration,
  nativeLaunchedTask,
  nativeResumeLaunchEnvironment,
  nativeTaskLaunchConfiguration,
  nativeTaskLaunchScope,
} from "./native-task-launch-policy.js";
import { validateTemporaryMaterialReference } from "./temporary-material-reference.js";

type TestClients = {
  ecs: {
    send(command: DescribeTasksCommand, options: { abortSignal: AbortSignal }): Promise<unknown>;
  };
  ec2: {
    send(
      command: DescribeNetworkInterfacesCommand,
      options: { abortSignal: AbortSignal },
    ): Promise<unknown>;
  };
};
const unavailable = () => Error("NativeResumeTaskAddressUnavailable");

function publicIpv4(value: unknown): value is string {
  if (typeof value !== "string" || !isIPv4(value)) return false;
  const [a = 0, b = 0, c = 0] = value.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Private, point-in-time network metadata for the original ready task. This neither grants
 * content access nor proves DNS/TLS reachability. No launch, task stop, DNS or ENI mutation.
 * Registry is an owning private port; do not accept candidate-selected task/ENI/address inputs. */
export function createNativeResumeTaskAddressReader(options: {
  registry: Pick<PostgresNativeResumeGenerationStore, "readLaunch">;
  configuration: NativeTaskLaunchConfiguration;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClients?: TestClients;
}) {
  const config = nativeTaskLaunchConfiguration(options.configuration);
  const region = nativeTaskDeploymentRegion(config);
  const account = config.clusterArn.split(":")[4];
  const sha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...config }))
    .digest("hex");
  const enabled = options.enabled ?? (() => false);
  const timeout = options.timeoutMs ?? 10_000;
  const test = options.testClients;
  const readLaunch = options.registry.readLaunch.bind(options.registry);
  if (
    region !== "us-east-2" ||
    config.assignPublicIp !== "ENABLED" ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    (test && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  let active = false;

  return Object.freeze({
    async read(input: NativeResumeGenerationScope) {
      if (active || !enabled() || (test && process.env.NODE_ENV !== "test")) throw unavailable();
      const scope = nativeTaskLaunchScope(input);
      active = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      timer.unref();
      const began = performance.now();
      let ecs: ECSClient | undefined;
      let ec2: EC2Client | undefined;
      const check = () => {
        if (
          !enabled() ||
          controller.signal.aborted ||
          performance.now() - began >= timeout ||
          (test && process.env.NODE_ENV !== "test")
        )
          throw unavailable();
      };
      function checkedRecord(row: NativeResumeGenerationRecord) {
        check();
        const allocation = row.allocation;
        const reference = row.reference;
        if (
          row.state !== "bound" ||
          !row.ready ||
          !allocation ||
          !reference ||
          row.allocationId !== scope.allocationId ||
          row.epochId !== scope.epochId ||
          row.configurationSha256 !== sha ||
          !validateTemporaryMaterialReference(reference) ||
          reference.kind !== "tailored_resume" ||
          Date.now() >= reference.expiresAtMs
        )
          throw unavailable();
        nativeTaskAllocationRegion(allocation);
        for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
          if (
            row.reservation.identity[key] !== scope[key] ||
            allocation[key] !== scope[key] ||
            reference[key] !== scope[key]
          )
            throw unavailable();
        if (allocation.allocationId !== scope.allocationId) throw unavailable();
        for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
          if (allocation[key] !== config[key] || row.reservation.deployment[key] !== config[key])
            throw unavailable();
        return { allocation, reference };
      }
      try {
        const original = checkedRecord(structuredClone(await readLaunch(scope, sha)));
        const logger = {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        };
        const clientOptions = {
          region,
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          logger,
        };
        if (!test) {
          ecs = new ECSClient({
            ...clientOptions,
            endpoint: `https://ecs.${region}.amazonaws.com`,
          });
          ec2 = new EC2Client({
            ...clientOptions,
            endpoint: `https://ec2.${region}.amazonaws.com`,
          });
        }
        const taskClient = test?.ecs ?? (ecs as ECSClient);
        const networkClient = test?.ec2 ?? (ec2 as EC2Client);
        async function taskNetwork() {
          check();
          const result = await taskClient.send(
            new DescribeTasksCommand({
              cluster: config.clusterArn,
              tasks: [original.allocation.taskArn],
            }),
            { abortSignal: controller.signal },
          );
          check();
          nativeLaunchedTask(
            result,
            scope,
            config,
            nativeResumeLaunchEnvironment(scope, sha),
            original.allocation.taskArn,
          );
          const task = (result as { tasks: Task[] }).tasks[0];
          const container = task?.containers?.[0];
          const attachment = task?.attachments?.[0];
          if (
            task?.lastStatus !== "RUNNING" ||
            task.desiredStatus !== "RUNNING" ||
            container?.lastStatus !== "RUNNING" ||
            container.image !== config.image ||
            container.imageDigest !== config.image.split("@")[1] ||
            task.attachments?.length !== 1 ||
            !attachment ||
            attachment.type !== "ElasticNetworkInterface" ||
            attachment.status !== "ATTACHED" ||
            !Array.isArray(attachment.details)
          )
            throw unavailable();
          const details = attachment.details;
          if (new Set(details.map((entry) => entry.name)).size !== details.length)
            throw unavailable();
          const get = (name: string) => details.find((entry) => entry.name === name)?.value;
          const eni = get("networkInterfaceId"),
            subnet = get("subnetId"),
            privateIp = get("privateIPv4Address");
          if (
            !eni ||
            !/^eni-[a-f0-9]{17}$/u.test(eni) ||
            !subnet ||
            !config.subnets.includes(subnet) ||
            !privateIp ||
            !isIPv4(privateIp) ||
            container.networkInterfaces?.length !== 1 ||
            container.networkInterfaces[0]?.privateIpv4Address !== privateIp ||
            !attachment.id ||
            container.networkInterfaces[0]?.attachmentId !== attachment.id
          )
            throw unavailable();
          return { eni, subnet, privateIp };
        }
        const network = await taskNetwork();
        check();
        const result = await networkClient.send(
          new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [network.eni] }),
          { abortSignal: controller.signal },
        );
        check();
        const interfaces = (result as { NetworkInterfaces?: NetworkInterface[] })
          ?.NetworkInterfaces;
        const eni = interfaces?.[0];
        if (
          !Array.isArray(interfaces) ||
          interfaces.length !== 1 ||
          !eni ||
          (result as { NextToken?: string }).NextToken !== undefined ||
          eni.NetworkInterfaceId !== network.eni ||
          eni.OwnerId !== account ||
          eni.Status !== "in-use" ||
          eni.SubnetId !== network.subnet ||
          eni.PrivateIpAddress !== network.privateIp ||
          !Array.isArray(eni.Groups) ||
          eni.Groups.length !== config.securityGroups.length ||
          !isDeepStrictEqual(eni.Groups.map((group) => group.GroupId).sort(), [
            ...config.securityGroups,
          ]) ||
          !publicIpv4(eni.Association?.PublicIp)
        )
          throw unavailable();
        const publicIp = eni.Association.PublicIp;
        if (!isDeepStrictEqual(network, await taskNetwork())) throw unavailable();
        const current = checkedRecord(structuredClone(await readLaunch(scope, sha)));
        if (!isDeepStrictEqual(original, current)) throw unavailable();
        return Object.freeze({
          allocationId: scope.allocationId,
          taskArn: original.allocation.taskArn,
          networkInterfaceId: network.eni,
          publicIp,
          expiresAtMs: original.reference.expiresAtMs,
        });
      } catch {
        throw unavailable();
      } finally {
        clearTimeout(timer);
        ecs?.destroy();
        ec2?.destroy();
        // Keep admission occupied until even an abort-ignoring transport has actually settled.
        active = false;
      }
    },
  });
}
