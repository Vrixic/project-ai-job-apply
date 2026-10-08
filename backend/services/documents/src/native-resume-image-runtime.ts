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
    if (
      !nativeOwnerClosed(raw, [
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
        return {
          loadKernel,
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
