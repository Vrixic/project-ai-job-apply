declare const __AUTH0_AUDIENCE__: string;
declare const __AUTH0_CLIENT_ID__: string;
declare const __AUTH0_DOMAIN__: string;
declare const __EXTENSION_API_ORIGIN__: string;
declare const __PENDING_RETENTION_MILLISECONDS__: number;
declare const __CAPABILITY_POLICY_PUBLIC_KEYS__: Readonly<Record<string, string>>;
declare const __UGC_CONTRIBUTION_POLICY_VERSION__: string;

const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

export interface ExtensionPublicConfiguration {
  apiOrigin?: string;
  apiConfigured: boolean;
  audience: string;
  capabilityPolicyPublicKeys: Readonly<Record<string, string>>;
  clientId: string;
  configured: boolean;
  domain: string;
  pendingRetentionMilliseconds?: number;
  ugcContributionPolicyVersion?: string;
}

export function extensionPublicConfiguration(values: {
  apiOrigin?: string;
  audience: string;
  capabilityPolicyPublicKeys?: Readonly<Record<string, string>>;
  clientId: string;
  domain: string;
  pendingRetentionMilliseconds?: number;
  ugcContributionPolicyVersion?: string;
}): ExtensionPublicConfiguration {
  const domain = values.domain.trim();
  const clientId = values.clientId.trim();
  const audience = values.audience.trim();
  const apiOrigin = safeApiOrigin(values.apiOrigin ?? "");
  const pendingRetentionMilliseconds = values.pendingRetentionMilliseconds;
  const ugcContributionPolicyVersion = values.ugcContributionPolicyVersion?.trim();
  const capabilityPolicyPublicKeys = Object.fromEntries(
    Object.entries(values.capabilityPolicyPublicKeys ?? {})
      .filter(
        ([keyId, publicKey]) =>
          /^[a-z0-9][a-z0-9._-]{2,99}$/u.test(keyId) &&
          typeof publicKey === "string" &&
          /^[A-Za-z0-9_-]{40,256}$/u.test(publicKey),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 5),
  );
  return {
    apiConfigured: apiOrigin !== undefined,
    audience,
    capabilityPolicyPublicKeys,
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
    ...(ugcContributionPolicyVersion && POLICY_VERSION.test(ugcContributionPolicyVersion)
      ? { ugcContributionPolicyVersion }
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
  capabilityPolicyPublicKeys:
    typeof __CAPABILITY_POLICY_PUBLIC_KEYS__ === "object" &&
    __CAPABILITY_POLICY_PUBLIC_KEYS__ !== null
      ? __CAPABILITY_POLICY_PUBLIC_KEYS__
      : {},
  clientId: typeof __AUTH0_CLIENT_ID__ === "string" ? __AUTH0_CLIENT_ID__ : "",
  domain: typeof __AUTH0_DOMAIN__ === "string" ? __AUTH0_DOMAIN__ : "",
  ugcContributionPolicyVersion:
    typeof __UGC_CONTRIBUTION_POLICY_VERSION__ === "string"
      ? __UGC_CONTRIBUTION_POLICY_VERSION__
      : "",
  ...(typeof __PENDING_RETENTION_MILLISECONDS__ === "number"
    ? { pendingRetentionMilliseconds: __PENDING_RETENTION_MILLISECONDS__ }
    : {}),
});
