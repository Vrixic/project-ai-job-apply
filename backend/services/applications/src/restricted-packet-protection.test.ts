import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "./canonical.js";
import type { FieldDefinition } from "./field-policy.js";
import {
  assemblePacket,
  computePacketHash,
  type PacketFieldEntry,
  verifyPacketHash,
} from "./packet.js";
import type { RestrictedPacketCipher, RestrictedPacketScope } from "./restricted-packet-cipher.js";
import {
  createRestrictedPacketProtection,
  type PreparedRestrictedPacketFields,
} from "./restricted-packet-protection.js";
import {
  APPLICATION_ID,
  definitions,
  FACT_A,
  HASH_A,
  HASH_B,
  PACKET_ID,
  packetInputs,
  proposal,
  USER_ID,
} from "./test-support.js";

const context = {
  ownerUserId: USER_ID,
  applicationId: APPLICATION_ID,
  jobRevision: HASH_A,
  form: { adapterId: "greenhouse", variantId: "synthetic-v1", formHash: HASH_B },
};
const keyArn = "arn:aws:kms:us-east-1:111111111111:key/11111111-1111-4111-8111-111111111111";
function fields(): readonly PacketFieldEntry[] {
  return assemblePacket(
    packetInputs({
      fields: [
        proposal(),
        proposal({
          fieldKey: "authorization.us_authorized",
          value: true,
          origin: "user_entered",
          sourceFactIds: [],
        }),
      ],
    }),
    definitions,
  ).fields;
}
/** Real offline AES-GCM validates binding independently of the storage codec; no KMS/SQL. */
function fixture(
  overrides: { enabled?: () => boolean; definitions?: ReadonlyMap<string, FieldDefinition> } = {},
) {
  const key = randomBytes(32);
  let encryptedBytes: Uint8Array | undefined;
  let decryptedBytes: Uint8Array | undefined;
  const cipher: RestrictedPacketCipher = {
    encrypt: vi.fn(async (scope: RestrictedPacketScope, plaintext: Uint8Array) => {
      encryptedBytes = plaintext;
      const iv = randomBytes(12);
      const aes = createCipheriv("aes-256-gcm", key, iv);
      aes.setAAD(Buffer.from(canonicalJson(scope)));
      return {
        schemaVersion: 1 as const,
        encryptionKeyArn: keyArn,
        encryptedDataKey: randomBytes(40),
        iv,
        ciphertext: Buffer.concat([aes.update(plaintext), aes.final()]),
        authenticationTag: aes.getAuthTag(),
      };
    }),
    decrypt: vi.fn(async (scope, envelope) => {
      const aes = createDecipheriv("aes-256-gcm", key, envelope.iv);
      aes.setAAD(Buffer.from(canonicalJson(scope)));
      aes.setAuthTag(Buffer.from(envelope.authenticationTag));
      decryptedBytes = Buffer.concat([aes.update(envelope.ciphertext), aes.final()]);
      return decryptedBytes;
    }),
    fingerprint: vi.fn(async () => HASH_A),
  };
  const codec = createRestrictedPacketProtection({
    cipher,
    definitions: overrides.definitions ?? definitions,
    enabled: overrides.enabled ?? (() => true),
  });
  return { codec, cipher, encrypted: () => encryptedBytes, decrypted: () => decryptedBytes };
}
async function prepared(f: ReturnType<typeof fixture>): Promise<PreparedRestrictedPacketFields> {
  const result = await f.codec.prepare(context, PACKET_ID, fields());
  if (!result) throw Error("Missing fixture");
  return result;
}
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw Error("Missing synthetic fixture");
  return value;
}
const refused = "RestrictedPacketProtectionUnavailable";

