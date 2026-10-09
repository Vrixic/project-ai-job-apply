import { timingSafeEqual } from "node:crypto";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";

/** Private transition/replay capability. The original digest is encrypted, never replaced by
 * a new request hash. Callers must authorize ownership and recheck the archived binding after
 * the await; this component provides no SQL, migration, deletion or replay admission authority. */
export interface LegacyReceiptScope {
  ownerUserId: string;
  applicationId: string;
  protectionId: string;
  operation: "create_packet" | "queue_preparation";
  /** Exact original receipt metadata, excluding its request digest and any candidate values. */
  metadataSha256: string;
}

export interface LegacyReceiptEnvelope {
  schemaVersion: 1;
  encryptionKeyArn: string;
  ciphertext: Uint8Array;
}

interface Sender {
  send(command: unknown, options: { abortSignal: AbortSignal }): Promise<unknown>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const KEY = /^arn:aws:kms:([a-z]{2}-[a-z]+-\d):([0-9]{12}):key\/([a-f0-9-]{36})$/u;
const unavailable = () => Error("LegacyReceiptProtectionUnavailable");

function closed(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length) throw unavailable();
  for (const key of keys) {
    const property = descriptors[key];
    if (!property?.enumerable || !("value" in property)) throw unavailable();
  }
}

function fixedScope(input: LegacyReceiptScope): LegacyReceiptScope {
  closed(input, ["ownerUserId", "applicationId", "protectionId", "operation", "metadataSha256"]);
  if (
    ![input.ownerUserId, input.applicationId, input.protectionId].every(
      (id) => typeof id === "string" && UUID.test(id),
    ) ||
    !["create_packet", "queue_preparation"].includes(input.operation) ||
    typeof input.metadataSha256 !== "string" ||
    !HASH.test(input.metadataSha256)
  )
    throw unavailable();
  return Object.freeze({ ...input });
}

function context(scope: LegacyReceiptScope) {
  return {
    purpose: "restricted-legacy-application-receipt.v1",
    owner_user_id: scope.ownerUserId,
    application_id: scope.applicationId,
    protection_id: scope.protectionId,
    operation: scope.operation,
    metadata_sha256: scope.metadataSha256,
  };
}

function digest(value: unknown): Buffer {
  if (typeof value !== "string" || !HASH.test(value)) throw unavailable();
  return Buffer.from(value, "ascii");
}

/** Only 64 ASCII digest bytes enter KMS Encrypt. Distinct purpose prevents substitution with
 * packet-value envelopes. Default-off; replay-only composition cannot encrypt. A pending SDK
 * call retains admission until it settles, including after the ten-second abort deadline. */
