import { canonicalHash, canonicalJson } from "./canonical.js";
import { type FieldDefinition, type FieldValue, isDirectActionField } from "./field-policy.js";
import {
  type ApplicationPacket,
  computePacketHash,
  type FormBinding,
  type PacketFieldEntry,
  valueMatchesDefinition,
  verifyPacketHash,
} from "./packet.js";
import type {
  RestrictedPacketBinding,
  RestrictedPacketCipher,
  RestrictedPacketEnvelope,
  RestrictedPacketScope,
} from "./restricted-packet-cipher.js";
import { validVaultReference } from "./vault.js";

/** Private storage metadata only. Immediate owner/adapter plaintext is a separate value map,
 * never inserted into an ApplicationPacket used for hashing or admission. */
export interface ProtectedPacketField extends PacketFieldEntry {
  protectedValue?: true;
}
export type { RestrictedPacketBinding } from "./restricted-packet-cipher.js";
export interface PreparedRestrictedPacketFields {
  fields: readonly ProtectedPacketField[];
  binding: RestrictedPacketBinding;
  envelope: RestrictedPacketEnvelope;
}
interface PacketContext {
  ownerUserId: string;
  applicationId: string;
  jobRevision: string;
  form: FormBinding | null;
}
const unavailable = () => Error("RestrictedPacketProtectionUnavailable");
const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MAX_BYTES = 800_000;

/** Reject accessors, hidden/symbol properties and unmodelled bodies before any clone reads them. */
function closed(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || ![...required, ...optional].includes(key),
    ) ||
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some((entry) => !entry.enumerable || !("value" in entry))
  )
    throw unavailable();
}
function list(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    throw unavailable();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)),
    )
  )
    throw unavailable();
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry?.enumerable || !("value" in entry)) throw unavailable();
  }
}
function validateContext(context: PacketContext) {
  closed(context, ["ownerUserId", "applicationId", "jobRevision", "form"]);
  if (context.form !== null) {
    closed(context.form, ["adapterId", "variantId", "formHash"]);
    if (
      ![context.form.adapterId, context.form.variantId].every(
        (value) => typeof value === "string" && /^[a-zA-Z0-9._-]{1,120}$/u.test(value),
      ) ||
      !HASH.test(context.form.formHash)
    )
      throw unavailable();
  }
}
function validateShape(field: ProtectedPacketField, protectedAllowed: boolean) {
  closed(
    field,
    [
      "fieldKey",
      "value",
      "origin",
      "sourceFactIds",
      "confidence",
      "disposition",
      "reasons",
      "requiresReview",
    ],
    ["vaultReference", ...(protectedAllowed ? ["protectedValue"] : [])],
  );
  if (
    typeof field.fieldKey !== "string" ||
    !/^[a-z][a-z0-9_.]{0,119}$/u.test(field.fieldKey) ||
    !["confirmed_fact", "answer_vault", "user_entered", "generated", "derived"].includes(
      field.origin,
    ) ||
    !["auto", "review", "user_action"].includes(field.disposition) ||
    typeof field.requiresReview !== "boolean" ||
    !Number.isFinite(field.confidence) ||
    field.confidence < 0 ||
    field.confidence > 1 ||
    (Object.hasOwn(field, "protectedValue") && field.protectedValue !== true)
  )
    throw unavailable();
  list(field.sourceFactIds);
  list(field.reasons);
  if (
    !field.sourceFactIds.every((value) => typeof value === "string" && UUID.test(value)) ||
    !field.reasons.every((value) =>
      [
        "restricted_answer",
        "explicit_each_time",
        "never_infer",
        "unsupported_value",
        "unconfirmed_source",
        "low_confidence",
        "generated_content",
        "unknown_field",
        "direct_user_action",
      ].includes(value),
    )
  )
    throw unavailable();
  const value = field.value;
  if (Array.isArray(value)) list(value);
  if (
    !(
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)) ||
      (Array.isArray(value) &&
        value.every(
          (item) =>
            typeof item === "string" ||
            typeof item === "boolean" ||
            (typeof item === "number" && Number.isFinite(item)),
        ))
    )
  )
    throw unavailable();
  if (Object.hasOwn(field, "vaultReference")) {
    closed(field.vaultReference, [
      "id",
      "version",
      "context",
      "questionHash",
      "meaningConfirmed",
      "validUntilEpochMs",
    ]);
    if (
      !field.vaultReference ||
      !validVaultReference(field.vaultReference) ||
      field.origin !== "answer_vault" ||
      field.sourceFactIds.length !== 1 ||
      field.sourceFactIds[0] !== field.vaultReference.id
    )
      throw unavailable();
  }
}
function validateEnvelope(envelope: RestrictedPacketEnvelope) {
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
    typeof envelope.encryptionKeyArn !== "string" ||
    !/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9-]{36}$/u.test(envelope.encryptionKeyArn) ||
    !(envelope.encryptedDataKey instanceof Uint8Array) ||
    envelope.encryptedDataKey.byteLength < 1 ||
    envelope.encryptedDataKey.byteLength > 6144 ||
    !(envelope.iv instanceof Uint8Array) ||
    envelope.iv.byteLength !== 12 ||
    !(envelope.authenticationTag instanceof Uint8Array) ||
    envelope.authenticationTag.byteLength !== 16 ||
    !(envelope.ciphertext instanceof Uint8Array) ||
    envelope.ciphertext.byteLength < 1 ||
    envelope.ciphertext.byteLength > MAX_BYTES
  )
    throw unavailable();
}

