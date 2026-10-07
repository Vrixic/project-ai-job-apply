import {
  createNativeLaunchControlClient,
  type NativeLaunchControlInput,
  nativeLaunchControlVersion,
  validateNativeLaunchControlInput,
} from "@ai-job-apply/documents-service/native-launch-control";
import { nativeTaskDeploymentRegion } from "@ai-job-apply/documents-service/native-task-allocation";

type RecoveryInput = Extract<NativeLaunchControlInput, { action: "recover" }>;
interface Configuration {
  functionArn: string;
  clusterArn: string;
  taskDefinitionArn: string;
  containerName: string;
}
type Environment = Readonly<Record<string, string | undefined>>;
const unavailable = () => Error("NativeMaterialTaskEventUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const nativeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

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
function fixedConfiguration(raw: Configuration): Readonly<Configuration> {
  inertJson(raw);
  only(raw, ["functionArn", "clusterArn", "taskDefinitionArn", "containerName"]);
  nativeLaunchControlVersion(raw.functionArn);
  if (
    nativeTaskDeploymentRegion(raw) !== "us-east-2" ||
    raw.functionArn.split(":")[4] !== raw.clusterArn.split(":")[4]
  )
    throw unavailable();
  return Object.freeze({ ...raw });
}

/** Event fields are hints, never terminal proof or permission to launch. The receiver must
 * independently read the original SQL claim and positively DescribeTasks before capture. */
function recovery(raw: unknown, config: Configuration): { eventId: string; input: RecoveryInput } {
  inertJson(raw);
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
    !uuid.test(raw.id) ||
    typeof raw.time !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u.test(raw.time) ||
    !Number.isFinite(Date.parse(raw.time)) ||
    typeof taskArn !== "string" ||
    !taskArn.startsWith(prefix) ||
    !/^[a-f0-9]{32}$/u.test(taskArn.slice(prefix.length)) ||
    !Array.isArray(raw.resources) ||
    raw.resources.length !== 1 ||
    raw.resources[0] !== taskArn ||
    detail.clusterArn !== config.clusterArn ||
    detail.taskDefinitionArn !== config.taskDefinitionArn ||
    detail.launchType !== "FARGATE" ||
    detail.platformVersion !== "1.4.0" ||
    detail.enableExecuteCommand !== false ||
    !Number.isSafeInteger(detail.version) ||
    (detail.version as number) < 1 ||
    ![
      "PROVISIONING",
      "PENDING",
      "ACTIVATING",
      "RUNNING",
      "DEACTIVATING",
      "STOPPING",
      "DEPROVISIONING",
      "STOPPED",
    ].includes(String(detail.lastStatus))
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
    container.environment.length !== 7
  )
    throw unavailable();
  const names = [
    "ALLOCATION_ID",
    "OWNER_USER_ID",
    "APPLICATION_ID",
    "GENERATION_ID",
    "EPOCH_ID",
    "WORK_ID",
    "REQUEST_SHA256",
  ];
  const values = new Map<string, string>();
  for (const value of container.environment) {
    const entry = object(value);
    only(entry, ["name", "value"]);
    if (
      typeof entry.name !== "string" ||
      typeof entry.value !== "string" ||
      values.has(entry.name) ||
      !names.some((name) => entry.name === `NATIVE_MATERIAL_${name}`)
    )
      throw unavailable();
    const pattern = entry.name.endsWith("REQUEST_SHA256") ? /^[a-f0-9]{64}$/u : nativeUuid;
    if (!pattern.test(entry.value)) throw unavailable();
    values.set(entry.name, entry.value);
  }
  const get = (name: string) => values.get(`NATIVE_MATERIAL_${name}`) as string;
  if (detail.startedBy !== undefined && detail.startedBy !== get("ALLOCATION_ID"))
    throw unavailable();
  const input: RecoveryInput = {
    schemaVersion: 1,
    action: "recover",
    taskArn,
    scope: {
      allocationId: get("ALLOCATION_ID"),
      ownerUserId: get("OWNER_USER_ID"),
      applicationId: get("APPLICATION_ID"),
      generationId: get("GENERATION_ID"),
      epochId: get("EPOCH_ID"),
    },
  };
  if (!validateNativeLaunchControlInput(input)) throw unavailable();
  return { eventId: raw.id, input };
}

