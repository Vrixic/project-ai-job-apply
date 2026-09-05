import { EXTENSION_CLIENT_VERSION_PATTERN } from "./client-version";
import type { AtsProvider, JobPageVariant, SanitizedJobCapture } from "./job-capture";

export const CONTRIBUTION_CAPABILITY_POLICY_CACHE_KEY = "d2SignedContributionCapabilityPolicyV1";
export const CONTRIBUTION_CAPABILITY_POLICY_PATH = "/v1/extension/contribution-capability-policy";

const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const BASE64URL_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const BASE64URL_SPKI_PATTERN = /^[A-Za-z0-9_-]{40,256}$/u;
const MAXIMUM_POLICY_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const MAXIMUM_POLICY_RESPONSE_BYTES = 64 * 1_024;
const POLICY_REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const READINESS_REFRESH_COOLDOWN_MILLISECONDS = 15_000;

const EXACT_VARIANT = {
  ashby: "ashby-job-board-v1",
  greenhouse: "greenhouse-board-v1",
  lever: "lever-posting-v1",
} as const satisfies Record<AtsProvider, JobPageVariant>;

const EXACT_DOMAINS: Readonly<Record<AtsProvider, readonly string[]>> = {
  ashby: ["jobs.ashbyhq.com"],
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  lever: ["jobs.eu.lever.co", "jobs.lever.co"],
};

export interface ExtensionContributionCapabilityPolicy {
  schemaVersion: 1;
  revision: string;
  issuedAt: string;
  expiresAt: string;
  intakeEnabled: boolean;
  processingEnabled: boolean;
  clients: Readonly<Record<string, boolean>>;
  providers: Readonly<Record<AtsProvider, boolean>>;
  variants: Readonly<Record<JobPageVariant, boolean>>;
  domains: Readonly<Record<string, boolean>>;
}

export interface SignedExtensionContributionCapabilityPolicy {
  keyId: string;
  payload: ExtensionContributionCapabilityPolicy;
  signature: string;
}

export type ExtensionContributionCapabilityDecision =
  | { allowed: true; policyRevision: string }
  | {
      allowed: false;
      reason:
        | "client_disabled"
        | "domain_disabled"
        | "global_disabled"
        | "policy_expired"
        | "policy_missing"
        | "policy_not_yet_valid"
        | "provider_disabled"
        | "variant_disabled";
    };

export interface ContributionCapabilityPolicyCache {
  read(): Promise<unknown>;
  remove(): Promise<void>;
  write(envelope: SignedExtensionContributionCapabilityPolicy): Promise<void>;
}

export class ContributionCapabilityPolicyTransportError extends Error {
  constructor() {
    super("The contribution capability policy endpoint is unavailable");
    this.name = "ContributionCapabilityPolicyTransportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function exactIsoTimestamp(value: unknown): { instant: number; value: string } {
  if (typeof value !== "string") {
    throw new Error("The contribution capability policy timestamp is invalid");
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    throw new Error("The contribution capability policy timestamp is invalid");
  }
  return { instant, value };
}

function sortedBooleanRecord(
  value: unknown,
  keyPattern: RegExp,
  maximumKeys: number,
): Record<string, boolean> {
  if (!isRecord(value)) {
    throw new Error("The contribution capability policy map is invalid");
  }
  const entries = Object.entries(value);
  if (
    entries.length < 1 ||
    entries.length > maximumKeys ||
    entries.some(([key, enabled]) => !keyPattern.test(key) || typeof enabled !== "boolean")
  ) {
    throw new Error("The contribution capability policy map is invalid");
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))) as Record<
    string,
    boolean
  >;
}

function normalizePolicy(value: unknown): ExtensionContributionCapabilityPolicy {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
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
    value.schemaVersion !== 1 ||
    typeof value.revision !== "string" ||
    !TOKEN_PATTERN.test(value.revision) ||
    typeof value.intakeEnabled !== "boolean" ||
    typeof value.processingEnabled !== "boolean"
  ) {
    throw new Error("The contribution capability policy is invalid");
  }
  const issuedAt = exactIsoTimestamp(value.issuedAt);
  const expiresAt = exactIsoTimestamp(value.expiresAt);
  if (
    expiresAt.instant <= issuedAt.instant ||
    expiresAt.instant - issuedAt.instant > MAXIMUM_POLICY_LIFETIME_MILLISECONDS
  ) {
    throw new Error("The contribution capability policy lifetime is invalid");
  }
  const clients = sortedBooleanRecord(value.clients, EXTENSION_CLIENT_VERSION_PATTERN, 100);
  const providers = sortedBooleanRecord(value.providers, /^(?:ashby|greenhouse|lever)$/u, 3);
  const variants = sortedBooleanRecord(
    value.variants,
    /^(?:ashby-job-board-v1|greenhouse-board-v1|lever-posting-v1)$/u,
    3,
  );
  const domains = sortedBooleanRecord(value.domains, DOMAIN_PATTERN, 20);
  if (
    Object.keys(providers).length !== 3 ||
    Object.keys(variants).length !== 3 ||
    Object.keys(domains).some(
      (domain) => !Object.values(EXACT_DOMAINS).some((allowed) => allowed.includes(domain)),
    )
  ) {
    throw new Error("The contribution capability policy boundary is incomplete");
  }
  return {
    schemaVersion: 1,
    revision: value.revision,
    issuedAt: issuedAt.value,
    expiresAt: expiresAt.value,
    intakeEnabled: value.intakeEnabled,
    processingEnabled: value.processingEnabled,
    clients,
    providers: providers as Record<AtsProvider, boolean>,
    variants: variants as Record<JobPageVariant, boolean>,
    domains,
  };
}