function isRestricted(field: PacketFieldEntry, definitions: ReadonlyMap<string, FieldDefinition>) {
  return definitions.get(field.fieldKey)?.sensitivity === "restricted" || !!field.vaultReference;
}
function metadata(field: ProtectedPacketField) {
  return {
    fieldKey: field.fieldKey,
    origin: field.origin,
    sourceFactIds: [...field.sourceFactIds].sort(),
    confidence: field.confidence,
    disposition: field.disposition,
    reasons: [...field.reasons].sort(),
    requiresReview: field.requiresReview,
    ...(field.vaultReference ? { vaultReference: { ...field.vaultReference } } : {}),
  };
}
function metadataSha256(
  context: PacketContext,
  fields: readonly ProtectedPacketField[],
  definitions: ReadonlyMap<string, FieldDefinition>,
) {
  return canonicalHash({
    schema: "restricted-packet-metadata.v1",
    ...context,
    fields: fields
      .map((field) => {
        const definition = definitions.get(field.fieldKey);
        if (!definition) throw unavailable();
        return {
          ...metadata(field),
          policy: {
            valueType: definition.valueType,
            sensitivity: definition.sensitivity,
            answerPolicy: definition.answerPolicy,
            ...(definition.allowedValues
              ? { allowedValues: [...definition.allowedValues].sort() }
              : {}),
          },
        };
      })
      .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey)),
  });
}
/** Ciphertext identity is public-safe: it commits to randomized ciphertext, never an answer
 * digest. It binds every envelope component, including the wrapped key and selected key ARN. */
export function restrictedPacketEnvelopeSha256(envelope: RestrictedPacketEnvelope): string {
  validateEnvelope(envelope);
  return canonicalHash({
    schema: "restricted-packet-envelope.v1",
    schemaVersion: envelope.schemaVersion,
    encryptionKeyArn: envelope.encryptionKeyArn,
    encryptedDataKey: Buffer.from(envelope.encryptedDataKey).toString("base64"),
    iv: Buffer.from(envelope.iv).toString("base64"),
    ciphertext: Buffer.from(envelope.ciphertext).toString("base64"),
    authenticationTag: Buffer.from(envelope.authenticationTag).toString("base64"),
  });
}

/** Only owning policy-classified immutable packet fields enter this codec. It supplies no SQL,
 * authorization, approval, export or provider capability. Callers must independently validate
 * owner/current snapshot after awaits, and keep reads separate from metadata-only admission. */
