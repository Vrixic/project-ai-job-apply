import { isIPv4 } from "node:net";
import { isDeepStrictEqual } from "node:util";
import {
  DescribeNetworkInterfacesCommand,
  EC2Client,
  type NetworkInterface,
} from "@aws-sdk/client-ec2";
import { DescribeTasksCommand, ECSClient, type Task } from "@aws-sdk/client-ecs";
import { nativeResumePublicIpv4 } from "./native-resume-route-policy.js";
import {
  type NativeTaskAllocation,
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";
import {
  type NativeTaskLaunchConfiguration,
  type NativeTaskLaunchScope,
  nativeLaunchedTask,
  nativeTaskLaunchConfiguration,
  nativeTaskLaunchScope,
} from "./native-task-launch-policy.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

export type NativeTaskAddressTestClients = {
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

/** Shared signed AWS observation. Owning adapters validate current readiness/admission both
 * before and after network reads. No caller-selected task, ENI or address is accepted. */
export function createNativeTaskAddressReader<Input>(options: {
  configuration: NativeTaskLaunchConfiguration;
  scope(input: Input): NativeTaskLaunchScope;
  original(
    input: Input,
    scope: NativeTaskLaunchScope,
  ): Promise<{
    allocation: NativeTaskAllocation;
    reference: TemporaryMaterialReference;
    environment: { name: string; value: string }[];
  }>;
  kind: "cover_letter" | "tailored_resume";
  unavailable(): Error;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClients?: NativeTaskAddressTestClients;
}) {
  const unavailable = options.unavailable;
  const config = nativeTaskLaunchConfiguration(options.configuration);
  const region = nativeTaskDeploymentRegion(config);
  const account = config.clusterArn.split(":")[4];
  const enabled = options.enabled ?? (() => false);
  const timeout = options.timeoutMs ?? 10_000;
  const test = options.testClients;
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
    async read(raw: Input) {
      if (active || !enabled() || (test && process.env.NODE_ENV !== "test")) throw unavailable();
      const input = structuredClone(raw);
      const scope = nativeTaskLaunchScope(options.scope(input));
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
      async function originalRecord() {
        check();
        const record = structuredClone(await options.original(input, scope));
        check();
        const { allocation, reference } = record;
        nativeTaskAllocationRegion(allocation);
        if (
          !validateTemporaryMaterialReference(reference) ||
          reference.kind !== options.kind ||
          Date.now() >= reference.expiresAtMs ||
          allocation.allocationId !== scope.allocationId
        )
          throw unavailable();
        for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
          if (allocation[key] !== scope[key] || reference[key] !== scope[key]) throw unavailable();
        for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
          if (allocation[key] !== config[key]) throw unavailable();
        return record;
      }
      try {
        const original = await originalRecord();
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
            original.environment,
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
          !nativeResumePublicIpv4(eni.Association?.PublicIp)
        )
          throw unavailable();
        const publicIp = eni.Association.PublicIp;
        if (!isDeepStrictEqual(network, await taskNetwork())) throw unavailable();
        const current = await originalRecord();
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