export function contributionCapabilityPolicyDigestInput(value: unknown): string {
  return JSON.stringify(normalizePolicy(value));
}

function base64UrlBytes(value: string): ArrayBuffer {
  const padded = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error("The signed contribution capability policy encoding is invalid");
  }
  const canonical = btoa(decoded).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  if (canonical !== value) {
    throw new Error("The signed contribution capability policy encoding is invalid");
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}

export async function verifySignedContributionCapabilityPolicy(
  value: unknown,
  publicKeys: Readonly<Record<string, string>>,
): Promise<{
  envelope: SignedExtensionContributionCapabilityPolicy;
  policy: ExtensionContributionCapabilityPolicy;
}> {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["keyId", "payload", "signature"]) ||
    typeof value.keyId !== "string" ||
    !TOKEN_PATTERN.test(value.keyId) ||
    typeof value.signature !== "string" ||
    !BASE64URL_SIGNATURE_PATTERN.test(value.signature)
  ) {
    throw new Error("The signed contribution capability policy envelope is invalid");
  }
  const encodedPublicKey = Object.hasOwn(publicKeys, value.keyId)
    ? publicKeys[value.keyId]
    : undefined;
  if (typeof encodedPublicKey !== "string") {
    throw new Error("The contribution capability signing key is unknown");
  }
  if (!BASE64URL_SPKI_PATTERN.test(encodedPublicKey)) {
    throw new Error("The contribution capability signing key is invalid");
  }
  const digestInput = contributionCapabilityPolicyDigestInput(value.payload);
  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      base64UrlBytes(encodedPublicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64UrlBytes(value.signature),
      new TextEncoder().encode(digestInput),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error("The contribution capability policy signature is invalid");
  }
  const policy = normalizePolicy(value.payload);
  return {
    envelope: {
      keyId: value.keyId,
      payload: structuredClone(policy),
      signature: value.signature,
    },
    policy: structuredClone(policy),
  };
}

export function evaluateExtensionContributionCapability(
  policy: ExtensionContributionCapabilityPolicy | undefined,
  input: {
    capture: SanitizedJobCapture;
    clientVersion: string;
    now: Date;
  },
): ExtensionContributionCapabilityDecision {
  if (!policy) return { allowed: false, reason: "policy_missing" };
  contributionCapabilityPolicyDigestInput(policy);
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new TypeError("The contribution capability decision clock is invalid");
  }
  const now = input.now.getTime();
  if (now < Date.parse(policy.issuedAt)) {
    return { allowed: false, reason: "policy_not_yet_valid" };
  }
  if (now >= Date.parse(policy.expiresAt)) {
    return { allowed: false, reason: "policy_expired" };
  }
  if (!policy.intakeEnabled) return { allowed: false, reason: "global_disabled" };
  if (policy.clients[input.clientVersion] !== true) {
    return { allowed: false, reason: "client_disabled" };
  }
  if (policy.providers[input.capture.provider] !== true) {
    return { allowed: false, reason: "provider_disabled" };
  }
  if (
    EXACT_VARIANT[input.capture.provider] !== input.capture.pageVariant ||
    policy.variants[input.capture.pageVariant] !== true
  ) {
    return { allowed: false, reason: "variant_disabled" };
  }
  let domain: string;
  try {
    domain = new URL(input.capture.sourceUrl).hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: "domain_disabled" };
  }
  if (!EXACT_DOMAINS[input.capture.provider].includes(domain) || policy.domains[domain] !== true) {
    return { allowed: false, reason: "domain_disabled" };
  }
  return { allowed: true, policyRevision: policy.revision };
}

