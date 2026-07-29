export const AUTH0_CUSTOM_SCHEME = "applydashdev";
export const AUTH0_AUDIENCE = "ai-job-apply-api";

type Environment = Record<string, string | undefined>;

export interface MobilePublicConfiguration {
  audience: string;
  clientId: string;
  configured: boolean;
  domain: string;
}

function validDomain(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("://") &&
    !value.includes("/") &&
    !/\s/.test(value) &&
    value.includes(".")
  );
}

export function mobilePublicConfiguration(environment: Environment): MobilePublicConfiguration {
  const domain = environment.EXPO_PUBLIC_AUTH0_DOMAIN?.trim() ?? "";
  const clientId = environment.EXPO_PUBLIC_AUTH0_CLIENT_ID?.trim() ?? "";
  const audience = environment.EXPO_PUBLIC_AUTH0_AUDIENCE?.trim() || AUTH0_AUDIENCE;

  return {
    audience,
    clientId,
    configured: validDomain(domain) && clientId.length > 0 && audience === AUTH0_AUDIENCE,
    domain,
  };
}
