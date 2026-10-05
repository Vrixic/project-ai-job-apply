/** Private immutable launcher/registry binding, never obtained from a candidate request.
 * This client does not issue allocations or certify that the registry is complete/sealed. */
export interface NativeTaskAllocation {
  allocationId: string;
  ownerUserId: string;
  applicationId: string;
  generationId: string;
  clusterArn: string;
  taskArn: string;
  taskDefinitionArn: string;
  containerName: string;
}

/** Evidence for exactly this task, not provider settlement or all-copy candidate purge. */
export interface NativeTaskRetirementReceipt {
  schemaVersion: 1;
  kind: "native_task_stopped";
  allocationId: string;
  ownerUserId: string;
  applicationId: string;
  generationId: string;
  clusterArn: string;
  taskArn: string;
  taskDefinitionArn: string;
  stoppedAtEpochMs: number;
  observedAtEpochMs: number;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeTaskRetirementUnavailable");

export function nativeTaskDeploymentRegion(
  deployment: Pick<NativeTaskAllocation, "clusterArn" | "taskDefinitionArn" | "containerName">,
): string {
  const cluster =
    /^arn:aws:ecs:([a-z]{2}-[a-z]+-\d):([0-9]{12}):cluster\/([A-Za-z0-9_-]{1,255})$/u.exec(
      deployment.clusterArn,
    );
  if (!cluster || !/^[A-Za-z0-9_-]{1,255}$/u.test(deployment.containerName)) throw unavailable();
  const [, region, account] = cluster;
  if (
    !deployment.taskDefinitionArn.startsWith(`arn:aws:ecs:${region}:${account}:task-definition/`) ||
    !/^[A-Za-z0-9_-]{1,255}:[1-9][0-9]{0,9}$/u.test(
      deployment.taskDefinitionArn.split("task-definition/")[1] ?? "",
    )
  )
    throw unavailable();
  return region as string;
}

export function nativeTaskAllocationRegion(allocation: NativeTaskAllocation): string {
  const region = nativeTaskDeploymentRegion(allocation);
  if (
    ![
      allocation.allocationId,
      allocation.ownerUserId,
      allocation.applicationId,
      allocation.generationId,
    ].every((id) => typeof id === "string" && uuid.test(id))
  )
    throw unavailable();
  const [, account, name] =
    allocation.clusterArn
      .split(":")
      .slice(3)
      .join(":")
      .match(/^[^:]+:([0-9]{12}):cluster\/(.+)$/u) ?? [];
  const prefix = `arn:aws:ecs:${region}:${account}:task/${name}/`;
  if (
    !allocation.taskArn.startsWith(prefix) ||
    !/^[a-f0-9]{32}$/u.test(allocation.taskArn.slice(prefix.length))
  )
    throw unavailable();
  return region;
}
