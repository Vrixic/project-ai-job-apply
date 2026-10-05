import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type {
  RestrictedPacketCipher,
  RestrictedPacketEnvelope,
  RestrictedPacketFingerprint,
  RestrictedPacketScope,
} from "@ai-job-apply/applications-service";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  KMSClient,
} from "@aws-sdk/client-kms";

const MAX_BYTES = 800_000;
const MAX_KMS_MS = 10_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const KEY = /^arn:aws:kms:([a-z]{2}-[a-z]+-\d):([0-9]{12}):key\/([a-f0-9-]{36})$/u;
const unavailable = () => Error("RestrictedPacketProtectionUnavailable");

interface TestClient {
  send(command: unknown, options: { abortSignal: AbortSignal }): Promise<unknown>;
}

/** Validate data properties without evaluating getters or accepting hidden payload fields. */
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

function fixedScope(input: RestrictedPacketScope): RestrictedPacketScope {
  closed(input, ["ownerUserId", "applicationId", "protectionId", "metadataSha256"]);
  if (
    ![input.ownerUserId, input.applicationId, input.protectionId].every(
      (value) => typeof value === "string" && UUID.test(value),
    ) ||
    typeof input.metadataSha256 !== "string" ||
    !HASH.test(input.metadataSha256)
  )
    throw unavailable();
  return Object.freeze({ ...input });
}

function context(scope: RestrictedPacketScope): Record<string, string> {
  return {
    purpose: "restricted-application-packet.v1",
    owner_user_id: scope.ownerUserId,
    application_id: scope.applicationId,
    protection_id: scope.protectionId,
    metadata_sha256: scope.metadataSha256,
  };
}

function aad(scope: RestrictedPacketScope): Buffer {
  return Buffer.from(JSON.stringify(context(scope)), "utf8");
}

function bytes(value: unknown, minimum: number, maximum = minimum): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength >= minimum && value.byteLength <= maximum;
}

/** Dedicated restricted boundary. No runtime composition enables this factory yet. Real KMS
 * calls are signed, fixed-region/endpoint, one-attempt and contain no candidate value body.
 * Actual pending SDK promises retain admission even after abort/deadline. SQL callers must
 * prepare protection BEFORE opening a transaction and decrypt only after releasing locks. */
