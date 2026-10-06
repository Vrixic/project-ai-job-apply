import type { FieldValue } from "./field-policy.js";

/** Private Applications value-protection port. No database, provider or general key capability.
 * Implementations must use a restricted-data encryption key and a distinct keyed fingerprint
 * authority. Plain request/packet digests cannot protect low-entropy candidate answers. */
export interface RestrictedPacketScope {
  ownerUserId: string;
  applicationId: string;
  protectionId: string;
  /** Digest of value-free field identities, provenance, policy and exact question context. */
  metadataSha256: string;
}

export interface RestrictedPacketEnvelope {
  schemaVersion: 1;
  encryptionKeyArn: string;
  encryptedDataKey: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  authenticationTag: Uint8Array;
}

export interface RestrictedPacketFingerprint {
  ownerUserId: string;
  applicationId: string;
  operation: "create_packet" | "queue_preparation";
  /** Ephemeral request digest: never persist it alongside low-entropy candidate values. */
  requestSha256: string;
}

export interface RestrictedPacketCipher {
  encrypt(scope: RestrictedPacketScope, plaintext: Uint8Array): Promise<RestrictedPacketEnvelope>;
  /** Caller owns the returned bytes and must clear them after its immediate decoder/consumer. */
  decrypt(scope: RestrictedPacketScope, envelope: RestrictedPacketEnvelope): Promise<Uint8Array>;
  /** Replay may select only an explicitly configured original MAC key; omission uses the active key. */
  fingerprint(input: RestrictedPacketFingerprint, originalKeyArn?: string): Promise<string>;
}

/** Value-free immutable identity carried by private packet metadata, never a plaintext digest. */
export interface RestrictedPacketBinding {
  id: string;
  metadataSha256: string;
  ciphertextSha256: string;
}

/** Immediate owning read result; never persisted or substituted into an ApplicationPacket. */
export interface RestrictedPacketPlaintext {
  ownerUserId: string;
  applicationId: string;
  packetId: string;
  packetHash: string;
  values: ReadonlyMap<string, FieldValue>;
}
