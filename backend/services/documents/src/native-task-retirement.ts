import { DescribeTasksCommand, ECSClient, StopTaskCommand, type Task } from "@aws-sdk/client-ecs";

import {
  type NativeTaskAllocation,
  type NativeTaskRetirementReceipt,
  nativeTaskAllocationRegion,
} from "./native-task-allocation.js";

export type {
  NativeTaskAllocation,
  NativeTaskRetirementReceipt,
} from "./native-task-allocation.js";

interface TaskClient {
  send(
    command: DescribeTasksCommand | StopTaskCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}

const unavailable = () => Error("NativeTaskRetirementUnavailable");

function describedTask(value: unknown, allocation: NativeTaskAllocation): Task {
  if (!value || typeof value !== "object") throw unavailable();
  const response = value as { tasks?: Task[]; failures?: unknown[] };
  const task = response.tasks?.[0];
  if (
    !Array.isArray(response.tasks) ||
    response.tasks.length !== 1 ||
    (response.failures !== undefined &&
      (!Array.isArray(response.failures) || response.failures.length !== 0)) ||
    !task ||
    task.taskArn !== allocation.taskArn ||
    task.clusterArn !== allocation.clusterArn ||
    task.taskDefinitionArn !== allocation.taskDefinitionArn ||
    task.startedBy !== allocation.allocationId ||
    ![
      "PROVISIONING",
      "PENDING",
      "ACTIVATING",
      "RUNNING",
      "DEACTIVATING",
      "STOPPING",
      "DEPROVISIONING",
      "STOPPED",
    ].includes(task.lastStatus ?? "")
  )
    throw unavailable();
  return task;
}

/** Trusted control process only. No generated content, SQL, RunTask/ListTasks, local-process
 * response, workflow settlement or physical-purge certificate. A future owning registry must
 * seal admission and retire every bound allocation before acknowledging application disposal.
 * StopTask replies are never authority: only fresh DescribeTasks terminal evidence is used. */
export function createNativeTaskRetirement(options: {
  allocation: NativeTaskAllocation;
  enabled?: () => boolean;
  maximumObservations?: number;
  timeoutMs?: number;
  /** Test-only: production uses the normal signed SDK with no endpoint/credential override. */
  testClient?: TaskClient;
}) {
  const allocation = Object.freeze(structuredClone(options.allocation));
  const region = nativeTaskAllocationRegion(allocation);
  const enabled = options.enabled ?? (() => false);
  const observations = options.maximumObservations ?? 3;
  const timeout = options.timeoutMs ?? 10_000;
  const testClient = options.testClient;
  if (
    !Number.isSafeInteger(observations) ||
    observations < 1 ||
    observations > 5 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10_000 ||
    (testClient && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  let active = false;
  return Object.freeze({
    async retire(
      scope: Pick<
        NativeTaskAllocation,
        "ownerUserId" | "applicationId" | "generationId" | "allocationId"
      >,
      signal?: AbortSignal,
    ): Promise<NativeTaskRetirementReceipt> {
      if (
        active ||
        (testClient && process.env.NODE_ENV !== "test") ||
        !enabled() ||
        signal?.aborted ||
        scope.ownerUserId !== allocation.ownerUserId ||
        scope.applicationId !== allocation.applicationId ||
        scope.generationId !== allocation.generationId ||
        scope.allocationId !== allocation.allocationId
      )
        throw unavailable();
      active = true;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, timeout);
      timer.unref();
      let ownedClient: ECSClient | undefined;
      const beganAt = performance.now();
      const permitted = () => {
        if (
          (testClient && process.env.NODE_ENV !== "test") ||
          !enabled() ||
          controller.signal.aborted ||
          performance.now() - beganAt >= timeout
        )
          throw unavailable();
      };
      try {
        permitted();
        // Never create an AWS client before the capability and fixed scope have passed.
        if (!testClient)
          ownedClient = new ECSClient({
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
        const client: TaskClient = testClient ?? (ownedClient as ECSClient);
        const describe = async () => {
          permitted();
          const response = await client.send(
            new DescribeTasksCommand({
              cluster: allocation.clusterArn,
              tasks: [allocation.taskArn],
            }),
            { abortSignal: controller.signal },
          );
          permitted();
          return describedTask(response, allocation);
        };
        let task = await describe();
        if (task.lastStatus !== "STOPPED" && task.desiredStatus !== "STOPPED") {
          permitted();
          try {
            // Fixed diagnostic only; candidate identifiers/data never enter the stop reason.
            await client.send(
              new StopTaskCommand({
                cluster: allocation.clusterArn,
                task: allocation.taskArn,
                reason: "native_material_retirement",
              }),
              { abortSignal: controller.signal },
            );
          } catch {
            // A lost stop ACK is not success or failure authority. A subsequent exact terminal
            // observation may independently prove retirement, without another stop request.
          }
          permitted();
        }
        for (
          let observation = 0;
          task.lastStatus !== "STOPPED" && observation < observations;
          observation++
        ) {
          task = await describe();
        }
        const observedAt = Date.now();
        const stoppedAt = task.stoppedAt instanceof Date ? task.stoppedAt.getTime() : Number.NaN;
        if (
          task.lastStatus !== "STOPPED" ||
          task.desiredStatus !== "STOPPED" ||
          !Number.isSafeInteger(stoppedAt) ||
          stoppedAt <= 0 ||
          stoppedAt > observedAt ||
          !Array.isArray(task.containers) ||
          task.containers.length !== 1 ||
          task.containers[0]?.name !== allocation.containerName ||
          task.containers[0]?.taskArn !== allocation.taskArn ||
          task.containers[0]?.lastStatus !== "STOPPED"
        )
          throw unavailable();
        permitted();
        return Object.freeze({
          schemaVersion: 1,
          kind: "native_task_stopped",
          allocationId: allocation.allocationId,
          ownerUserId: allocation.ownerUserId,
          applicationId: allocation.applicationId,
          generationId: allocation.generationId,
          clusterArn: allocation.clusterArn,
          taskArn: allocation.taskArn,
          taskDefinitionArn: allocation.taskDefinitionArn,
          stoppedAtEpochMs: stoppedAt,
          observedAtEpochMs: observedAt,
        });
      } catch {
        throw unavailable();
      } finally {
        // Admission is retained until the actual SDK promise settles even after timeout/abort.
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        ownedClient?.destroy();
        active = false;
      }
    },
  });
}
