import { createHash, createPublicKey } from "node:crypto";
import {
  contributionCapabilityPolicyDigestInput,
  type SignedD2ContributionCapabilityPolicy,
  verifySignedContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const MAXIMUM_ENVELOPE_BYTES = 32 * 1024;
const MAXIMUM_KEY_BYTES = 4 * 1024;
const MAXIMUM_PINNED_KEYS = 8;
const MAXIMUM_SEEN_REVISIONS = 256;

export const contributionCapabilityPolicyEnvironmentKeys = Object.freeze({
  envelope: "JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON",
  publicKeys: "JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON",
} as const);

export class ContributionCapabilityPolicySourceUnavailableError extends Error {
  constructor() {
    super("The contribution capability policy is unavailable");
    this.name = "ContributionCapabilityPolicySourceUnavailableError";
  }
}

export interface ContributionCapabilityPolicySource {
  load(): Promise<{
    envelope: SignedD2ContributionCapabilityPolicy;
    publicKeys: Readonly<Record<string, string>>;
  } | null>;
  readPublicEnvelope(): Promise<SignedD2ContributionCapabilityPolicy | null>;
}

export interface ContributionCapabilityPolicySourceOptions {
  readEnvelope(): Promise<unknown | null>;
  publicKeys: Readonly<Record<string, string>>;
  now(): Date;
}

interface AcceptedPolicy {
  fingerprint: string;
  issuedAtMilliseconds: number;
}

function unavailable(): never {
  throw new ContributionCapabilityPolicySourceUnavailableError();
}

function exactObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pinnedKeys(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (!exactObject(value)) unavailable();
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > MAXIMUM_PINNED_KEYS) unavailable();
  const normalized: Record<string, string> = {};
  for (const [keyId, pem] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (
      !KEY_ID_PATTERN.test(keyId) ||
      typeof pem !== "string" ||
      Buffer.byteLength(pem, "utf8") < 64 ||
      Buffer.byteLength(pem, "utf8") > MAXIMUM_KEY_BYTES ||
      pem.includes("PRIVATE KEY")
    ) {
      unavailable();
    }
    try {
      if (createPublicKey(pem).asymmetricKeyType !== "ed25519") unavailable();
    } catch {
      unavailable();
    }
    normalized[keyId] = pem;
  }
  return Object.freeze(normalized);
}

function envelopeFingerprint(envelope: SignedD2ContributionCapabilityPolicy): string {
  return createHash("sha256")
    .update("ai-job-apply/contribution-capability-envelope/v1\0")
    .update(envelope.keyId)
    .update("\0")
    .update(contributionCapabilityPolicyDigestInput(envelope.payload))
    .update("\0")
    .update(envelope.signature)
    .digest("hex");
}

export class ConfiguredContributionCapabilityPolicySource
  implements ContributionCapabilityPolicySource
{
  private readonly publicKeys: Readonly<Record<string, string>>;
  private accepted: AcceptedPolicy | undefined;
  private readonly seenRevisions = new Map<string, string>();

  constructor(private readonly options: ContributionCapabilityPolicySourceOptions) {
    if (typeof options.readEnvelope !== "function" || typeof options.now !== "function") {
      unavailable();
    }
    this.publicKeys = pinnedKeys(options.publicKeys);
  }

  async load(): Promise<{
    envelope: SignedD2ContributionCapabilityPolicy;
    publicKeys: Readonly<Record<string, string>>;
  } | null> {
    try {
      const candidate = await this.options.readEnvelope();
      if (candidate === null) return null;
      const serialized = JSON.stringify(candidate);
      if (
        Buffer.byteLength(serialized, "utf8") > MAXIMUM_ENVELOPE_BYTES ||
        !exactObject(candidate)
      ) {
        unavailable();
      }
      const envelope = structuredClone(
        candidate,
      ) as unknown as SignedD2ContributionCapabilityPolicy;
      const policy = verifySignedContributionCapabilityPolicy(envelope, this.publicKeys);
      const now = this.options.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) unavailable();
      const issuedAtMilliseconds = Date.parse(policy.issuedAt);
      if (now.getTime() < issuedAtMilliseconds || now.getTime() >= Date.parse(policy.expiresAt)) {
        unavailable();
      }

      const fingerprint = envelopeFingerprint(envelope);
      const seenFingerprint = this.seenRevisions.get(policy.revision);
      if (seenFingerprint && seenFingerprint !== fingerprint) unavailable();
      if (
        this.accepted &&
        (issuedAtMilliseconds < this.accepted.issuedAtMilliseconds ||
          (issuedAtMilliseconds === this.accepted.issuedAtMilliseconds &&
            fingerprint !== this.accepted.fingerprint))
      ) {
        unavailable();
      }
      if (!seenFingerprint && this.seenRevisions.size >= MAXIMUM_SEEN_REVISIONS) unavailable();
      this.seenRevisions.set(policy.revision, fingerprint);
      this.accepted = { fingerprint, issuedAtMilliseconds };
      return Object.freeze({ envelope: structuredClone(envelope), publicKeys: this.publicKeys });
    } catch (error) {
      if (error instanceof ContributionCapabilityPolicySourceUnavailableError) throw error;
      unavailable();
    }
  }

  async readPublicEnvelope(): Promise<SignedD2ContributionCapabilityPolicy | null> {
    const loaded = await this.load();
    return loaded ? structuredClone(loaded.envelope) : null;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

export function contributionCapabilityPolicySourceFromEnvironment(
  environment: Environment,
  now: () => Date,
): ConfiguredContributionCapabilityPolicySource | null {
  const envelopeJson = environment[contributionCapabilityPolicyEnvironmentKeys.envelope]?.trim();
  const publicKeysJson =
    environment[contributionCapabilityPolicyEnvironmentKeys.publicKeys]?.trim();
  if (!envelopeJson && !publicKeysJson) return null;
  if (!envelopeJson || !publicKeysJson) unavailable();
  if (
    Buffer.byteLength(envelopeJson, "utf8") > MAXIMUM_ENVELOPE_BYTES ||
    Buffer.byteLength(publicKeysJson, "utf8") > MAXIMUM_PINNED_KEYS * MAXIMUM_KEY_BYTES
  ) {
    unavailable();
  }
  let envelope: unknown;
  let keys: unknown;
  try {
    envelope = JSON.parse(envelopeJson);
    keys = JSON.parse(publicKeysJson);
  } catch {
    unavailable();
  }
  if (!exactObject(keys) || Object.values(keys).some((value) => typeof value !== "string")) {
    unavailable();
  }
  return new ConfiguredContributionCapabilityPolicySource({
    readEnvelope: async () => structuredClone(envelope),
    publicKeys: keys as Record<string, string>,
    now,
  });
}
