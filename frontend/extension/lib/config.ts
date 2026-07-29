declare const __AUTH0_AUDIENCE__: string;
declare const __AUTH0_CLIENT_ID__: string;
declare const __AUTH0_DOMAIN__: string;

export interface ExtensionPublicConfiguration {
  audience: string;
  clientId: string;
  configured: boolean;
  domain: string;
}

export function extensionPublicConfiguration(values: {
  audience: string;
  clientId: string;
  domain: string;
}): ExtensionPublicConfiguration {
  const domain = values.domain.trim();
  const clientId = values.clientId.trim();
  const audience = values.audience.trim();
  return {
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
  };
}

export const extensionConfiguration = extensionPublicConfiguration({
  audience: typeof __AUTH0_AUDIENCE__ === "string" ? __AUTH0_AUDIENCE__ : "",
  clientId: typeof __AUTH0_CLIENT_ID__ === "string" ? __AUTH0_CLIENT_ID__ : "",
  domain: typeof __AUTH0_DOMAIN__ === "string" ? __AUTH0_DOMAIN__ : "",
});