export function createLegacyReceiptKmsCipher(options: {
  encryptionKeyArn: string;
  historicalEncryptionKeyArns?: readonly string[];
  enabled?: () => boolean;
  readOnly?: true;
  testClient?: Sender;
}) {
  const activeKey = options.encryptionKeyArn;
  const active = KEY.exec(activeKey);
  if (!active || !UUID.test(active[3] ?? "")) throw unavailable();
  const region = active[1] as string;
  const historical = options.historicalEncryptionKeyArns ?? [];
  if (
    !Array.isArray(historical) ||
    Object.getPrototypeOf(historical) !== Array.prototype ||
    historical.length > 8 ||
    Reflect.ownKeys(historical).length !== historical.length + 1
  )
    throw unavailable();
  const permittedKeys = new Set([activeKey]);
  for (let index = 0; index < historical.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(historical, String(index));
    if (!entry?.enumerable || !("value" in entry) || typeof entry.value !== "string")
      throw unavailable();
    const match = KEY.exec(entry.value);
    if (
      !match ||
      !UUID.test(match[3] ?? "") ||
      match[1] !== active[1] ||
      match[2] !== active[2] ||
      permittedKeys.has(entry.value)
    )
      throw unavailable();
    permittedKeys.add(entry.value);
  }
  const enabled = options.enabled ?? (() => false);
  const readOnly = options.readOnly === true;
  const testClient = options.testClient;
  if (testClient && process.env.NODE_ENV !== "test") throw unavailable();
  let sender: Sender | undefined;
  let pending = false;
  const permitted = () => {
    if (!enabled() || (testClient && process.env.NODE_ENV !== "test")) throw unavailable();
  };
  async function guarded<T>(run: (client: Sender, signal: AbortSignal) => Promise<T>): Promise<T> {
    let admitted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      permitted();
      if (pending) throw unavailable();
      pending = true;
      admitted = true;
      sender ??=
        testClient ??
        new KMSClient({
          region,
          endpoint: `https://kms.${region}.amazonaws.com`,
          ignoreConfiguredEndpointUrls: true,
          maxAttempts: 1,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
      const controller = new AbortController();
      const started = process.hrtime.bigint();
      timer = setTimeout(() => controller.abort(), 10_000);
      timer.unref();
      const result = await run(sender, controller.signal);
      permitted();
      if (controller.signal.aborted || process.hrtime.bigint() - started >= 10_000_000_000n)
        throw unavailable();
      return result;
    } catch {
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      if (admitted) pending = false;
    }
  }

  return Object.freeze({
    async encrypt(
      input: LegacyReceiptScope,
      originalDigest: string,
    ): Promise<LegacyReceiptEnvelope> {
      let plaintext: Buffer | undefined;
      try {
        if (readOnly) throw unavailable();
        const scope = fixedScope(input);
        plaintext = digest(originalDigest);
        return await guarded(async (client, abortSignal) => {
          const response = await client.send(
            new EncryptCommand({
              KeyId: activeKey,
              EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
              EncryptionContext: context(scope),
              Plaintext: plaintext,
            }),
            { abortSignal },
          );
          if (!response || typeof response !== "object") throw unavailable();
          const reply = response as Record<string, unknown>;
          if (
            reply.KeyId !== activeKey ||
            reply.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT" ||
            !(reply.CiphertextBlob instanceof Uint8Array) ||
            reply.CiphertextBlob.byteLength < 1 ||
            reply.CiphertextBlob.byteLength > 6144
          )
            throw unavailable();
          return Object.freeze({
            schemaVersion: 1 as const,
            encryptionKeyArn: activeKey,
            ciphertext: Uint8Array.from(reply.CiphertextBlob),
          });
        });
      } catch {
        throw unavailable();
      } finally {
        plaintext?.fill(0);
      }
    },

    async matches(
      input: LegacyReceiptScope,
      envelope: LegacyReceiptEnvelope,
      candidateDigest: string,
    ) {
      let candidate: Buffer | undefined;
      let plaintext: Uint8Array | undefined;
      try {
        const scope = fixedScope(input);
        candidate = digest(candidateDigest);
        closed(envelope, ["schemaVersion", "encryptionKeyArn", "ciphertext"]);
        if (
          envelope.schemaVersion !== 1 ||
          !permittedKeys.has(envelope.encryptionKeyArn) ||
          !(envelope.ciphertext instanceof Uint8Array) ||
          envelope.ciphertext.byteLength < 1 ||
          envelope.ciphertext.byteLength > 6144
        )
          throw unavailable();
        const fixed = structuredClone(envelope);
        return await guarded(async (client, abortSignal) => {
          const response = await client.send(
            new DecryptCommand({
              KeyId: fixed.encryptionKeyArn,
              EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
              EncryptionContext: context(scope),
              CiphertextBlob: fixed.ciphertext,
            }),
            { abortSignal },
          );
          if (!response || typeof response !== "object") throw unavailable();
          const reply = response as Record<string, unknown>;
          if (reply.Plaintext instanceof Uint8Array) plaintext = reply.Plaintext;
          if (
            reply.KeyId !== fixed.encryptionKeyArn ||
            reply.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT" ||
            !plaintext ||
            plaintext.byteLength !== 64 ||
            !plaintext.every((byte) => (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102))
          )
            throw unavailable();
          return timingSafeEqual(plaintext, candidate as Buffer);
        });
      } catch {
        throw unavailable();
      } finally {
        plaintext?.fill(0);
        candidate?.fill(0);
      }
    },
  });
}