export function createRestrictedPacketProtection(options: {
  cipher: RestrictedPacketCipher;
  definitions: ReadonlyMap<string, FieldDefinition>;
  enabled?: () => boolean;
}) {
  const definitions = new Map(
    [...options.definitions].map(([key, definition]) => [key, structuredClone(definition)]),
  );
  // These ephemeral digests never enter packet/receipt/SQL/export data. They admit only the
  // exact owning prepare result for the exact classified input, including answer values.
  const preparedInputs = new WeakMap<
    PreparedRestrictedPacketFields,
    {
      fieldsSha256: string;
      contextSha256: string;
      resultSha256: string;
    }
  >();
  const preparedSha256 = (record: PreparedRestrictedPacketFields) =>
    canonicalHash({
      fields: record.fields,
      binding: record.binding,
      envelopeSha256: restrictedPacketEnvelopeSha256(record.envelope),
    });
  const enabled = options.enabled ?? (() => false);
  const check = () => {
    if (!enabled()) throw unavailable();
  };
  function scope(context: PacketContext, id: string, sha: string): RestrictedPacketScope {
    if (
      typeof context.ownerUserId !== "string" ||
      typeof context.applicationId !== "string" ||
      typeof context.jobRevision !== "string" ||
      typeof id !== "string" ||
      typeof sha !== "string" ||
      !UUID.test(context.ownerUserId) ||
      !UUID.test(context.applicationId) ||
      !UUID.test(id) ||
      !HASH.test(context.jobRevision) ||
      !HASH.test(sha)
    )
      throw unavailable();
    return {
      ownerUserId: context.ownerUserId,
      applicationId: context.applicationId,
      protectionId: id,
      metadataSha256: sha,
    };
  }
  function validate(field: PacketFieldEntry) {
    const definition = definitions.get(field.fieldKey);
    if (
      !definition ||
      !isRestricted(field, definitions) ||
      !field.requiresReview ||
      (definition.sensitivity === "restricted" && !field.reasons.includes("restricted_answer")) ||
      (definition.answerPolicy === "never_infer" && !field.reasons.includes("never_infer")) ||
      (definition.answerPolicy === "explicit_each_time" &&
        !field.reasons.includes("explicit_each_time")) ||
      field.disposition !== "review" ||
      !Number.isFinite(field.confidence) ||
      !valueMatchesDefinition(definition, field.value) ||
      (definition.answerPolicy === "never_infer" &&
        !["user_entered", "answer_vault"].includes(field.origin)) ||
      (field.vaultReference &&
        (field.origin !== "answer_vault" || isDirectActionField(field.fieldKey))) ||
      field.fieldKey === "documents.resume" ||
      field.fieldKey === "documents.cover_letter"
    )
      throw unavailable();
  }
  return Object.freeze({
    async prepare(
      context: PacketContext,
      id: string,
      input: readonly PacketFieldEntry[],
    ): Promise<PreparedRestrictedPacketFields | null> {
      let bytes: Buffer | undefined;
      try {
        validateContext(context);
        list(input);
        for (const field of input) validateShape(field, false);
        const fields = structuredClone(input) as ProtectedPacketField[];
        const originalFieldsSha256 = canonicalHash(fields);
        if (
          fields.length > 200 ||
          new Set(fields.map((field) => field.fieldKey)).size !== fields.length ||
          fields.some((field) => Object.hasOwn(field, "protectedValue"))
        )
          throw unavailable();
        const selected = fields.filter(
          (field) => isRestricted(field, definitions) && field.value !== null,
        );
        if (!selected.length) return null;
        check();
        selected.forEach(validate);
        if (selected.some((field) => field.vaultReference) && context.form === null)
          throw unavailable();
        const fixedContext = structuredClone(context);
        const digest = metadataSha256(fixedContext, selected, definitions);
        const bindingScope = scope(fixedContext, id, digest);
        bytes = Buffer.from(
          canonicalJson({
            schemaVersion: 1,
            values: selected
              .map((field) => ({ fieldKey: field.fieldKey, value: field.value }))
              .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey)),
          }),
          "utf8",
        );
        if (bytes.byteLength > MAX_BYTES) throw unavailable();
        const response = await options.cipher.encrypt(bindingScope, bytes);
        validateEnvelope(response);
        const envelope = structuredClone(response);
        check();
        for (const field of selected) {
          field.value = null;
          field.protectedValue = true;
        }
        const result = {
          fields,
          binding: Object.freeze({
            id,
            metadataSha256: digest,
            ciphertextSha256: restrictedPacketEnvelopeSha256(envelope),
          }),
          envelope,
        };
        preparedInputs.set(result, {
          fieldsSha256: originalFieldsSha256,
          contextSha256: canonicalHash(fixedContext),
          resultSha256: preparedSha256(result),
        });
        return result;
      } catch {
        throw unavailable();
      } finally {
        bytes?.fill(0);
      }
    },

    /** Synchronous admission after pre-lock encryption: the exact owning result is usable
     * only with the same classified fields/context. A moved, cloned or changed result refuses.
     * No cipher/SQL call occurs here; storage commits this metadata and envelope atomically. */
    bind(packet: ApplicationPacket, original: PreparedRestrictedPacketFields): ApplicationPacket {
      try {
        check();
        const proof = preparedInputs.get(original);
        if (!proof || !verifyPacketHash(packet)) throw unavailable();
        const context = {
          ownerUserId: packet.userId,
          applicationId: packet.applicationId,
          jobRevision: packet.jobRevision,
          form: packet.form,
        };
        validateContext(context);
        list(packet.fields);
        for (const field of packet.fields) validateShape(field, false);
        closed(original, ["fields", "binding", "envelope"]);
        list(original.fields);
        for (const field of original.fields) validateShape(field, true);
        closed(original.binding, ["id", "metadataSha256", "ciphertextSha256"]);
        validateEnvelope(original.envelope);
        if (
          canonicalHash(packet.fields) !== proof.fieldsSha256 ||
          canonicalHash(context) !== proof.contextSha256 ||
          preparedSha256(original) !== proof.resultSha256
        )
          throw unavailable();
        const fields = structuredClone(original.fields);
        for (const field of fields) {
          Object.freeze(field.sourceFactIds);
          Object.freeze(field.reasons);
          if (field.vaultReference) Object.freeze(field.vaultReference);
          if (Array.isArray(field.value)) Object.freeze(field.value);
          Object.freeze(field);
        }
        Object.freeze(fields);
        const content = {
          ...packet,
          fields,
          restrictedValues: Object.freeze({ ...original.binding }),
        };
        return Object.freeze({ ...content, packetHash: computePacketHash(content) });
      } catch {
        throw unavailable();
      }
    },

    /** Original preparation carry-forward: metadata only, no decrypt/re-encrypt or renewed
     * references. The owner transaction must independently admit the exact current base packet. */
    carry(candidate: ApplicationPacket, base: ApplicationPacket): ApplicationPacket {
      try {
        check();
        if (
          !verifyPacketHash(candidate) ||
          !verifyPacketHash(base) ||
          !base.restrictedValues ||
          candidate.restrictedValues ||
          candidate.userId !== base.userId ||
          candidate.applicationId !== base.applicationId ||
          candidate.canonicalJobId !== base.canonicalJobId ||
          candidate.version <= base.version ||
          candidate.jobRevision !== base.jobRevision ||
          canonicalJson(candidate.form) !== canonicalJson(base.form)
        )
          throw unavailable();
        list(base.fields);
        for (const field of base.fields) validateShape(field, true);
        list(candidate.fields);
        for (const field of candidate.fields) validateShape(field, false);
        const selected = base.fields.filter((field) => field.protectedValue === true);
        selected.forEach(validate);
        const context = {
          ownerUserId: base.userId,
          applicationId: base.applicationId,
          jobRevision: base.jobRevision,
          form: base.form,
        };
        if (
          !selected.length ||
          metadataSha256(context, selected, definitions) !== base.restrictedValues.metadataSha256 ||
          selected.some((field) =>
            candidate.fields.some((next) => next.fieldKey === field.fieldKey),
          ) ||
          candidate.fields.some((field) => isRestricted(field, definitions) && field.value !== null)
        )
          throw unavailable();
        const fields = structuredClone([...candidate.fields, ...selected]).sort((left, right) =>
          left.fieldKey.localeCompare(right.fieldKey),
        );
        for (const field of fields) {
          Object.freeze(field.sourceFactIds);
          Object.freeze(field.reasons);
          if (field.vaultReference) Object.freeze(field.vaultReference);
          if (Array.isArray(field.value)) Object.freeze(field.value);
          Object.freeze(field);
        }
        Object.freeze(fields);
        const content = {
          ...candidate,
          fields,
          restrictedValues: Object.freeze({ ...base.restrictedValues }),
        };
        return Object.freeze({ ...content, packetHash: computePacketHash(content) });
      } catch {
        throw unavailable();
      }
    },

    async read(
      context: PacketContext,
      original: PreparedRestrictedPacketFields,
    ): Promise<ReadonlyMap<string, FieldValue>> {
      let plaintext: Uint8Array | undefined;
      try {
        check();
        validateContext(context);
        closed(original, ["fields", "binding", "envelope"]);
        list(original.fields);
        for (const field of original.fields) validateShape(field, true);
        closed(original.binding, ["id", "metadataSha256", "ciphertextSha256"]);
        validateEnvelope(original.envelope);
        const fixed = structuredClone(original);
        const selected = fixed.fields.filter((field) => field.protectedValue === true);
        if (
          !selected.length ||
          selected.length > 200 ||
          new Set(selected.map((field) => field.fieldKey)).size !== selected.length ||
          selected.some((field) => field.value !== null) ||
          fixed.fields.some((field) => isRestricted(field, definitions) && field.value !== null)
        )
          throw unavailable();
        selected.forEach(validate);
        if (selected.some((field) => field.vaultReference) && context.form === null)
          throw unavailable();
        const fixedContext = structuredClone(context);
        if (
          metadataSha256(fixedContext, selected, definitions) !== fixed.binding.metadataSha256 ||
          restrictedPacketEnvelopeSha256(fixed.envelope) !== fixed.binding.ciphertextSha256
        )
          throw unavailable();
        plaintext = await options.cipher.decrypt(
          scope(fixedContext, fixed.binding.id, fixed.binding.metadataSha256),
          fixed.envelope,
        );
        check();
        if (
          !(plaintext instanceof Uint8Array) ||
          plaintext.byteLength < 1 ||
          plaintext.byteLength > MAX_BYTES
        )
          throw unavailable();
        const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const decoded: unknown = JSON.parse(text);
        // Only the exact canonical encoder representation is accepted: JSON.parse alone
        // would silently discard duplicate keys in an authenticated but malformed payload.
        if (canonicalJson(decoded) !== text) throw unavailable();
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw unavailable();
        const body = decoded as Record<string, unknown>;
        if (
          Object.keys(body).sort().join(",") !== "schemaVersion,values" ||
          body.schemaVersion !== 1 ||
          !Array.isArray(body.values) ||
          body.values.length !== selected.length
        )
          throw unavailable();
        const values = new Map<string, FieldValue>();
        for (const item of body.values) {
          if (
            !item ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            Object.keys(item).sort().join(",") !== "fieldKey,value"
          )
            throw unavailable();
          const { fieldKey, value } = item as { fieldKey: unknown; value: unknown };
          const field = selected.find((candidate) => candidate.fieldKey === fieldKey);
          const definition = typeof fieldKey === "string" ? definitions.get(fieldKey) : undefined;
          if (
            !field ||
            !definition ||
            typeof fieldKey !== "string" ||
            values.has(fieldKey) ||
            value === null ||
            !valueMatchesDefinition(definition, value as FieldValue)
          )
            throw unavailable();
          values.set(fieldKey, value as FieldValue);
        }
        check();
        return values;
      } catch {
        throw unavailable();
      } finally {
        if (plaintext instanceof Uint8Array) plaintext.fill(0);
      }
    },
  });
}