export function createNativeMaterialTaskEventHandler(options: {
  configuration: Configuration;
  enabled?: () => boolean;
  testClient?: Parameters<typeof createNativeLaunchControlClient>[0]["testClient"];
}) {
  const config = fixedConfiguration(options.configuration);
  const enabled = options.enabled ?? (() => false);
  const client = createNativeLaunchControlClient({
    functionArn: config.functionArn,
    enabled,
    ...(options.testClient ? { testClient: options.testClient } : {}),
  });
  return async (raw: unknown) => {
    try {
      const { eventId, input } = recovery(raw, config);
      if (!enabled()) throw unavailable();
      const capture = await client.recover(input);
      if (
        !enabled() ||
        capture.allocation.clusterArn !== config.clusterArn ||
        capture.allocation.taskDefinitionArn !== config.taskDefinitionArn ||
        capture.allocation.containerName !== config.containerName
      )
        throw unavailable();
      return {
        schemaVersion: 1 as const,
        outcome: "captured" as const,
        eventId,
        allocationId: input.scope.allocationId,
        taskArn: input.taskArn,
      };
    } catch {
      throw unavailable();
    }
  };
}

/** Numeric target equality does not authenticate the caller. EventBridge/Lambda resource
 * policies, original-version routing, DLQ/retry retention and managed acceptance are gates. */
export function createNativeMaterialTaskEventLambda(
  options: {
    environment?: () => Environment;
    testClient?: Parameters<typeof createNativeLaunchControlClient>[0]["testClient"];
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  let pinned: string | undefined;
  let receiver: ReturnType<typeof createNativeMaterialTaskEventHandler> | undefined;
  const configuration = () => {
    const env = environment();
    if (
      env.NATIVE_MATERIAL_TASK_EVENT_RECOVERY_ENABLED !== "true" ||
      env.AWS_REGION !== "us-east-2" ||
      !env.AWS_SESSION_TOKEN ||
      !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "")
    )
      throw unavailable();
    if (
      [
        "DATABASE_URL",
        "DATABASE_SECRET_ID",
        "OPENAI_API_KEY",
        "OPENAI_API_KEY_SECRET_ID",
        "COVER_LETTER_OPENAI_SECRET_ID",
      ].some((key) => env[key] !== undefined)
    )
      throw unavailable();
    const target = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
    nativeLaunchControlVersion(target);
    const json = env.NATIVE_MATERIAL_TASK_EVENT_CONFIGURATION_JSON;
    if (!json || new TextEncoder().encode(json).length > 2_048) throw unavailable();
    const fixed = fixedConfiguration(JSON.parse(json) as Configuration);
    if (
      fixed.functionArn.split(":")[4] !== env.PLATFORM_AWS_ACCOUNT_ID ||
      fixed.functionArn.split(":")[6] === env.AWS_LAMBDA_FUNCTION_NAME
    )
      throw unavailable();
    return { target, fixed };
  };
  const enabled = () => {
    try {
      return JSON.stringify(configuration()) === pinned;
    } catch {
      return false;
    }
  };
  return async (raw: unknown, context: { invokedFunctionArn: string }) => {
    try {
      const config = configuration();
      if (
        context?.invokedFunctionArn !== config.target ||
        (pinned && JSON.stringify(config) !== pinned)
      )
        throw unavailable();
      // Validate the event before pinning or constructing any signed transport.
      recovery(raw, config.fixed);
      if (!receiver) {
        pinned = JSON.stringify(config);
        receiver = createNativeMaterialTaskEventHandler({
          configuration: config.fixed,
          enabled,
          ...(options.testClient ? { testClient: options.testClient } : {}),
        });
      }
      return await receiver(raw);
    } catch {
      throw unavailable();
    }
  };
}
export const handler = createNativeMaterialTaskEventLambda();
