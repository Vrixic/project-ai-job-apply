import { nativeImageTls } from "./native-image-tls.js";

export { nativeImageTls } from "./native-image-tls.js";

import { OpenAiLunaProvider } from "@ai-job-apply/ai-sdk";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import type { KernelMemoryDeadline } from "./native-memory-session.js";
import type { NativeMemoryTransportOptions } from "./native-memory-transport.js";
import { createNativeOwnerRpcClient } from "./native-owner-rpc-client.js";
import { nativeOwnerClosed, validNativePrincipalIssuer } from "./native-owner-rpc-contract.js";
import { createNativeReadAuthorizationClient } from "./native-read-authorization-client.js";
import { nativeTaskDeploymentRegion } from "./native-task-allocation.js";
import { startNativeMaterialTask } from "./native-task-bootstrap.js";
import {
  createNativeTaskSecretReader,
  type NativeSecretReference,
  validNativeSecretReference,
} from "./native-task-secrets.js";

export interface NativeImageConfiguration {
  schemaVersion: 1;
  enabled: boolean;
  providerEnabled: boolean;
  deployment: { clusterArn: string; taskDefinitionArn: string; containerName: string };
  ownerFunctionArn: string;
  providerSecret: NativeSecretReference;
  tlsSecret: NativeSecretReference;
  apiOrigin: string;
  issuer: string;
  audience: string;
  origin: string;
  baseHost: string;
  port: 8443;
}
const unavailable = () => Error("NativeImageConfigurationUnavailable");
const origin = (raw: unknown) => {
  if (typeof raw !== "string" || raw.length > 512) return false;
  const url = new URL(raw);
  return url.protocol === "https:" && url.origin === raw && !url.username && !url.password;
};
export function validateNativeImageConfiguration(raw: unknown): raw is NativeImageConfiguration {
  try {
    if (
      !nativeOwnerClosed(raw, [
        "schemaVersion",
        "enabled",
        "providerEnabled",
        "deployment",
        "ownerFunctionArn",
        "providerSecret",
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
      typeof raw.providerEnabled !== "boolean" ||
      raw.port !== 8443 ||
      !nativeOwnerClosed(raw.deployment, ["clusterArn", "taskDefinitionArn", "containerName"]) ||
      typeof raw.ownerFunctionArn !== "string"
    )
      return false;
    const deployment = raw.deployment as NativeImageConfiguration["deployment"];
    if (nativeTaskDeploymentRegion(deployment) !== "us-east-2") return false;
    nativeLaunchControlVersion(raw.ownerFunctionArn);
    const account = deployment.clusterArn.split(":")[4] ?? "";
    return (
      raw.ownerFunctionArn.split(":")[4] === account &&
      validNativeSecretReference(raw.providerSecret, account) &&
      validNativeSecretReference(raw.tlsSecret, account) &&
      raw.providerSecret.arn !== raw.tlsSecret.arn &&
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

/** Image-owned composition, no candidate parameters or secret values in configuration. Actual
 * Secrets Manager/OpenAI/Gateway clients; activation/IAM/TLS routing remain managed release gates. */
export async function startNativeImage(options: {
  configuration: NativeImageConfiguration;
  loadKernel(): KernelMemoryDeadline;
  testSecretClient?: Parameters<typeof createNativeTaskSecretReader>[0]["testClient"];
  testRpcClient?: Parameters<typeof createNativeOwnerRpcClient>[0]["testClient"];
  testCredentials?: Parameters<typeof createNativeOwnerRpcClient>[0]["testCredentials"];
  testMetadataFetch?: typeof fetch;
  testModelFetch?: typeof fetch;
  testAuthorizationFetch?: typeof fetch;
  testVerifier?: NativeMemoryTransportOptions["testVerifier"];
  maximumLifetimeMs?: number;
}) {
  try {
    if (
      !validateNativeImageConfiguration(options.configuration) ||
      !options.configuration.enabled ||
      !options.configuration.providerEnabled ||
      ((options.testSecretClient ||
        options.testRpcClient ||
        options.testCredentials ||
        options.testMetadataFetch ||
        options.testModelFetch ||
        options.testAuthorizationFetch ||
        options.testVerifier) &&
        process.env.NODE_ENV !== "test")
    )
      throw unavailable();
    const config = structuredClone(options.configuration);
    const loadKernel = options.loadKernel;
    const enabled = () => config.enabled && config.providerEnabled;
    const injection = {
      ...(options.testCredentials ? { testCredentials: { ...options.testCredentials } } : {}),
    };
    const secretClient = options.testSecretClient;
    const rpcClient = options.testRpcClient;
    const modelFetch = options.testModelFetch;
    const authorizeFetch = options.testAuthorizationFetch;
    const verifier = options.testVerifier;
    return await startNativeMaterialTask({
      deployment: config.deployment,
      ownerFunctionArn: config.ownerFunctionArn,
      enabled,
      loadPorts: async ({ binding }) => {
        const rpc = createNativeOwnerRpcClient({
          binding,
          targetArn: config.ownerFunctionArn,
          enabled,
          ...injection,
          ...(rpcClient ? { testClient: rpcClient } : {}),
        });
        const principal = await rpc.principal(config.issuer);
        const accountId = config.deployment.clusterArn.split(":")[4] ?? "";
        const secrets = await Promise.allSettled(
          [config.providerSecret, config.tlsSecret].map((reference) =>
            createNativeTaskSecretReader({
              reference,
              accountId,
              enabled,
              ...injection,
              ...(secretClient ? { testClient: secretClient } : {}),
            })(),
          ),
        );
        const provider = secrets[0],
          tlsValue = secrets[1];
        if (
          provider?.status !== "fulfilled" ||
          tlsValue?.status !== "fulfilled" ||
          !/^[\x21-\x7e]{16,512}$/u.test(provider.value)
        )
          throw unavailable();
        const host = `${binding.scope.allocationId}.${config.baseHost}`;
        const tls = nativeImageTls(tlsValue.value, host);
        return {
          provider: new OpenAiLunaProvider({
            enabled,
            apiKey: () => provider.value,
            ...(modelFetch ? { fetch: modelFetch } : {}),
          }),
          loadKernel,
          transport: {
            identity: { ...principal, audience: config.audience },
            host: `${host}:${config.port}`,
            origin: config.origin,
            tls,
            authorize: createNativeReadAuthorizationClient({
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
