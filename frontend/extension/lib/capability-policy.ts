import { PROVIDER_DETECTORS } from "./detectors";
import type { AtsProvider } from "./job-capture";

export interface ExtensionCapabilityPolicy {
  disabledDomains: readonly string[];
  enabledProviders: Readonly<Record<AtsProvider, boolean>>;
  extensionVersion: string;
  revision: string;
}

export const DEFAULT_DARK_POLICY: ExtensionCapabilityPolicy = {
  disabledDomains: [],
  enabledProviders: {
    ashby: false,
    greenhouse: false,
    lever: false,
  },
  extensionVersion: "0.2.0",
  revision: "d2-synthetic-default-dark-v1",
};

export type CapabilityDecision =
  | { allowed: true; provider: AtsProvider }
  | {
      allowed: false;
      reason: "domain_disabled" | "provider_disabled" | "unsupported_page" | "version_disabled";
    };

export function capabilityForPage(
  pageUrl: string,
  installedVersion: string,
  policy: ExtensionCapabilityPolicy = DEFAULT_DARK_POLICY,
): CapabilityDecision {
  if (installedVersion !== policy.extensionVersion) {
    return { allowed: false, reason: "version_disabled" };
  }
  let hostname: string;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:") {
      return { allowed: false, reason: "unsupported_page" };
    }
    hostname = url.hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: "unsupported_page" };
  }
  if (policy.disabledDomains.includes(hostname)) {
    return { allowed: false, reason: "domain_disabled" };
  }
  const adapter = PROVIDER_DETECTORS.find((candidate) => candidate.domains.includes(hostname));
  if (!adapter) {
    return { allowed: false, reason: "unsupported_page" };
  }
  return policy.enabledProviders[adapter.provider]
    ? { allowed: true, provider: adapter.provider }
    : { allowed: false, reason: "provider_disabled" };
}
