// Subpath imports on purpose: the resume image must not bundle the barrel, which carries the OpenAI provider.
import { BedrockConverseProvider, validBedrockModelId } from "@ai-job-apply/ai-sdk/bedrock";
import { ModelGateway } from "@ai-job-apply/ai-sdk/gateway";
import { createNativeBedrockConversePort } from "./native-bedrock-converse.js";
import { nativeImageTls } from "./native-image-tls.js";

export { nativeImageTls } from "./native-image-tls.js";

import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import type { KernelMemoryDeadline } from "./native-memory-session.js";
import type { NativeMemoryTransportOptions } from "./native-memory-transport.js";
import { nativeOwnerClosed, validNativePrincipalIssuer } from "./native-owner-rpc-contract.js";
import { createNativeResumeReadAuthorizationClient } from "./native-read-authorization-client.js";
import { createNativeResumeOwnerRpcClient } from "./native-resume-owner-rpc-client.js";
import { startNativeResumeTask } from "./native-resume-task-bootstrap.js";
import { nativeTaskDeploymentRegion } from "./native-task-allocation.js";
import {
  createNativeTaskSecretReader,
  type NativeSecretReference,
  validNativeSecretReference,
} from "./native-task-secrets.js";
import { createLiveTailor, LIVE_TAILORING_OUTPUT } from "./tailoring/live-tailor.js";

export interface NativeResumeImageConfiguration {
  schemaVersion: 1;
  enabled: boolean;
  deployment: { clusterArn: string; taskDefinitionArn: string; containerName: string };
  ownerFunctionArn: string;
  sourceFunctionArn: string;
  tlsSecret: NativeSecretReference;
  apiOrigin: string;
  issuer: string;
  audience: string;
  origin: string;
  baseHost: string;
  port: 8443;
  /** ADR-059. Absent keeps deterministic tailoring only. The model must be one the task role policy allows; the kill
   * switch is that policy (Terraform), so turning it off needs no new image. */
  liveGeneration?: { modelId: string };
}
const unavailable = () => Error("NativeResumeImageConfigurationUnavailable");
const origin = (raw: unknown) => {
  if (typeof raw !== "string" || raw.length > 512) return false;
  const url = new URL(raw);
  return url.protocol === "https:" && url.origin === raw && !url.username && !url.password;
};
export function validateNativeResumeImageConfiguration(
  raw: unknown,
): raw is NativeResumeImageConfiguration {
  try {
    const live =
      !!raw && typeof raw === "object" && Object.getOwnPropertyDescriptor(raw, "liveGeneration");
    if (
      !nativeOwnerClosed(raw, [
        ...(live ? ["liveGeneration"] : []),
        "schemaVersion",
        "enabled",
        "deployment",
        "ownerFunctionArn",
        "sourceFunctionArn",
        "tlsSecret",
        "apiOrigin",
        "issuer",
        "audience",
        "origin",
        "baseHost",
        "port",
      ]) ||
      raw.schemaVersion !== 1 ||
      typeof raw.enabled !== "boolean" ||
      raw.port !== 8443 ||
      !nativeOwnerClosed(raw.deployment, ["clusterArn", "taskDefinitionArn", "containerName"]) ||
      typeof raw.ownerFunctionArn !== "string" ||
      typeof raw.sourceFunctionArn !== "string"
    )
      return false;
    if (
      live &&
      (!nativeOwnerClosed(raw.liveGeneration, ["modelId"]) ||
        !validBedrockModelId(raw.liveGeneration.modelId))
    )
      return false;
    const deployment = raw.deployment as NativeResumeImageConfiguration["deployment"];
    if (nativeTaskDeploymentRegion(deployment) !== "us-east-2") return false;
    nativeLaunchControlVersion(raw.ownerFunctionArn);
    nativeLaunchControlVersion(raw.sourceFunctionArn);
    const account = deployment.clusterArn.split(":")[4] ?? "";
    return (
      raw.ownerFunctionArn.split(":")[4] === account &&
      raw.sourceFunctionArn.split(":")[4] === account &&
      raw.sourceFunctionArn !== raw.ownerFunctionArn &&
      validNativeSecretReference(raw.tlsSecret, account) &&
      origin(raw.apiOrigin) &&
      origin(raw.origin) &&
      validNativePrincipalIssuer(raw.issuer) &&
      typeof raw.audience === "string" &&
      /^[\x21-\x7e]{1,512}$/u.test(raw.audience) &&
      typeof raw.baseHost === "string" &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(raw.baseHost) &&
      raw.baseHost.length <= 200
    );
  } catch {
    return false;
  }
}

/** The model path of D3.2-003: Bedrock Converse on the task role through the model gateway, answering only with bullet ids.
 * The gateway timeout is short on purpose: the task has a fixed boot budget, so a slow model must fall back to the
 * deterministic tailor rather than outlast it. */