describe("restricted packet value boundary", () => {
  it("keeps only opaque metadata in the packet and returns exact answers in a separate immediate map", async () => {
    const f = fixture();
    const original = fields();
    const record = await prepared(f);
    const protectedField = record.fields.find(
      (field) => field.fieldKey === "authorization.us_authorized",
    );
    expect(protectedField).toMatchObject({
      value: null,
      protectedValue: true,
      requiresReview: true,
    });
    expect(record.fields.find((field) => field.fieldKey === "contact.email")).toEqual(
      original.find((field) => field.fieldKey === "contact.email"),
    );
    expect(original.find((field) => field.fieldKey === "authorization.us_authorized")?.value).toBe(
      true,
    );
    expect(f.encrypted()?.every((byte) => byte === 0)).toBe(true);
    expect(await f.codec.read(context, record)).toEqual(
      new Map([["authorization.us_authorized", true]]),
    );
    expect(f.decrypted()?.every((byte) => byte === 0)).toBe(true);
    expect(protectedField?.value).toBeNull();
    expect(f.cipher.fingerprint).not.toHaveBeenCalled();
  });
  it("binds an exact owning prepare result without cipher effects or mixing plaintext into metadata", async () => {
    const f = fixture();
    const packet = assemblePacket(
      packetInputs({
        fields: [
          proposal(),
          proposal({
            fieldKey: "authorization.us_authorized",
            value: true,
            origin: "user_entered",
            sourceFactIds: [],
          }),
        ],
      }),
      definitions,
    );
    const record = must(await f.codec.prepare(context, PACKET_ID, packet.fields));
    const bound = f.codec.bind(packet, record);
    expect(verifyPacketHash(bound)).toBe(true);
    expect(bound.packetHash).not.toBe(packet.packetHash);
    expect(bound.fields.find((field) => field.protectedValue)?.value).toBeNull();
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(bound.fields)).toBe(true);
    expect(Object.keys(bound.restrictedValues ?? {}).sort()).toEqual([
      "ciphertextSha256",
      "id",
      "metadataSha256",
    ]);
    expect(f.cipher.encrypt).toHaveBeenCalledTimes(1);
    expect(f.cipher.decrypt).not.toHaveBeenCalled();
    expect(f.cipher.fingerprint).not.toHaveBeenCalled();
    must(record.fields.find((field) => field.protectedValue)).reasons = [];
    expect(verifyPacketHash(bound)).toBe(true);
  });
  it.each(["answer", "context", "cloned result", "changed result", "forged original hash"])(
    "refuses pre-lock preparation mismatch: %s",
    async (kind) => {
      const f = fixture();
      const initial = assemblePacket(
        packetInputs({
          fields: [
            proposal(),
            proposal({
              fieldKey: "authorization.us_authorized",
              value: true,
              origin: "user_entered",
              sourceFactIds: [],
            }),
          ],
        }),
        definitions,
      );
      let record = must(await f.codec.prepare(context, PACKET_ID, initial.fields));
      const packet = structuredClone(initial);
      if (kind === "answer")
        must(
          packet.fields.find((field) => field.fieldKey === "authorization.us_authorized"),
        ).value = false;
      if (kind === "context") packet.jobRevision = HASH_B;
      if (kind === "cloned result") record = structuredClone(record);
      if (kind === "changed result")
        record.binding = { ...record.binding, ciphertextSha256: HASH_A };
      packet.packetHash = kind === "forged original hash" ? HASH_A : computePacketHash(packet);
      await expect(async () => f.codec.bind(packet, record)).rejects.toThrow(refused);
      expect(f.cipher.decrypt).not.toHaveBeenCalled();
      expect(f.cipher.encrypt).toHaveBeenCalledTimes(1);
    },
  );
  async function originalForCarry(f: ReturnType<typeof fixture>) {
    const original = assemblePacket(
      packetInputs({
        fields: [
          proposal(),
          proposal({
            fieldKey: "authorization.us_authorized",
            value: true,
            origin: "user_entered",
            sourceFactIds: [],
          }),
        ],
      }),
      definitions,
    );
    const record = must(await f.codec.prepare(context, PACKET_ID, original.fields));
    return { record, base: f.codec.bind(original, record) };
  }
  it("carries exact original protected metadata without crypto or renewed values", async () => {
    const f = fixture();
    const { record, base } = await originalForCarry(f);
    const candidate = assemblePacket(packetInputs({ version: 2 }), definitions);
    const next = f.codec.carry(candidate, base);
    expect(next.restrictedValues).toEqual(base.restrictedValues);
    expect(next.packetHash).not.toBe(base.packetHash);
    expect(verifyPacketHash(next)).toBe(true);
    expect(next.fields.find((field) => field.protectedValue)).toEqual(
      base.fields.find((field) => field.protectedValue),
    );
    expect(f.cipher.encrypt).toHaveBeenCalledTimes(1);
    expect(f.cipher.decrypt).not.toHaveBeenCalled();
    expect(f.cipher.fingerprint).not.toHaveBeenCalled();
    expect(await f.codec.read(context, { ...record, fields: next.fields })).toEqual(
      new Map([["authorization.us_authorized", true]]),
    );
  });
  it.each(["owner", "job", "version", "overlap", "new restricted value", "base metadata"])(
    "refuses changed preparation carry-forward: %s",
    async (kind) => {
      const f = fixture();
      const original = await originalForCarry(f);
      const base = structuredClone(original.base);
      const candidate = structuredClone(assemblePacket(packetInputs({ version: 2 }), definitions));
      if (kind === "owner") candidate.userId = FACT_A;
      if (kind === "job") candidate.jobRevision = HASH_B;
      if (kind === "version") candidate.version = base.version;
      if (kind === "overlap" || kind === "new restricted value") {
        const field = must(base.fields.find((field) => field.protectedValue));
        candidate.fields = [
          ...candidate.fields,
          { ...field, value: kind === "overlap" ? null : false },
        ];
        const added = must(candidate.fields.at(-1));
        delete added.protectedValue;
      }
      if (kind === "base metadata") {
        const field = must(base.fields.find((field) => field.protectedValue));
        field.confidence = 0.8;
        base.packetHash = computePacketHash(base);
      }
      candidate.packetHash = computePacketHash(candidate);
      expect(() => f.codec.carry(candidate, base)).toThrow(refused);
      expect(f.cipher.encrypt).toHaveBeenCalledTimes(1);
      expect(f.cipher.decrypt).not.toHaveBeenCalled();
    },
  );
  it("uses randomized ciphertext identities for identical low-entropy answers", async () => {
    const f = fixture();
    const first = await prepared(f);
    const second = await prepared(f);
    expect(first.binding.metadataSha256).toBe(second.binding.metadataSha256);
    expect(first.binding.ciphertextSha256).not.toBe(second.binding.ciphertextSha256);
    expect(await f.codec.read(context, first)).toEqual(await f.codec.read(context, second));
  });
  it("defaults off for sensitive values but permits normal packets without touching crypto", async () => {
    const f = fixture();
    const codec = createRestrictedPacketProtection({ cipher: f.cipher, definitions });
    await expect(codec.prepare(context, PACKET_ID, fields())).rejects.toThrow(refused);
    expect(
      await codec.prepare(
        context,
        PACKET_ID,
        fields().filter((field) => field.fieldKey === "contact.email"),
      ),
    ).toBeNull();
    expect(f.cipher.encrypt).not.toHaveBeenCalled();
  });
  it("protects selected confidential vault values and binds their exact provenance", async () => {
    const f = fixture();
    const reference = {
      id: FACT_A,
      version: 1,
      context: "US",
      questionHash: HASH_A,
      meaningConfirmed: true as const,
      validUntilEpochMs: null,
    };
    const selected = assemblePacket(
      packetInputs({
        fields: [
          proposal({ origin: "answer_vault", vaultReference: reference, sourceFactIds: [FACT_A] }),
        ],
      }),
      definitions,
    ).fields;
    const record = await f.codec.prepare(context, PACKET_ID, selected);
    expect(record?.fields[0]).toMatchObject({
      value: null,
      protectedValue: true,
      vaultReference: reference,
    });
    expect(await f.codec.read(context, must(record))).toEqual(
      new Map([["contact.email", "candidate@example.test"]]),
    );
    const changed = structuredClone(must(record));
    must(must(changed.fields[0]).vaultReference).version = 2;
    await expect(f.codec.read(context, changed)).rejects.toThrow(refused);
  });
  it.each(["ownerUserId", "applicationId", "jobRevision", "form"] as const)(
    "refuses moving values to another %s",
    async (part) => {
      const f = fixture();
      const record = await prepared(f);
      const altered = structuredClone(context);
      if (part === "form") altered.form.formHash = "c".repeat(64);
      else altered[part] = part === "jobRevision" ? HASH_B : FACT_A;
      await expect(f.codec.read(altered, record)).rejects.toThrow(refused);
      expect(f.cipher.decrypt).not.toHaveBeenCalled();
    },
  );
  it("binds policy and takes a configuration snapshot against later caller mutation", async () => {
    const mutable = new Map(
      [...definitions].map(([key, definition]) => [key, structuredClone(definition)]),
    );
    const f = fixture({ definitions: mutable });
    const record = await prepared(f);
    must(mutable.get("authorization.us_authorized")).answerPolicy = "confirmed_fact";
    expect(await f.codec.read(context, record)).toEqual(
      new Map([["authorization.us_authorized", true]]),
    );
    const newCodec = createRestrictedPacketProtection({
      cipher: f.cipher,
      definitions: mutable,
      enabled: () => true,
    });
    await expect(newCodec.read(context, record)).rejects.toThrow(refused);
  });
  it.each(["extra", "hidden", "getter", "symbol", "array getter", "context body"])(
    "refuses %s before clone or crypto",
    async (kind) => {
      const f = fixture();
      const entries = structuredClone(fields());
      const owner = structuredClone(context);
      const getter = vi.fn(() => "SYNTHETIC_RESTRICTED_BODY");
      const target = must(entries[0]);
      if (kind === "extra") Object.assign(target, { rawBody: "SYNTHETIC_RESTRICTED_BODY" });
      if (kind === "hidden")
        Object.defineProperty(target, "rawBody", { value: "SYNTHETIC_RESTRICTED_BODY" });
      if (kind === "getter")
        Object.defineProperty(target, "value", { enumerable: true, get: getter });
      if (kind === "symbol")
        Object.assign(target, { [Symbol("body")]: "SYNTHETIC_RESTRICTED_BODY" });
      if (kind === "array getter")
        Object.defineProperty(entries, "0", { enumerable: true, get: getter });
      if (kind === "context body") Object.assign(owner, { rawBody: "SYNTHETIC_RESTRICTED_BODY" });
      await expect(f.codec.prepare(owner, PACKET_ID, entries)).rejects.toThrow(refused);
      expect(getter).not.toHaveBeenCalled();
      expect(f.cipher.encrypt).not.toHaveBeenCalled();
    },
  );
  it.each([
    "auto",
    "user_action",
    "inferred",
    "missing review",
    "invalid confidence",
    "missing reason",
    "wrong type",
    "duplicate",
    "marker",
  ])("refuses invalid owning policy: %s", async (kind) => {
    const f = fixture();
    const entries = structuredClone(fields());
    const field = must(entries.find((entry) => entry.fieldKey === "authorization.us_authorized"));
    if (kind === "auto") field.disposition = "auto";
    if (kind === "user_action") field.disposition = "user_action";
    if (kind === "inferred") field.origin = "derived";
    if (kind === "missing review") field.requiresReview = false;
    if (kind === "invalid confidence") field.confidence = 2;
    if (kind === "missing reason") field.reasons = [];
    if (kind === "wrong type") field.value = "true";
    if (kind === "duplicate") (entries as PacketFieldEntry[]).push(structuredClone(field));
    if (kind === "marker") Object.assign(field, { protectedValue: true });
    await expect(f.codec.prepare(context, PACKET_ID, entries)).rejects.toThrow(refused);
    expect(f.cipher.encrypt).not.toHaveBeenCalled();
  });
  it("refuses durable document material even if a caller misclassifies the document field", async () => {
    const changed = new Map(definitions);
    changed.set("documents.cover_letter", {
      key: "documents.cover_letter",
      label: "Synthetic",
      valueType: "text",
      sensitivity: "restricted",
      answerPolicy: "explicit_each_time",
    });
    const f = fixture({ definitions: changed });
    const field = structuredClone(
      must(fields().find((entry) => entry.fieldKey === "authorization.us_authorized")),
    );
    Object.assign(field, {
      fieldKey: "documents.cover_letter",
      value: "SYNTHETIC_DOCUMENT_BODY",
      reasons: ["restricted_answer", "explicit_each_time"],
    });
    await expect(f.codec.prepare(context, PACKET_ID, [field])).rejects.toThrow(refused);
    expect(f.cipher.encrypt).not.toHaveBeenCalled();
  });
  it.each(["ciphertext", "binding", "plaintext", "extra", "policy"])(
    "refuses stored %s corruption without decrypting",
    async (kind) => {
      const f = fixture();
      const record = await prepared(f);
      const field = must(record.fields.find((entry) => entry.protectedValue));
      if (kind === "ciphertext")
        record.envelope.ciphertext[0] = (record.envelope.ciphertext[0] ?? 0) ^ 1;
      if (kind === "binding") record.binding = { ...record.binding, id: "invalid" };
      if (kind === "plaintext") field.value = true;
      if (kind === "extra") Object.assign(field, { rawBody: "SYNTHETIC_BODY" });
      if (kind === "policy") field.reasons = ["restricted_answer"];
      await expect(f.codec.read(context, record)).rejects.toThrow(refused);
      expect(f.cipher.decrypt).not.toHaveBeenCalled();
    },
  );
  it.each([
    '{"schemaVersion":1,"values":[]}',
    '{"schemaVersion":2,"values":[{"fieldKey":"authorization.us_authorized","value":true}]}',
    '{"schemaVersion":1,"values":[{"fieldKey":"contact.email","value":true}]}',
    '{"schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":null}]}',
    '{"schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":"true"}]}',
    '{"schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":true,"body":"bad"}]}',
    "not-json",
    '{"schemaVersion":1,"schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":true}]}',
    '{"schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":false,"value":true}]}',
    '{ "schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":true}]}',
  ])("withholds malformed decrypted representation %# and clears bytes", async (text) => {
    const f = fixture();
    const record = await prepared(f);
    const bytes = Buffer.from(text);
    vi.mocked(f.cipher.decrypt).mockResolvedValue(bytes);
    await expect(f.codec.read(context, record)).rejects.toThrow(refused);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("rejects malformed UTF-8 rather than replacing it", async () => {
    const f = fixture();
    const record = await prepared(f);
    const bytes = Uint8Array.of(0xc0, 0xaf);
    vi.mocked(f.cipher.decrypt).mockResolvedValue(bytes);
    await expect(f.codec.read(context, record)).rejects.toThrow(refused);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("withholds and clears a decrypt result when disabled during the await", async () => {
    let active = true;
    const f = fixture({ enabled: () => active });
    const record = await prepared(f);
    const bytes = Buffer.from(
      '{"schemaVersion":1,"values":[{"fieldKey":"authorization.us_authorized","value":true}]}',
    );
    vi.mocked(f.cipher.decrypt).mockImplementation(async () => {
      active = false;
      return bytes;
    });
    await expect(f.codec.read(context, record)).rejects.toThrow(refused);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("captures original context/metadata before an asynchronous encryption result", async () => {
    const f = fixture();
    const entries = structuredClone(fields());
    const owner = structuredClone(context);
    const transport = fixture();
    vi.mocked(f.cipher.encrypt).mockImplementation(async (scope, bytes) => {
      owner.form.formHash = HASH_A;
      must(entries.find((field) => field.fieldKey === "authorization.us_authorized")).value = false;
      return transport.cipher.encrypt(scope, bytes);
    });
    vi.mocked(f.cipher.decrypt).mockImplementation(transport.cipher.decrypt);
    const record = must(await f.codec.prepare(owner, PACKET_ID, entries));
    expect(await f.codec.read(context, record)).toEqual(
      new Map([["authorization.us_authorized", true]]),
    );
    await expect(f.codec.read(owner, record)).rejects.toThrow(refused);
  });
  it("clears encryption input on provider refusal and exposes only a fixed error", async () => {
    const f = fixture();
    let bytes: Uint8Array | undefined;
    vi.mocked(f.cipher.encrypt).mockImplementation(async (_scope, body) => {
      bytes = body;
      throw Error("SYNTHETIC_PROVIDER_BODY");
    });
    await expect(f.codec.prepare(context, PACKET_ID, fields())).rejects.toThrow(refused);
    expect(bytes?.every((byte) => byte === 0)).toBe(true);
  });
});