export async function fetchSignedContributionCapabilityPolicy(
  apiOrigin: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLICY_REQUEST_TIMEOUT_MILLISECONDS);
  try {
    return await fetchPolicyResponse(apiOrigin, fetchImplementation, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new ContributionCapabilityPolicyTransportError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPolicyResponse(
  apiOrigin: string,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(new URL(CONTRIBUTION_CAPABILITY_POLICY_PATH, apiOrigin), {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal,
    });
  } catch {
    throw new ContributionCapabilityPolicyTransportError();
  }
  if (
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    throw new ContributionCapabilityPolicyTransportError();
  }
  if (
    response.status !== 200 ||
    response.headers.get("cache-control")?.toLowerCase() !== "no-store" ||
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
  ) {
    throw new Error("The contribution capability policy response is invalid");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_POLICY_RESPONSE_BYTES) {
    throw new Error("The contribution capability policy response is too large");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > MAXIMUM_POLICY_RESPONSE_BYTES) {
    throw new Error("The contribution capability policy response is too large");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("The contribution capability policy response is invalid");
  }
}

export class ExtensionContributionPolicyRuntime {
  #activePolicy: ExtensionContributionCapabilityPolicy | undefined;
  // An invalid update denies delivery, but must not erase the warm worker's rollback floor.
  #lastAcceptedPolicy: ExtensionContributionCapabilityPolicy | undefined;
  #refreshInFlight: Promise<boolean> | undefined;
  #lastRefreshStartedAt: number | undefined;

  constructor(
    private readonly publicKeys: Readonly<Record<string, string>>,
    private readonly cache: ContributionCapabilityPolicyCache,
    private readonly fetchEnvelope: () => Promise<unknown>,
  ) {}

  decision(
    capture: SanitizedJobCapture,
    clientVersion: string,
    now = new Date(),
  ): ExtensionContributionCapabilityDecision {
    return evaluateExtensionContributionCapability(this.#activePolicy, {
      capture,
      clientVersion,
      now,
    });
  }

  async restore(now = new Date()): Promise<boolean> {
    try {
      const verified = await verifySignedContributionCapabilityPolicy(
        await this.cache.read(),
        this.publicKeys,
      );
      if (
        now.getTime() < Date.parse(verified.policy.issuedAt) ||
        now.getTime() >= Date.parse(verified.policy.expiresAt)
      ) {
        throw new Error("The cached contribution capability policy is not current");
      }
      this.#activePolicy = verified.policy;
      this.#lastAcceptedPolicy = verified.policy;
      return true;
    } catch {
      this.#activePolicy = undefined;
      await this.cache.remove();
      return false;
    }
  }

  refresh(now = new Date()): Promise<boolean> {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    this.#lastRefreshStartedAt = now.getTime();
    this.#refreshInFlight = this.#refresh(now).finally(() => {
      this.#refreshInFlight = undefined;
    });
    return this.#refreshInFlight;
  }

  async refreshForReadiness(now = new Date()): Promise<boolean> {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    const elapsed = now.getTime() - (this.#lastRefreshStartedAt ?? -Infinity);
    if (elapsed >= 0 && elapsed < READINESS_REFRESH_COOLDOWN_MILLISECONDS) {
      return (
        this.#activePolicy !== undefined &&
        now.getTime() >= Date.parse(this.#activePolicy.issuedAt) &&
        now.getTime() < Date.parse(this.#activePolicy.expiresAt)
      );
    }
    return this.refresh(now);
  }

  async #refresh(now: Date): Promise<boolean> {
    let fetched: unknown;
    try {
      fetched = await this.fetchEnvelope();
    } catch (error) {
      if (
        error instanceof ContributionCapabilityPolicyTransportError &&
        this.#activePolicy &&
        now.getTime() >= Date.parse(this.#activePolicy.issuedAt) &&
        now.getTime() < Date.parse(this.#activePolicy.expiresAt)
      ) {
        return true;
      }
      this.#activePolicy = undefined;
      await this.cache.remove();
      return false;
    }
    try {
      const verified = await verifySignedContributionCapabilityPolicy(fetched, this.publicKeys);
      if (
        now.getTime() < Date.parse(verified.policy.issuedAt) ||
        now.getTime() >= Date.parse(verified.policy.expiresAt)
      ) {
        throw new Error("The contribution capability policy is not current");
      }
      if (this.#lastAcceptedPolicy) {
        const activeIssuedAt = Date.parse(this.#lastAcceptedPolicy.issuedAt);
        const receivedIssuedAt = Date.parse(verified.policy.issuedAt);
        if (
          receivedIssuedAt < activeIssuedAt ||
          (receivedIssuedAt === activeIssuedAt &&
            contributionCapabilityPolicyDigestInput(verified.policy) !==
              contributionCapabilityPolicyDigestInput(this.#lastAcceptedPolicy))
        ) {
          throw new Error("The contribution capability policy update is a rollback or fork");
        }
      }
      await this.cache.write(verified.envelope);
      this.#activePolicy = verified.policy;
      this.#lastAcceptedPolicy = verified.policy;
      return true;
    } catch {
      this.#activePolicy = undefined;
      await this.cache.remove();
      return false;
    }
  }

  async start(now = new Date()): Promise<boolean> {
    await this.restore(now);
    return this.refresh(now);
  }
}
