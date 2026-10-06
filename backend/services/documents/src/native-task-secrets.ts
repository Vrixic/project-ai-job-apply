import {
  GetSecretValueCommand,
  type GetSecretValueCommandOutput,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { nativeOwnerClosed } from "./native-owner-rpc-contract.js";
import { nativeTaskCredentials } from "./native-task-credentials.js";

const unavailable = () => Error("NativeImageConfigurationUnavailable");
export interface NativeSecretReference {
  arn: string;
  versionId: string;
}
export function validNativeSecretReference(
  value: unknown,
  accountId: string,
): value is NativeSecretReference {
  if (!/^[0-9]{12}$/u.test(accountId) || !nativeOwnerClosed(value, ["arn", "versionId"]))
    return false;
  const ref = value;
  return (
    typeof ref.arn === "string" &&
    new RegExp(
      `^arn:aws:secretsmanager:us-east-2:${accountId}:secret:[A-Za-z0-9/_+=.@-]{1,512}$`,
      "u",
    ).test(ref.arn) &&
    typeof ref.versionId === "string" &&
    /^[A-Za-z0-9-]{32,64}$/u.test(ref.versionId)
  );
}
/** Exact reviewed secret version, one attempt, explicit ECS credentials. No writes, latest
 * stage, environment key, workstation profile, retry, logging or Lambda-extension fallback. */
export function createNativeTaskSecretReader(options: {
  reference: NativeSecretReference;
  accountId: string;
  enabled?: () => boolean;
  testClient?: {
    send(
      command: GetSecretValueCommand,
      options: { abortSignal: AbortSignal },
    ): Promise<GetSecretValueCommandOutput>;
  };
  testCredentials?: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
}) {
  const ref = { ...options.reference };
  const account = options.accountId;
  const enabled = options.enabled ?? (() => false);
  const injected = options.testClient;
  const credentials = options.testCredentials ? { ...options.testCredentials } : undefined;
  if (
    !validNativeSecretReference(ref, account) ||
    ((injected || credentials) && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  let consumed = false;
  return async () => {
    if (consumed || !enabled() || ((injected || credentials) && process.env.NODE_ENV !== "test"))
      throw unavailable();
    consumed = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const sdk = injected
      ? undefined
      : new SecretsManagerClient({
          region: "us-east-2",
          endpoint: "https://secretsmanager.us-east-2.amazonaws.com",
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          credentials:
            credentials ??
            nativeTaskCredentials({
              relativeUri: process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
              accountId: account,
              enabled,
            }),
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
    try {
      const client = injected ?? sdk;
      if (!client) throw unavailable();
      const result = await client.send(
        new GetSecretValueCommand({ SecretId: ref.arn, VersionId: ref.versionId }),
        { abortSignal: controller.signal },
      );
      if (
        !enabled() ||
        controller.signal.aborted ||
        ((injected || credentials) && process.env.NODE_ENV !== "test") ||
        result.ARN !== ref.arn ||
        result.VersionId !== ref.versionId ||
        result.SecretBinary !== undefined ||
        typeof result.SecretString !== "string" ||
        Buffer.byteLength(result.SecretString) < 1 ||
        Buffer.byteLength(result.SecretString) > 65_536
      )
        throw unavailable();
      return result.SecretString;
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
      sdk?.destroy();
    }
  };
}
