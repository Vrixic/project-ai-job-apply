interface SecretExtensionResponse {
  SecretString?: unknown;
}

function validateDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("The managed database secret is not a PostgreSQL URL");
  }
  return value;
}

export async function resolveLambdaDatabaseUrl(
  config: {
    DATABASE_URL?: string | undefined;
    DATABASE_SECRET_ID?: string | undefined;
  },
  options: {
    sessionToken?: string;
    fetchImplementation?: typeof fetch;
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
  const response = await (options.fetchImplementation ?? fetch)(endpoint, {
    headers: { "X-Aws-Parameters-Secrets-Token": options.sessionToken },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error("The managed database secret could not be retrieved");
  }
  const payload = (await response.json()) as SecretExtensionResponse;
  if (typeof payload.SecretString !== "string") {
    throw new Error("The managed database secret did not contain a string value");
  }
  return validateDatabaseUrl(payload.SecretString);
}