export function composeNativeLiveTailor(options: {
  modelId: string;
  accountId: string;
  enabled: () => boolean;
  testBedrockClient?: Parameters<typeof createNativeBedrockConversePort>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeBedrockConversePort>[0]["testCredentials"];
}) {
  const port = createNativeBedrockConversePort({
    accountId: options.accountId,
    enabled: options.enabled,
    ...(options.testBedrockClient ? { testClient: options.testBedrockClient } : {}),
    ...(options.testCredentials ? { testCredentials: options.testCredentials } : {}),
  });
  const provider = new BedrockConverseProvider({
    modelId: options.modelId,
    enabled: options.enabled,
    port,
    output: LIVE_TAILORING_OUTPUT,
    maxOutputTokens: 2_048,
  });
  const gateway = new ModelGateway(provider, {
    enabled: options.enabled,
    timeoutMs: 12_000,
    maxInputChars: 60_000,
    maxOutputChars: 8_000,
  });
  return { liveTailor: createLiveTailor({ gateway }), destroy: () => port.destroy() };
}

/** Image-owned composition, no candidate parameters or secret values in configuration. Actual
 * Secrets Manager/source RPC/Gateway clients; activation/IAM/TLS routing remain managed release gates. */
export async function startNativeResumeImage(options: {
  configuration: NativeResumeImageConfiguration;
  loadKernel(): KernelMemoryDeadline;
  testSecretClient?: Parameters<typeof createNativeTaskSecretReader>[0]["testClient"];
  testRpcClient?: Parameters<typeof createNativeResumeOwnerRpcClient>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeResumeOwnerRpcClient>[0]["testCredentials"];
  testMetadataFetch?: typeof fetch;
  testAuthorizationFetch?: typeof fetch;
  testBedrockClient?: Parameters<typeof composeNativeLiveTailor>[0]["testBedrockClient"];
  testVerifier?: NativeMemoryTransportOptions["testVerifier"];
  maximumLifetimeMs?: number;
}) {
  try {
    if (
      !validateNativeResumeImageConfiguration(options.configuration) ||
      !options.configuration.enabled ||
      ((options.testSecretClient ||
        options.testRpcClient ||
        options.testCredentials ||
        options.testMetadataFetch ||
        options.testAuthorizationFetch ||
        options.testBedrockClient ||
        options.testVerifier) &&
        process.env.NODE_ENV !== "test")
    )
      throw unavailable();
    const config = structuredClone(options.configuration);
    const loadKernel = options.loadKernel;
    const enabled = () => config.enabled;
    const injection = {
      ...(options.testCredentials ? { testCredentials: { ...options.testCredentials } } : {}),
    };
    const secretClient = options.testSecretClient;
    const rpcClient = options.testRpcClient;
    const authorizeFetch = options.testAuthorizationFetch;
    const verifier = options.testVerifier;
    return await startNativeResumeTask({
      deployment: config.deployment,
      ownerFunctionArn: config.ownerFunctionArn,
      sourceFunctionArn: config.sourceFunctionArn,
      enabled,
      loadPorts: async ({ binding }) => {
        const rpc = createNativeResumeOwnerRpcClient({
          binding,
          targetArn: config.ownerFunctionArn,
          enabled,
          ...injection,
          ...(rpcClient ? { testClient: rpcClient } : {}),
        });
        const principal = await rpc.principal(config.issuer);
        const accountId = config.deployment.clusterArn.split(":")[4] ?? "";
        const tlsValue = await createNativeTaskSecretReader({
          reference: config.tlsSecret,
          accountId,
          enabled,
          ...injection,
          ...(secretClient ? { testClient: secretClient } : {}),
        })();
        const host = `${binding.scope.allocationId}.${config.baseHost}`;
        const tls = nativeImageTls(tlsValue, host);
        const live = config.liveGeneration
          ? composeNativeLiveTailor({
              modelId: config.liveGeneration.modelId,
              accountId,
              enabled,
              ...(options.testBedrockClient
                ? { testBedrockClient: options.testBedrockClient }
                : {}),
              ...(options.testCredentials
                ? { testCredentials: { ...options.testCredentials } }
                : {}),
            })
          : undefined;
        return {
          loadKernel,
          ...(live ? { liveTailor: live.liveTailor } : {}),
          transport: {
            identity: { ...principal, audience: config.audience },
            host: `${host}:${config.port}`,
            origin: config.origin,
            tls,
            authorize: createNativeResumeReadAuthorizationClient({
              apiOrigin: config.apiOrigin,
              enabled,
              ...(authorizeFetch ? { fetch: authorizeFetch } : {}),
            }),
            ...(verifier ? { testVerifier: verifier } : {}),
          },
        };
      },
      ...injection,
      ...(rpcClient ? { testClient: rpcClient } : {}),
      ...(options.testMetadataFetch ? { testFetch: options.testMetadataFetch } : {}),
      ...(options.maximumLifetimeMs === undefined
        ? {}
        : { maximumLifetimeMs: options.maximumLifetimeMs }),
    });
  } catch {
    throw unavailable();
  }
}