export function createRestrictedPacketKmsCipher(options: {
  encryptionKeyArn: string;
  fingerprintKeyArn: string;
  enabled?: () => boolean;
  testClient?: TestClient;
}): RestrictedPacketCipher {
  const encryptionKeyArn = options.encryptionKeyArn;
  const fingerprintKeyArn = options.fingerprintKeyArn;
  const encryption = KEY.exec(encryptionKeyArn);
  const fingerprint = KEY.exec(fingerprintKeyArn);
  if (
    !encryption ||
    !fingerprint ||
    !UUID.test(encryption[3] ?? "") ||
    !UUID.test(fingerprint[3] ?? "") ||
    encryption[1] !== fingerprint[1] ||
    encryption[2] !== fingerprint[2] ||
    encryptionKeyArn === fingerprintKeyArn ||
    (options.testClient && process.env.NODE_ENV !== "test")
  )
    throw unavailable();
  const region = encryption[1] as string;
  const enabled = options.enabled ?? (() => false);
  const testClient = options.testClient;
  let client: TestClient | undefined;
  let active = false;
  const permitted = () => {
    if (!enabled() || (testClient && process.env.NODE_ENV !== "test")) throw unavailable();
  };
  async function guarded<T>(
    run: (sender: TestClient, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let result: T | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let admitted = false;
    try {
      permitted();
      if (active) throw unavailable();
      active = true;
      admitted = true;
      client ??=
        testClient ??
        new KMSClient({
          region,
          endpoint: `https://kms.${region}.amazonaws.com`,
          ignoreConfiguredEndpointUrls: true,
          maxAttempts: 1,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
      const started = process.hrtime.bigint();
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), MAX_KMS_MS);
      timer.unref();
      result = await run(client, controller.signal);
      permitted();
      if (
        controller.signal.aborted ||
        process.hrtime.bigint() - started >= BigInt(MAX_KMS_MS) * 1_000_000n
      )
        throw unavailable();
      return result;
    } catch {
      if (result instanceof Uint8Array) result.fill(0);
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      if (admitted) active = false;
    }
  }

  return Object.freeze({
    async encrypt(
      input: RestrictedPacketScope,
      plaintext: Uint8Array,
    ): Promise<RestrictedPacketEnvelope> {
      let original: Buffer | undefined;
      let key: Uint8Array | undefined;
      try {
        permitted();
        const scope = fixedScope(input);
        if (!bytes(plaintext, 1, MAX_BYTES)) throw unavailable();
        original = Buffer.from(plaintext);
        return await guarded(async (sender, abortSignal) => {
          const output = await sender.send(
            new GenerateDataKeyCommand({
              KeyId: encryptionKeyArn,
              KeySpec: "AES_256",
              EncryptionContext: context(scope),
            }),
            { abortSignal },
          );
          if (!output || typeof output !== "object") throw unavailable();
          const reply = output as Record<string, unknown>;
          if (reply.Plaintext instanceof Uint8Array) key = reply.Plaintext;
          if (
            reply.KeyId !== encryptionKeyArn ||
            !bytes(key, 32) ||
            !bytes(reply.CiphertextBlob, 1, 6144)
          )
            throw unavailable();
          permitted();
          if (abortSignal.aborted) throw unavailable();
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(aad(scope));
          const ciphertext = Buffer.concat([cipher.update(original as Buffer), cipher.final()]);
          return Object.freeze({
            schemaVersion: 1 as const,
            encryptionKeyArn,
            encryptedDataKey: Uint8Array.from(reply.CiphertextBlob),
            iv: Uint8Array.from(iv),
            ciphertext,
            authenticationTag: Uint8Array.from(cipher.getAuthTag()),
          });
        });
      } catch {
        throw unavailable();
      } finally {
        original?.fill(0);
        key?.fill(0);
      }
    },

    async decrypt(
      input: RestrictedPacketScope,
      envelope: RestrictedPacketEnvelope,
    ): Promise<Uint8Array> {
      let key: Uint8Array | undefined;
      let partial: Buffer | undefined;
      try {
        permitted();
        const scope = fixedScope(input);
        closed(envelope, [
          "schemaVersion",
          "encryptionKeyArn",
          "encryptedDataKey",
          "iv",
          "ciphertext",
          "authenticationTag",
        ]);
        if (
          envelope.schemaVersion !== 1 ||
          envelope.encryptionKeyArn !== encryptionKeyArn ||
          !bytes(envelope.encryptedDataKey, 1, 6144) ||
          !bytes(envelope.iv, 12) ||
          !bytes(envelope.ciphertext, 1, MAX_BYTES) ||
          !bytes(envelope.authenticationTag, 16)
        )
          throw unavailable();
        const fixed = structuredClone(envelope);
        return await guarded(async (sender, abortSignal) => {
          const output = await sender.send(
            new DecryptCommand({
              KeyId: encryptionKeyArn,
              CiphertextBlob: fixed.encryptedDataKey,
              EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
              EncryptionContext: context(scope),
            }),
            { abortSignal },
          );
          if (!output || typeof output !== "object") throw unavailable();
          const reply = output as Record<string, unknown>;
          if (reply.Plaintext instanceof Uint8Array) key = reply.Plaintext;
          if (
            reply.KeyId !== encryptionKeyArn ||
            reply.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT" ||
            !bytes(key, 32)
          )
            throw unavailable();
          permitted();
          if (abortSignal.aborted) throw unavailable();
          const decipher = createDecipheriv("aes-256-gcm", key, fixed.iv);
          decipher.setAAD(aad(scope));
          decipher.setAuthTag(fixed.authenticationTag);
          partial = decipher.update(fixed.ciphertext);
          const final = decipher.final();
          const plaintext = Buffer.concat([partial, final]);
          final.fill(0);
          return plaintext;
        });
      } catch {
        throw unavailable();
      } finally {
        partial?.fill(0);
        key?.fill(0);
      }
    },

    async fingerprint(input: RestrictedPacketFingerprint): Promise<string> {
      try {
        permitted();
        closed(input, ["ownerUserId", "applicationId", "operation", "requestSha256"]);
        if (
          ![input.ownerUserId, input.applicationId].every(
            (value) => typeof value === "string" && UUID.test(value),
          ) ||
          !["create_packet", "queue_preparation"].includes(input.operation) ||
          typeof input.requestSha256 !== "string" ||
          !HASH.test(input.requestSha256)
        )
          throw unavailable();
        const message = Buffer.from(
          JSON.stringify([
            "restricted-packet-request.v1",
            input.ownerUserId,
            input.applicationId,
            input.operation,
            input.requestSha256,
          ]),
          "utf8",
        );
        return await guarded(async (sender, abortSignal) => {
          const output = await sender.send(
            new GenerateMacCommand({
              KeyId: fingerprintKeyArn,
              MacAlgorithm: "HMAC_SHA_256",
              Message: message,
            }),
            { abortSignal },
          );
          if (!output || typeof output !== "object") throw unavailable();
          const reply = output as Record<string, unknown>;
          if (
            reply.KeyId !== fingerprintKeyArn ||
            reply.MacAlgorithm !== "HMAC_SHA_256" ||
            !bytes(reply.Mac, 32)
          )
            throw unavailable();
          return Buffer.from(reply.Mac).toString("hex");
        });
      } catch {
        throw unavailable();
      }
    },
  });
}
