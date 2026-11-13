import { DescribeTasksCommand, ECSClient } from "@aws-sdk/client-ecs";
import { failureFields } from "./failure-fields.js";

/**
 * Which native resume tasks ECS shows are no longer running. A native resume generation settles by its own task's terminal
 * description (ADR-040), but ECS keeps a stopped task's description for about an hour, so a retirement that was not
 * recorded in that window can never be proven afterwards. When the candidate's resume is being purged, the sweep asks this
 * observer about the exact task ARNs Documents names and hands back only the ones it could prove gone, and Documents
 * applies its own age and shape checks before it settles anything (migration 0021).
 *
 * Read-only: DescribeTasks on the retained native clusters, nothing else. A task counts as gone only when ECS reports it
 * MISSING (no description at all) or STOPPED. A running, starting or stopping task, any other failure reason, an answer
 * that does not match the request, and any error leave the task unproven, which keeps the purge blocked. Nothing here
 * logs a task ARN, a cluster or a message.
 */
export interface NativeTaskAbsenceObserver {
  absent(taskArns: readonly string[]): Promise<ReadonlySet<string>>;
}

interface TaskClient {
  send(command: DescribeTasksCommand, options: { abortSignal: AbortSignal }): Promise<unknown>;
}

const CLUSTER_ARN =
  /^arn:aws:ecs:([a-z]{2}-[a-z]+-[0-9]):([0-9]{12}):cluster\/([A-Za-z0-9_-]{1,255})$/u;
const TASK_ARN =
  /^arn:aws:ecs:([a-z]{2}-[a-z]+-[0-9]):([0-9]{12}):task\/([A-Za-z0-9_-]{1,255})\/([A-Za-z0-9]{1,255})$/u;
const MAXIMUM_CLUSTERS = 8;
// DescribeTasks accepts at most 100 tasks per call, so one call per cluster covers everything considered.
const MAXIMUM_TASKS = 100;

function clusterArnOf(taskArn: string): string | undefined {
  const match = TASK_ARN.exec(taskArn);
  return match ? `arn:aws:ecs:${match[1]}:${match[2]}:cluster/${match[3]}` : undefined;
}

export function createNativeTaskAbsenceObserver(options: {
  clusterArns: readonly string[];
  timeoutMs?: number;
  /** Test-only: production uses the normal signed SDK client with no endpoint or credential override. */
  testClient?: TaskClient;
}): NativeTaskAbsenceObserver {
  const clusters = new Set(options.clusterArns);
  const timeout = options.timeoutMs ?? 10_000;
  const regions = new Set<string>();
  for (const arn of clusters) {
    const match = CLUSTER_ARN.exec(arn);
    if (match?.[1]) regions.add(match[1]);
  }
  if (
    clusters.size < 1 ||
    clusters.size > MAXIMUM_CLUSTERS ||
    regions.size !== 1 ||
    ![...clusters].every((arn) => CLUSTER_ARN.test(arn)) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 30_000 ||
    (options.testClient && process.env.NODE_ENV !== "test")
  ) {
    throw new Error("NativeTaskAbsenceConfigurationInvalid");
  }
  let client: TaskClient | undefined = options.testClient;
  const region = [...regions][0] as string;

  return {
    async absent(taskArns) {
      const gone = new Set<string>();
      const byCluster = new Map<string, string[]>();
      for (const arn of new Set(taskArns.slice(0, MAXIMUM_TASKS))) {
        const cluster = clusterArnOf(arn);
        // A task outside the retained clusters is never asked about, so it stays unproven.
        if (!cluster || !clusters.has(cluster)) continue;
        byCluster.set(cluster, [...(byCluster.get(cluster) ?? []), arn]);
      }
      client ??= new ECSClient({ region }) as unknown as TaskClient;
      for (const [cluster, arns] of byCluster) {
        try {
          const response = await client.send(new DescribeTasksCommand({ cluster, tasks: arns }), {
            abortSignal: AbortSignal.timeout(timeout),
          });
          for (const arn of provenGone(response, cluster, arns)) gone.add(arn);
        } catch (error) {
          try {
            console.warn({ event: "native_task_absence_unavailable", ...failureFields(error) });
          } catch {
            // Unavailable diagnostics must not change the outcome: the tasks stay unproven.
          }
        }
      }
      return gone;
    },
  };
}

function provenGone(response: unknown, cluster: string, requested: readonly string[]): string[] {
  if (typeof response !== "object" || response === null) return [];
  const { tasks, failures } = response as { tasks?: unknown; failures?: unknown };
  if (!Array.isArray(tasks) || !Array.isArray(failures)) return [];
  const asked = new Set(requested);
  const stopped = new Set<string>();
  const described = new Set<string>();
  for (const task of tasks) {
    if (typeof task !== "object" || task === null) continue;
    const { taskArn, clusterArn, lastStatus } = task as {
      taskArn?: unknown;
      clusterArn?: unknown;
      lastStatus?: unknown;
    };
    if (typeof taskArn !== "string" || !asked.has(taskArn)) continue;
    described.add(taskArn);
    if (clusterArn === cluster && lastStatus === "STOPPED") stopped.add(taskArn);
  }
  const missing = new Set<string>();
  for (const failure of failures) {
    if (typeof failure !== "object" || failure === null) continue;
    const { arn, reason } = failure as { arn?: unknown; reason?: unknown };
    if (typeof arn === "string" && asked.has(arn) && reason === "MISSING") missing.add(arn);
  }
  // A task both described and reported missing is contradictory evidence: neither counts.
  return requested.filter(
    (arn) => (stopped.has(arn) && !missing.has(arn)) || (missing.has(arn) && !described.has(arn)),
  );
}
