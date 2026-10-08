import { createHash } from "node:crypto";
import {
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
  nativeTaskLaunchScope,
} from "@ai-job-apply/documents-service/native-task-launch-policy";

const unavailable = () => Error("NativeResumeTaskEventUnavailable");
/** Validate inert JSON before reading fields or serializing. No getter/toJSON execution. */
function inertJson(raw: unknown): asserts raw is Record<string, unknown> {
  let nodes = 0;
  let bytes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 4_096 || depth > 12) throw unavailable();
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value === "string") {
      bytes += new TextEncoder().encode(value).length;
      if (bytes > 65_536) throw unavailable();
      return;
    }
    if (!value || typeof value !== "object") throw unavailable();
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype))
      throw unavailable();
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) throw unavailable();
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || (array && !/^(0|[1-9][0-9]*)$/u.test(key)))
        throw unavailable();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw unavailable();
      bytes += new TextEncoder().encode(key).length;
      if (bytes > 65_536) throw unavailable();
      visit(descriptor.value, depth + 1);
    }
  };
  visit(raw, 0);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw unavailable();
  if (new TextEncoder().encode(JSON.stringify(raw)).length > 65_536) throw unavailable();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw unavailable();
}

/** Inert event hint only. Original SQL allocation and fresh ECS observation remain authority. */
export function nativeResumeStoppedTaskEvent(
  raw: unknown,
  configuration: NativeTaskLaunchConfiguration,
) {
  inertJson(raw);
  const config = nativeTaskLaunchConfiguration(configuration);
  only(raw, [
    "version",
    "id",
    "source",
    "detail-type",
    "account",
    "region",
    "time",
    "resources",
    "detail",
  ]);
  const detail = object(raw.detail);
  const taskArn = detail.taskArn;
  const prefix = `${config.clusterArn.replace(":cluster/", ":task/")}/`;
  if (
    raw.version !== "0" ||
    raw.source !== "aws.ecs" ||
    raw["detail-type"] !== "ECS Task State Change" ||
    raw.account !== config.clusterArn.split(":")[4] ||
    raw.region !== "us-east-2" ||
    typeof raw.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(raw.id) ||
    typeof raw.time !== "string" ||
    !Number.isFinite(Date.parse(raw.time)) ||
    typeof taskArn !== "string" ||
    !taskArn.startsWith(prefix) ||
    !/^[a-f0-9]{32}$/u.test(taskArn.slice(prefix.length)) ||
    !Array.isArray(raw.resources) ||
    raw.resources.length !== 1 ||
    raw.resources[0] !== taskArn ||
    detail.clusterArn !== config.clusterArn ||
    detail.taskDefinitionArn !== config.taskDefinitionArn ||
    detail.lastStatus !== "STOPPED" ||
    detail.launchType !== "FARGATE" ||
    detail.platformVersion !== "1.4.0" ||
    detail.enableExecuteCommand !== false
  )
    throw unavailable();
  const overrides = object(detail.overrides);
  only(overrides, ["containerOverrides"]);
  if (!Array.isArray(overrides.containerOverrides) || overrides.containerOverrides.length !== 1)
    throw unavailable();
  const container = object(overrides.containerOverrides[0]);
  only(container, ["name", "environment"]);
  if (
    container.name !== config.containerName ||
    !Array.isArray(container.environment) ||
    container.environment.length !== 6
  )
    throw unavailable();
  const values = new Map<string, string>();
  const names = [
    "ALLOCATION_ID",
    "OWNER_USER_ID",
    "APPLICATION_ID",
    "GENERATION_ID",
    "EPOCH_ID",
  ].map((key) => `NATIVE_MATERIAL_${key}`);
  names.push("NATIVE_RESUME_CONFIGURATION_SHA256");
  for (const value of container.environment) {
    const entry = object(value);
    only(entry, ["name", "value"]);
    if (
      typeof entry.name !== "string" ||
      typeof entry.value !== "string" ||
      !names.includes(entry.name) ||
      values.has(entry.name)
    )
      throw unavailable();
    values.set(entry.name, entry.value);
  }
  const hash = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...config }))
    .digest("hex");
  if (values.get("NATIVE_RESUME_CONFIGURATION_SHA256") !== hash) throw unavailable();
  const get = (key: string) => values.get(`NATIVE_MATERIAL_${key}`) as string;
  const scope = nativeTaskLaunchScope({
    allocationId: get("ALLOCATION_ID"),
    ownerUserId: get("OWNER_USER_ID"),
    applicationId: get("APPLICATION_ID"),
    generationId: get("GENERATION_ID"),
    epochId: get("EPOCH_ID"),
  });
  if (detail.startedBy !== undefined && detail.startedBy !== scope.allocationId)
    throw unavailable();
  return Object.freeze({ scope, taskArn });
}
