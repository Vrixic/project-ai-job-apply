import { randomBytes } from "node:crypto";
import {
  type ApplicationStoreOptions,
  createApplicationsDatabase,
  defaultFieldDefinitions,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { restrictedPacketWriterFromEnvironment } from "@ai-job-apply/applications-service/restricted-packet-runtime";
import { createNativeCoverLetterPersistence } from "@ai-job-apply/documents-service/cover-letter-runtime";
import { createNativeLaunchControlClient } from "@ai-job-apply/documents-service/native-launch-control";
import { createJobCatalogDatabase, PostgresJobCatalog } from "@ai-job-apply/jobs-service";
import {
  createDatabase,
  PostgresProfileStore,
  PostgresRestrictedAnswerVaultStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import { createApplicationPreparationActivityHandler } from "./application-preparation-activity.js";
import {
  type ApplicationPreparationActivityResult,
  validateApplicationPreparationActivityInput,
} from "./application-preparation-contract.js";
import { createNativeCoverLetterPreparationPort } from "./application-preparation-native.js";
import { createNativePreparationRouteActivity } from "./native-preparation-route-activity.js";
import {
  type NativePreparationRouteOutput,
  validateNativePreparationRouteInput,
  validateNativePreparationRouteOutput,
} from "./native-preparation-route-contract.js";

type Environment = Readonly<Record<string, string | undefined>>;
export interface NativePreparationConfiguration {
  target: string;
  secretId: string;
  launcher: string;
  routing?: true;
  packet: { encryptionKeyArn: string; fingerprintKeyArn: string; historicalKeysJson?: string };
}
function configuration(env: Environment): NativePreparationConfiguration | undefined {
  if (
    env.NATIVE_APPLICATION_PREPARATION_ENABLED !== "true" ||
    (env.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED !== undefined &&
      !["true", "false"].includes(env.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED)) ||
    env.AWS_REGION !== "us-east-2" ||
    !/^[0-9]{12}$/u.test(env.PLATFORM_AWS_ACCOUNT_ID ?? "") ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(env.AWS_LAMBDA_FUNCTION_NAME ?? "") ||
    !env.AWS_SESSION_TOKEN ||
    [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "OPENAI_API_KEY_SECRET_ID",
      "COVER_LETTER_OPENAI_SECRET_ID",
      "COVER_LETTER_PROVIDER_FUNCTION_ARN",
      "CANDIDATE_DOCUMENT_BUCKET",
      "PLATFORM_KMS_KEY_ARN",
    ].some((key) => env[key] !== undefined) ||
    (env.NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED !== undefined &&
      !["true", "false"].includes(env.NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED))
  )
    return;
  const prefix = `arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:`;
  const target = `${prefix}${env.AWS_LAMBDA_FUNCTION_NAME}:${env.AWS_LAMBDA_FUNCTION_VERSION}`;
  const launcher = env.NATIVE_MATERIAL_LAUNCH_FUNCTION_ARN;
  const numeric = new RegExp(
    `^arn:aws:lambda:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,8}$`,
    "u",
  );
  const secretId = env.DATABASE_SECRET_ID;
  if (
    !numeric.test(target) ||
    !launcher ||
    !numeric.test(launcher) ||
    target.slice(0, target.lastIndexOf(":")) === launcher.slice(0, launcher.lastIndexOf(":")) ||
    !secretId ||
    !new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(secretId)
  )
    return;
  if (env.RESTRICTED_PACKET_PROTECTION_ENABLED !== "true") return;
  const encryptionKeyArn = env.RESTRICTED_PACKET_ENCRYPTION_KEY_ARN,
    fingerprintKeyArn = env.RESTRICTED_PACKET_FINGERPRINT_KEY_ARN;
  const key = new RegExp(
    `^arn:aws:kms:us-east-2:${env.PLATFORM_AWS_ACCOUNT_ID}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`,
    "u",
  );
  if (
    !encryptionKeyArn ||
    !fingerprintKeyArn ||
    !key.test(encryptionKeyArn) ||
    !key.test(fingerprintKeyArn)
  )
    return;
  // Existing strict key-ring validation is pure; credentials and KMS I/O remain lazy.
  if (!restrictedPacketWriterFromEnvironment({ ...env })) return;
  return {
    target,
    secretId,
    launcher,
    ...(env.NATIVE_APPLICATION_PREPARATION_ROUTE_ENABLED === "true"
      ? { routing: true as const }
      : {}),
    packet: {
      encryptionKeyArn,
      fingerprintKeyArn,
      ...(env.RESTRICTED_PACKET_HISTORICAL_KEYS_JSON !== undefined
        ? { historicalKeysJson: env.RESTRICTED_PACKET_HISTORICAL_KEYS_JSON }
        : {}),
    },
  };
}
type Runtime = {
  runRoute?: ReturnType<typeof createNativePreparationRouteActivity>;
  run: ReturnType<typeof createApplicationPreparationActivityHandler>;
  close(): Promise<void>;
};

/** Native Date/JSON owning pools; no S3, model, rendering, completion or ECS client capability. */
export function createNativeApplicationPreparationRuntime(
  url: string,
  config: NativePreparationConfiguration,
  enabled: () => boolean,
  launchEnabled: () => boolean,
  testOptions: {
    packetProtection?: NonNullable<ApplicationStoreOptions["restrictedPackets"]>;
  } = {},
): Runtime {
  if (testOptions.packetProtection && process.env.NODE_ENV !== "test")
    throw Error("NativePreparationTestOverrideRejected");
  const packetProtection =
    testOptions.packetProtection ??
    restrictedPacketWriterFromEnvironment({
      RESTRICTED_PACKET_PROTECTION_ENABLED: "true",
      RESTRICTED_PACKET_ENCRYPTION_KEY_ARN: config.packet.encryptionKeyArn,
      RESTRICTED_PACKET_FINGERPRINT_KEY_ARN: config.packet.fingerprintKeyArn,
      ...(config.packet.historicalKeysJson !== undefined
        ? { RESTRICTED_PACKET_HISTORICAL_KEYS_JSON: config.packet.historicalKeysJson }
        : {}),
    });
  if (!packetProtection) throw Error("NativePreparationPacketProtectionUnavailable");
  const persistence = createNativeCoverLetterPersistence(url, enabled);
  const applicationsPool = createApplicationsDatabase(url, { maxConnections: 1 });
  const profilePool = createDatabase(url, { maxConnections: 1 });
  const jobsPool = createJobCatalogDatabase(url, { maxConnections: 1 });
  const vault = new PostgresRestrictedAnswerVaultStore(profilePool.client, undefined);
  const applications = new PostgresApplicationStore(applicationsPool, undefined, {
    definitions: defaultFieldDefinitions(),
    lockVaultReferences: vault.lockCurrentReferences.bind(vault),
    restrictedPackets: {
      ...packetProtection,
      enabled: () => enabled() && packetProtection.enabled(),
    },
  });
  const profile = new PostgresProfileStore(profilePool);
  const catalog = new PostgresJobCatalog(jobsPool, {
    searchCursorKeys: { active: { id: "native-preparation-unused", key: randomBytes(32) } },
  });
  const port = createNativeCoverLetterPreparationPort({
    owners: { applications, profile, catalog },
    ...persistence,
    enabled,
    launchEnabled,
    launcher: createNativeLaunchControlClient({
      functionArn: config.launcher,
      enabled,
      launchEnabled,
    }),
  });
  return {
    ...(config.routing
      ? {
          runRoute: createNativePreparationRouteActivity({
            store: applications,
            documents: port,
            ready: persistence.ready,
            vault: { readCurrentReference: vault.readCurrentReference.bind(vault) },
            enabled,
          }),
        }
      : {}),
    run: createApplicationPreparationActivityHandler(
      applications,
      port,
      Object.freeze({ readCurrentReference: vault.readCurrentReference.bind(vault) }),
    ),
    close: async () => {
      await Promise.all([
        persistence.close(),
        applicationsPool.end(),
        profilePool.client.end(),
        jobsPool.end(),
      ]);
    },
  };
}

/** Dedicated default-off numeric private activity. Version equality is not sender authentication;
 * reviewed caller IAM remains mandatory. No legacy preparation fallback is present. */
export function createNativeApplicationPreparationLambda(
  options: {
    environment?: () => Environment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createRuntime?: typeof createNativeApplicationPreparationRuntime;
  } = {},
) {
  const environment = options.environment ?? (() => process.env);
  const resolve = options.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const createRuntime = options.createRuntime ?? createNativeApplicationPreparationRuntime;
  let pinned: NativePreparationConfiguration | undefined,
    initialization: Promise<Runtime> | undefined;
  const enabled = () => {
    try {
      const current = configuration(environment());
      return current !== undefined && JSON.stringify(current) === JSON.stringify(pinned);
    } catch {
      return false;
    }
  };
  const launchEnabled = () =>
    enabled() && environment().NATIVE_APPLICATION_PREPARATION_LAUNCH_ENABLED === "true";
  return async (
    raw: unknown,
    context: { invokedFunctionArn: string },
  ): Promise<ApplicationPreparationActivityResult | NativePreparationRouteOutput> => {
    const routed = validateNativePreparationRouteInput(raw);
    if (!routed && !validateApplicationPreparationActivityInput(raw))
      throw Error("ApplicationPreparationActivityInputRejected");
    const input = structuredClone(raw);
    const unavailable: ApplicationPreparationActivityResult | NativePreparationRouteOutput =
      validateNativePreparationRouteInput(input)
        ? { schemaVersion: 1, request: input, outcome: "pending", original: null }
        : {
            schemaVersion: 1,
            action: input.action,
            preparationId: input.preparationId,
            outcome: "retryable_failure",
            errorCode: "store_unavailable",
          };
    try {
      const env = environment(),
        config = configuration(env);
      if (
        !config ||
        context?.invokedFunctionArn !== config.target ||
        (pinned && !enabled()) ||
        (routed && !config.routing) ||
        (!routed && config.routing && input.action === "advance")
      )
        return unavailable;
      if (!initialization) {
        pinned = config;
        const sessionToken = env.AWS_SESSION_TOKEN;
        if (!sessionToken) return unavailable;
        initialization = (async () => {
          const url = await resolve(
            { DATABASE_SECRET_ID: config.secretId },
            { sessionToken, requestTimeoutMilliseconds: 3000, retryDelaysMilliseconds: [] },
          );
          if (!enabled()) throw Error();
          return createRuntime(url, config, enabled, launchEnabled);
        })();
      }
      const startup = initialization;
      let runtime: Runtime;
      try {
        runtime = await startup;
      } catch {
        if (initialization === startup) initialization = undefined;
        return unavailable;
      }
      if (!enabled()) return unavailable;
      if (validateNativePreparationRouteInput(input)) {
        if (!config.routing || !runtime.runRoute) return unavailable;
        const result = await runtime.runRoute(input);
        return enabled() &&
          validateNativePreparationRouteOutput(result) &&
          JSON.stringify(result.request) === JSON.stringify(input)
          ? result
          : unavailable;
      }
      if (config.routing && input.action === "advance") return unavailable;
      const result = await runtime.run(input);
      return enabled() ? result : unavailable;
    } catch {
      return unavailable;
    }
  };
}
export const handler = createNativeApplicationPreparationLambda();
