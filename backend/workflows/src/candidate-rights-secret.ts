import type { Auth0CandidateRevocationMode } from "./candidate-rights-auth0.js";

export interface CandidateRightsAuth0Secret {
  clientId: string;
  clientSecret: string;
  revocationMode: Auth0CandidateRevocationMode;
}

interface ExtensionSecretResponse {
  SecretString?: unknown;
}

type Sleep = (milliseconds: number) => Promise<void>;

const retryableStatuses = new Set([429, 500, 502, 503, 504]);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function exactSecret(value: unknown): CandidateRightsAuth0Secret {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "clientId,clientSecret,revocationMode" ||
    typeof record.clientId !== "string" ||
    record.clientId.length < 1 ||
    record.clientId.length > 256 ||
    typeof record.clientSecret !== "string" ||
    record.clientSecret.length < 16 ||
    record.clientSecret.length > 4096 ||
    !["delete_user_only", "revoke_sessions_refresh_tokens_then_delete"].includes(
      String(record.revocationMode),
    )
  ) {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
  return {
    clientId: record.clientId,
    clientSecret: record.clientSecret,
    revocationMode: record.revocationMode as Auth0CandidateRevocationMode,
  };
}

async function boundedJson(response: Response, maximumBytes = 16 * 1024): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)) {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
}

export async function resolveCandidateRightsAuth0Secret(
  secretId: string | undefined,
  options: {
    sessionToken?: string;
    fetchImplementation?: typeof fetch;
    requestTimeoutMilliseconds?: number;
    retryDelaysMilliseconds?: readonly number[];
    sleepImplementation?: Sleep;
  } = {},
): Promise<CandidateRightsAuth0Secret> {
  if (!secretId || !options.sessionToken) {
    throw new Error("CandidateRightsIdentitySecretContextUnavailable");
  }
  const endpoint = new URL("http://localhost:2773/secretsmanager/get");
  endpoint.searchParams.set("secretId", secretId);
  const fetchSecret = options.fetchImplementation ?? fetch;
  const retryDelays = options.retryDelaysMilliseconds ?? [100, 250];
  const wait = options.sleepImplementation ?? sleep;
  let response: Response | undefined;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      response = await fetchSecret(endpoint, {
        headers: { "X-Aws-Parameters-Secrets-Token": options.sessionToken },
        signal: AbortSignal.timeout(options.requestTimeoutMilliseconds ?? 3_000),
      });
    } catch {
      response = undefined;
    }
    if (response?.ok) break;
    if (response && !retryableStatuses.has(response.status)) {
      throw new Error("CandidateRightsIdentitySecretUnavailable");
    }
    const delay = retryDelays[attempt];
    if (delay === undefined) throw new Error("CandidateRightsIdentitySecretUnavailable");
    await wait(delay);
  }

  if (!response?.ok) throw new Error("CandidateRightsIdentitySecretUnavailable");
  const extension = await boundedJson(response);
  if (
    !extension ||
    typeof extension !== "object" ||
    Array.isArray(extension) ||
    typeof (extension as ExtensionSecretResponse).SecretString !== "string"
  ) {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
  let secret: unknown;
  try {
    secret = JSON.parse((extension as { SecretString: string }).SecretString) as unknown;
  } catch {
    throw new Error("CandidateRightsIdentitySecretInvalid");
  }
  return exactSecret(secret);
}
