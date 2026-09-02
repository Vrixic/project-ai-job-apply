import { createPublicKey, verify } from "node:crypto";
import type { D2PageVariant, D2Provider } from "./freshness-policy.js";

export interface D2ContributionCapabilityPolicy {
  schemaVersion: 1;
  revision: string;
  issuedAt: string;
  expiresAt: string;
  intakeEnabled: boolean;
  processingEnabled: boolean;
  clients: Readonly<Record<string, boolean>>;
  providers: Readonly<Record<D2Provider, boolean>>;
  variants: Readonly<Record<D2PageVariant, boolean>>;
  domains: Readonly<Record<string, boolean>>;
}

export interface SignedD2ContributionCapabilityPolicy {
  keyId: string;
  payload: D2ContributionCapabilityPolicy;
  signature: string;
}

export interface ContributionCapabilityInput {
  stage: "intake" | "processing";
  clientVersion: string;
  provider: D2Provider;
  pageVariant: D2PageVariant;
  domain: string;
  now: Date;
}

export type ContributionCapabilityDecision =
  | { allowed: true; policyRevision: string }
  | {
      allowed: false;
      reason:
        | "client_disabled"
        | "domain_disabled"
        | "global_disabled"
        | "policy_expired"
        | "policy_not_yet_valid"
        | "provider_disabled"
        | "variant_disabled";
    };

const VERSION_PATTERN =
  /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,15})?$/u;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const BASE64URL_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const MAXIMUM_POLICY_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;

const exactVariant = {
  greenhouse: "greenhouse-board-v1",
  lever: "lever-posting-v1",
  ashby: "ashby-job-board-v1",
} as const satisfies Record<D2Provider, D2PageVariant>;

const exactDomains: Readonly<Record<D2Provider, readonly string[]>> = {
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  lever: ["jobs.lever.co", "jobs.eu.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
};

function exactIsoTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("The contribution capability policy timestamp is invalid");
  }
  return parsed;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function sortedBooleanRecord(
  value: Readonly<Record<string, boolean>>,
  keyPattern: RegExp,
  maximumKeys: number,
): Record<string, boolean> {
  const entries = Object.entries(value);
  if (
    entries.length < 1 ||
    entries.length > maximumKeys ||
    entries.some(([key, enabled]) => !keyPattern.test(key) || typeof enabled !== "boolean")
  ) {
    throw new Error("The contribution capability policy map is invalid");
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function contributionCapabilityPolicyDigestInput(
  payload: D2ContributionCapabilityPolicy,
): string {
  if (
    !payload ||
    typeof payload !== "object" ||
    !exactKeys(payload, [
      "schemaVersion",
      "revision",
      "issuedAt",
      "expiresAt",
      "intakeEnabled",
      "processingEnabled",
      "clients",
      "providers",
      "variants",
      "domains",
    ]) ||
    payload.schemaVersion !== 1 ||
    !TOKEN_PATTERN.test(payload.revision) ||
    typeof payload.intakeEnabled !== "boolean" ||
    typeof payload.processingEnabled !== "boolean" ||
    !payload.clients ||
    !payload.providers ||
    !payload.variants ||
    !payload.domains
  ) {
    throw new Error("The contribution capability policy is invalid");
  }
  const issuedAt = exactIsoTimestamp(payload.issuedAt);
  const expiresAt = exactIsoTimestamp(payload.expiresAt);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAXIMUM_POLICY_LIFETIME_MILLISECONDS) {
    throw new Error("The contribution capability policy lifetime is invalid");
  }
  const clients = sortedBooleanRecord(payload.clients, VERSION_PATTERN, 100);
  const providers = sortedBooleanRecord(payload.providers, /^(?:ashby|greenhouse|lever)$/u, 3);
  const variants = sortedBooleanRecord(
    payload.variants,
    /^(?:ashby-job-board-v1|greenhouse-board-v1|lever-posting-v1)$/u,
    3,
  );
  const domains = sortedBooleanRecord(payload.domains, DOMAIN_PATTERN, 20);
  if (
    Object.keys(providers).length !== 3 ||
    Object.keys(variants).length !== 3 ||
    Object.keys(domains).some(
      (domain) => !Object.values(exactDomains).some((allowed) => allowed.includes(domain)),
    )
  ) {
    throw new Error("The contribution capability policy boundary is incomplete");
  }
  return JSON.stringify({
    schemaVersion: 1,
    revision: payload.revision,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    intakeEnabled: payload.intakeEnabled,
    processingEnabled: payload.processingEnabled,
    clients,
    providers,
    variants,
    domains,
  });
}

export function verifySignedContributionCapabilityPolicy(
  envelope: SignedD2ContributionCapabilityPolicy,
  publicKeys: Readonly<Record<string, string>>,
): D2ContributionCapabilityPolicy {
  if (
    !envelope ||
    typeof envelope !== "object" ||
    !exactKeys(envelope, ["keyId", "payload", "signature"]) ||
    !TOKEN_PATTERN.test(envelope.keyId) ||
    !BASE64URL_SIGNATURE_PATTERN.test(envelope.signature)
  ) {
    throw new Error("The signed contribution capability policy envelope is invalid");
  }
  const publicKey = publicKeys[envelope.keyId];
  if (!publicKey) throw new Error("The contribution capability signing key is unknown");
  const message = Buffer.from(contributionCapabilityPolicyDigestInput(envelope.payload), "utf8");
  let valid = false;
  try {
    valid = verify(
      null,
      message,
      createPublicKey(publicKey),
      Buffer.from(envelope.signature, "base64url"),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("The contribution capability policy signature is invalid");
  return structuredClone(envelope.payload);
}

export function evaluateContributionCapability(
  policy: D2ContributionCapabilityPolicy,
  input: ContributionCapabilityInput,
): ContributionCapabilityDecision {
  contributionCapabilityPolicyDigestInput(policy);
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new TypeError("The contribution capability decision clock is invalid");
  }
  if (input.now.getTime() >= Date.parse(policy.expiresAt)) {
    return { allowed: false, reason: "policy_expired" };
  }
  if (input.now.getTime() < Date.parse(policy.issuedAt)) {
    return { allowed: false, reason: "policy_not_yet_valid" };
  }
  if (input.stage === "intake" ? !policy.intakeEnabled : !policy.processingEnabled) {
    return { allowed: false, reason: "global_disabled" };
  }
  if (policy.clients[input.clientVersion] !== true) {
    return { allowed: false, reason: "client_disabled" };
  }
  if (policy.providers[input.provider] !== true) {
    return { allowed: false, reason: "provider_disabled" };
  }
  if (
    exactVariant[input.provider] !== input.pageVariant ||
    policy.variants[input.pageVariant] !== true
  ) {
    return { allowed: false, reason: "variant_disabled" };
  }
  if (
    !exactDomains[input.provider].includes(input.domain) ||
    policy.domains[input.domain] !== true
  ) {
    return { allowed: false, reason: "domain_disabled" };
  }
  return { allowed: true, policyRevision: policy.revision };
}
