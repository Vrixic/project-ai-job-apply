import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { nativeTaskDeploymentRegion } from "./native-task-allocation.js";

type Environment = Readonly<Record<string, string | undefined>>;
const unavailable = () => Error("NativeTaskBootstrapUnavailable");
type Deployment = Pick<
  NativeEvidenceBinding["allocation"],
  "clusterArn" | "taskDefinitionArn" | "containerName"
>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw unavailable();
  return value as Record<string, unknown>;
}

/** Reads the AWS-injected current-container and task endpoints, never a caller task ARN.
 * Metadata is not IAM authentication, ongoing admission, task death or provider settlement. */
export async function readNativeTaskBinding(options: {
  deployment: Deployment;
  environment: Environment;
  enabled?: () => boolean;
  testFetch?: typeof fetch;
}): Promise<Readonly<NativeEvidenceBinding>> {
  const enabled = options.enabled ?? (() => false);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let bytes: Uint8Array | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!enabled() || (options.testFetch && process.env.NODE_ENV !== "test")) throw unavailable();
    const testFetch = options.testFetch;
    const deployment = Object.freeze({ ...options.deployment });
    if (nativeTaskDeploymentRegion(deployment) !== "us-east-2") throw unavailable();
    const env = { ...options.environment };
    const scope = {
      allocationId: env.NATIVE_MATERIAL_ALLOCATION_ID,
      ownerUserId: env.NATIVE_MATERIAL_OWNER_USER_ID,
      applicationId: env.NATIVE_MATERIAL_APPLICATION_ID,
      generationId: env.NATIVE_MATERIAL_GENERATION_ID,
      epochId: env.NATIVE_MATERIAL_EPOCH_ID,
    };
    if (
      !Object.values(scope).every((id) => typeof id === "string" && uuid.test(id)) ||
      typeof env.NATIVE_MATERIAL_WORK_ID !== "string" ||
      !uuid.test(env.NATIVE_MATERIAL_WORK_ID) ||
      typeof env.NATIVE_MATERIAL_REQUEST_SHA256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(env.NATIVE_MATERIAL_REQUEST_SHA256)
    )
      throw unavailable();
    const uri = env.ECS_CONTAINER_METADATA_URI_V4;
    if (
      typeof uri !== "string" ||
      !/^http:\/\/169\.254\.170\.2\/v4\/[A-Za-z0-9_-]{1,128}$/u.test(uri)
    )
      throw unavailable();
    const fetcher = testFetch ?? globalThis.fetch;
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 3000);
    const permitted = () =>
      enabled() && !controller.signal.aborted && (!testFetch || process.env.NODE_ENV === "test");
    async function read(url: string) {
      if (!permitted()) throw unavailable();
      const response = await fetcher(url, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      if (
        !permitted() ||
        response.status !== 200 ||
        response.redirected ||
        !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "")
      )
        throw unavailable();
      reader = response.body?.getReader();
      if (!reader) throw unavailable();
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.value) {
          chunks.push(next.value);
          size += next.value.byteLength;
        }
        if (!permitted() || size > 65_536) throw unavailable();
        if (next.done) break;
        if (!next.value) throw unavailable();
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const result = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      await reader.cancel();
      reader.releaseLock();
      reader = undefined;
      bytes.fill(0);
      bytes = undefined;
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      if (!permitted()) throw unavailable();
      return result;
    }
    const self = await read(uri);
    if (
      self.Name !== deployment.containerName ||
      self.Type !== "NORMAL" ||
      typeof self.DockerId !== "string" ||
      !/^[a-f0-9]{32}-[0-9]{10}$/u.test(self.DockerId) ||
      self.DesiredStatus !== "RUNNING" ||
      self.KnownStatus !== "RUNNING" ||
      typeof self.ImageID !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(self.ImageID)
    )
      throw unavailable();
    const task = await read(`${uri}/task`);
    const definition = deployment.taskDefinitionArn.split("task-definition/")[1]?.split(":");
    if (
      task.Cluster !== deployment.clusterArn &&
      task.Cluster !== deployment.clusterArn.split("cluster/")[1]
    )
      throw unavailable();
    if (
      task.Family !== definition?.[0] ||
      task.Revision !== definition?.[1] ||
      task.LaunchType !== "FARGATE" ||
      task.DesiredStatus !== "RUNNING" ||
      task.KnownStatus !== "RUNNING" ||
      !Array.isArray(task.Containers) ||
      task.Containers.length > 8
    )
      throw unavailable();
    const normal = task.Containers.map(object).filter((c) => c.Type === "NORMAL");
    if (normal.length !== 1) throw unavailable();
    const current = normal[0];
    if (
      !current ||
      !["DockerId", "Name", "Type", "Image", "ImageID", "KnownStatus", "DesiredStatus"].every(
        (key) => current[key] === self[key],
      ) ||
      typeof task.TaskARN !== "string"
    )
      throw unavailable();
    const labels = object(self.Labels);
    if (
      labels["com.amazonaws.ecs.task-arn"] !== task.TaskARN ||
      labels["com.amazonaws.ecs.container-name"] !== deployment.containerName ||
      labels["com.amazonaws.ecs.cluster"] !== deployment.clusterArn ||
      labels["com.amazonaws.ecs.task-definition-family"] !== definition?.[0] ||
      labels["com.amazonaws.ecs.task-definition-version"] !== definition?.[1]
    )
      throw unavailable();
    const fixedScope = scope as NativeEvidenceBinding["scope"];
    const binding = nativeEvidenceBinding({
      scope: fixedScope,
      allocation: {
        allocationId: fixedScope.allocationId,
        ownerUserId: fixedScope.ownerUserId,
        applicationId: fixedScope.applicationId,
        generationId: fixedScope.generationId,
        ...deployment,
        taskArn: task.TaskARN,
      },
      original: {
        id: env.NATIVE_MATERIAL_WORK_ID,
        documentId: fixedScope.generationId,
        purpose: "provider_dispatch",
        requestSha256: env.NATIVE_MATERIAL_REQUEST_SHA256,
      },
    });
    if (!permitted()) throw unavailable();
    return binding;
  } catch {
    throw unavailable();
  } finally {
    if (timer) clearTimeout(timer);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
      } finally {
        reader.releaseLock();
      }
    }
    bytes?.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}
