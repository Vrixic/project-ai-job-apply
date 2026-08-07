interface SecretExtensionResponse {
  SecretString?: unknown;
}

const defaultRequestTimeoutMilliseconds = 3_000;
const defaultRetryDelaysMilliseconds = [100, 250] as const;
const retryableStatuses = new Set([429, 500, 502, 503, 504]);

type Sleep = (milliseconds: number) => Promise<void>;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("The managed database secret is not a PostgreSQL URL");
  }
  return value;
}

/** Resolves the profile-owned database URL without exposing the secret to logs or configuration. */
export async function resolveLambdaDatabaseUrl(
  config: {
    DATABASE_URL?: string | undefined;
    DATABASE_SECRET_ID?: string | undefined;
  },
  options: {
    sessionToken?: string;
    fetchImplementation?: typeof fetch;
    requestTimeoutMilliseconds?: number;
    retryDelaysMilliseconds?: readonly number[];
    sleepImplementation?: Sleep;
  } = {},
): Promise<string> {
  if (config.DATABASE_URL) {
    return validateDatabaseUrl(config.DATABASE_URL);
  }
  if (!config.DATABASE_SECRET_ID || !options.sessionToken) {
    throw new Error("The managed database secret runtime context is unavailable");
  }

  const endpoint = new URL("http://localhost:2773/secretsmanager/get");
  endpoint.searchParams.set("secretId", config.DATABASE_SECRET_ID);
  const fetchSecret = options.fetchImplementation ?? fetch;
  const requestTimeoutMilliseconds =
    options.requestTimeoutMilliseconds ?? defaultRequestTimeoutMilliseconds;
  const retryDelaysMilliseconds = options.retryDelaysMilliseconds ?? defaultRetryDelaysMilliseconds;
  const wait = options.sleepImplementation ?? sleep;

  let response: Response | undefined;
  for (let attempt = 0; attempt <= retryDelaysMilliseconds.length; attempt += 1) {
    try {
      response = await fetchSecret(endpoint, {
        headers: { "X-Aws-Parameters-Secrets-Token": options.sessionToken },
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      response = undefined;
    }

    if (response?.ok) {
      break;
    }
    if (response && !retryableStatuses.has(response.status)) {
      throw new Error("The managed database secret could not be retrieved");
    }
    const retryDelay = retryDelaysMilliseconds[attempt];
    if (retryDelay === undefined) {
      throw new Error("The managed database secret could not be retrieved");
    }
    await wait(retryDelay);
  }

  if (!response?.ok) {
    throw new Error("The managed database secret could not be retrieved");
  }
  const payload = (await response.json()) as SecretExtensionResponse;
  if (typeof payload.SecretString !== "string") {
    throw new Error("The managed database secret did not contain a string value");
  }
  return validateDatabaseUrl(payload.SecretString);
}
