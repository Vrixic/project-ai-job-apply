import { EXTENSION_CLIENT_VERSION_PATTERN } from "./client-version";
import { PROVIDER_DETECTORS } from "./detectors";
import type { AtsProvider, JobPageVariant } from "./job-capture";

declare const __DETECTOR_ACTIVATION_POLICY__: unknown;

const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const KNOWN_DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.ashbyhq.com",
  "jobs.eu.lever.co",
  "jobs.lever.co",
] as const;

export const DEFAULT_DARK_DETECTOR_POLICY_REVISION = "d2-synthetic-default-dark-v1";

export interface ExtensionDetectorActivationPolicy {
  schemaVersion: 1;
  revision: string;
  extensionVersion: string;
  enabledProviders: Readonly<Record<AtsProvider, boolean>>;
  enabledVariants: Readonly<Record<JobPageVariant, boolean>>;
  enabledDomains: Readonly<Record<(typeof KNOWN_DOMAINS)[number], boolean>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function exactBooleanMap(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, boolean>> | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, keys) ||
    Object.values(value).some((enabled) => typeof enabled !== "boolean")
  ) {
    return undefined;
  }
  return Object.freeze({ ...value }) as Readonly<Record<string, boolean>>;
}

export function parseDetectorActivationPolicy(
  value: unknown,
): ExtensionDetectorActivationPolicy | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "revision",
      "extensionVersion",
      "enabledProviders",
      "enabledVariants",
      "enabledDomains",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.revision !== "string" ||
    !TOKEN_PATTERN.test(value.revision) ||
    typeof value.extensionVersion !== "string" ||
    !EXTENSION_CLIENT_VERSION_PATTERN.test(value.extensionVersion)
  ) {
    return undefined;
  }
  const enabledProviders = exactBooleanMap(value.enabledProviders, [
    "ashby",
    "greenhouse",
    "lever",
  ]);
  const enabledVariants = exactBooleanMap(value.enabledVariants, [
    "ashby-job-board-v1",
    "greenhouse-board-v1",
    "lever-posting-v1",
  ]);
  const enabledDomains = exactBooleanMap(value.enabledDomains, KNOWN_DOMAINS);
  if (!enabledProviders || !enabledVariants || !enabledDomains) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    revision: value.revision,
    extensionVersion: value.extensionVersion,
    enabledProviders: enabledProviders as Readonly<Record<AtsProvider, boolean>>,
    enabledVariants: enabledVariants as Readonly<Record<JobPageVariant, boolean>>,
    enabledDomains: enabledDomains as Readonly<Record<(typeof KNOWN_DOMAINS)[number], boolean>>,
  });
}

export const extensionDetectorActivationPolicy = parseDetectorActivationPolicy(
  typeof __DETECTOR_ACTIVATION_POLICY__ === "object" ? __DETECTOR_ACTIVATION_POLICY__ : undefined,
);

export type CapabilityDecision =
  | { allowed: true; provider: AtsProvider; variant: JobPageVariant }
  | {
      allowed: false;
      reason:
        | "configuration_missing"
        | "domain_disabled"
        | "provider_disabled"
        | "unsupported_page"
        | "variant_disabled"
        | "version_disabled";
    };

export function capabilityForPage(
  pageUrl: string,
  installedVersion: string,
  policy: ExtensionDetectorActivationPolicy | undefined = extensionDetectorActivationPolicy,
): CapabilityDecision {
  if (!policy) return { allowed: false, reason: "configuration_missing" };
  if (installedVersion !== policy.extensionVersion) {
    return { allowed: false, reason: "version_disabled" };
  }
  let hostname: string;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      return { allowed: false, reason: "unsupported_page" };
    }
    hostname = url.hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: "unsupported_page" };
  }
  const adapter = PROVIDER_DETECTORS.find((candidate) => candidate.domains.includes(hostname));
  if (!adapter) return { allowed: false, reason: "unsupported_page" };
  if (policy.enabledProviders[adapter.provider] !== true) {
    return { allowed: false, reason: "provider_disabled" };
  }
  if (policy.enabledVariants[adapter.variant] !== true) {
    return { allowed: false, reason: "variant_disabled" };
  }
  if (policy.enabledDomains[hostname as keyof typeof policy.enabledDomains] !== true) {
    return { allowed: false, reason: "domain_disabled" };
  }
  return { allowed: true, provider: adapter.provider, variant: adapter.variant };
}
