declare const __AUTH0_AUDIENCE__: string;
declare const __AUTH0_CLIENT_ID__: string;
declare const __AUTH0_DOMAIN__: string;
declare const __EXTENSION_API_ORIGIN__: string;
declare const __PENDING_RETENTION_MILLISECONDS__: number;

export interface ExtensionPublicConfiguration {
  apiOrigin?: string;
  apiConfigured: boolean;
  audience: string;
  clientId: string;
  configured: boolean;
  domain: string;
  pendingRetentionMilliseconds?: number;
}

export function extensionPublicConfiguration(values: {
  apiOrigin?: string;
  audience: string;
  clientId: string;
  domain: string;
  pendingRetentionMilliseconds?: number;
}): ExtensionPublicConfiguration {
  const domain = values.domain.trim();
  const clientId = values.clientId.trim();
  const audience = values.audience.trim();
  const apiOrigin = safeApiOrigin(values.apiOrigin ?? "");
  const pendingRetentionMilliseconds = values.pendingRetentionMilliseconds;
  return {
    apiConfigured: apiOrigin !== undefined,
    audience,
    clientId,
    configured:
      domain.length > 0 &&
      !domain.includes("://") &&
      !domain.includes("/") &&
      !/\s/.test(domain) &&
      clientId.length > 0 &&
      audience === "ai-job-apply-api",
    domain,
    ...(apiOrigin ? { apiOrigin } : {}),
    ...(Number.isInteger(pendingRetentionMilliseconds) &&
    (pendingRetentionMilliseconds ?? 0) >= 60 * 60 * 1_000 &&
    (pendingRetentionMilliseconds ?? 0) <= 30 * 24 * 60 * 60 * 1_000
      ? { pendingRetentionMilliseconds }
      : {}),
  };
}

export function safeApiOrigin(value: string): string | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export const extensionConfiguration = extensionPublicConfiguration({
  apiOrigin: typeof __EXTENSION_API_ORIGIN__ === "string" ? __EXTENSION_API_ORIGIN__ : "",
  audience: typeof __AUTH0_AUDIENCE__ === "string" ? __AUTH0_AUDIENCE__ : "",
  clientId: typeof __AUTH0_CLIENT_ID__ === "string" ? __AUTH0_CLIENT_ID__ : "",
  domain: typeof __AUTH0_DOMAIN__ === "string" ? __AUTH0_DOMAIN__ : "",
  ...(typeof __PENDING_RETENTION_MILLISECONDS__ === "number"
    ? { pendingRetentionMilliseconds: __PENDING_RETENTION_MILLISECONDS__ }
    : {}),
});
