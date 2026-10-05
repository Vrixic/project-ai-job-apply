import { canonicalHash } from "./canonical.js";
import {
  classifyField,
  DEFAULT_CONFIDENCE_THRESHOLD,
  type FieldDefinition,
  type FieldDisposition,
  type FieldOrigin,
  type FieldValue,
  type ProposedField,
  type ReviewReason,
} from "./field-policy.js";

import { type VaultCurrentReference, type VaultReference, validVaultReference } from "./vault.js";

export const PACKET_HASH_SCHEMA = "application-packet.v1";
/** Approval never outlives this window even if nothing else changed. */
export const MAX_APPROVAL_AGE_MS = 24 * 60 * 60 * 1000;

const SHA256 = /^[a-f0-9]{64}$/;

export interface FormBinding {
  adapterId: string;
  variantId: string;
  /** SHA-256 over the normalized form structure the fields were mapped against. */
  formHash: string;
}

export interface ArtifactHashes {
  resume?: string;
  coverLetter?: string;
}

export interface PacketFieldEntry {
  vaultReference?: VaultReference;
  fieldKey: string;
  value: FieldValue;
  origin: FieldOrigin;
  sourceFactIds: readonly string[];
  confidence: number;
  disposition: FieldDisposition;
  reasons: readonly ReviewReason[];
  requiresReview: boolean;
}

export interface PacketContent {
  userId: string;
  applicationId: string;
  canonicalJobId: string;
  version: number;
  /** SHA-256 of the job facts the packet was prepared against (title, company, location, URL). */
  jobRevision: string;
  form: FormBinding | null;
  fields: readonly PacketFieldEntry[];
  artifactHashes: ArtifactHashes;
}

export interface ApplicationPacket extends PacketContent {
  id: string;
  packetHash: string;
  createdAt: Date;
}

export interface PacketInputs {
  id: string;
  userId: string;
  applicationId: string;
  canonicalJobId: string;
  version: number;
  jobRevision: string;
  form: FormBinding | null;
  fields: readonly ProposedField[];
  artifactHashes: ArtifactHashes;
  createdAt: Date;
}

export class PacketInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacketInvariantError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function valueMatchesDefinition(definition: FieldDefinition, value: FieldValue): boolean {
  if (value === null) return true;
  switch (definition.valueType) {
    case "string":
    case "text":
      return typeof value === "string";
    case "file":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "decimal":
      return typeof value === "number" && Number.isFinite(value);
    case "date": {
      if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    }
    case "enum":
      return (
        typeof value === "string" &&
        (definition.allowedValues === undefined || definition.allowedValues.includes(value))
      );
  }
}

/**
 * Assembles an immutable packet. Values that fail policy are removed rather than carried, so a
 * packet can never expose an unconfirmed, unsupported, or never-inferable value as if it were
 * usable.
 */
export function assemblePacket(
  inputs: PacketInputs,
  definitions: ReadonlyMap<string, FieldDefinition>,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): ApplicationPacket {
  if (!Number.isSafeInteger(inputs.version) || inputs.version < 1) {
    throw new PacketInvariantError("Packet version must be a positive integer");
  }
  for (const [name, hash] of [
    ["jobRevision", inputs.jobRevision],
    ["form.formHash", inputs.form?.formHash],
    ["resume", inputs.artifactHashes.resume],
    ["coverLetter", inputs.artifactHashes.coverLetter],
  ] as const) {
    if (hash !== undefined && !SHA256.test(hash)) {
      throw new PacketInvariantError(`${name} must be a lowercase SHA-256`);
    }
  }
  const seen = new Set<string>();
  const entries: PacketFieldEntry[] = [];
  for (const proposal of inputs.fields) {
    if (seen.has(proposal.fieldKey)) {
      throw new PacketInvariantError("Packet fields must be unique by key");
    }
    seen.add(proposal.fieldKey);
    if (
      proposal.vaultReference &&
      (!inputs.form ||
        proposal.origin !== "answer_vault" ||
        !validVaultReference(proposal.vaultReference) ||
        !proposal.sourceConfirmed ||
        proposal.value === null ||
        proposal.sourceFactIds.length !== 1 ||
        proposal.sourceFactIds[0] !== proposal.vaultReference.id)
    ) {
      throw new PacketInvariantError("Invalid selected-answer provenance");
    }
    // These fields retain only the exact bound artifact digest, never document material.
    if (
      proposal.value !== null &&
      (proposal.fieldKey === "documents.cover_letter" || proposal.fieldKey === "documents.resume")
    ) {
      const expected =
        proposal.fieldKey === "documents.cover_letter"
          ? inputs.artifactHashes.coverLetter
          : inputs.artifactHashes.resume;
      if (
        typeof proposal.value !== "string" ||
        !expected ||
        proposal.value !== expected ||
        !SHA256.test(proposal.value)
      )
        throw new PacketInvariantError("Document fields must reference their bound artifact hash");
    }
    const definition = definitions.get(proposal.fieldKey);
    const classification = classifyField(definition, proposal, confidenceThreshold);
    const reasons: ReviewReason[] = [...classification.reasons];
    let usable = classification.usable;
    if (definition && !valueMatchesDefinition(definition, proposal.value)) {
      usable = false;
      if (!reasons.includes("unsupported_value")) reasons.push("unsupported_value");
    }
    if (proposal.vaultReference && !usable)
      throw new PacketInvariantError("Unusable selected answer");
    const disposition: FieldDisposition = usable ? classification.disposition : "user_action";
    entries.push({
      ...(proposal.vaultReference ? { vaultReference: { ...proposal.vaultReference } } : {}),
      fieldKey: proposal.fieldKey,
      value: usable ? proposal.value : null,
      origin: proposal.origin,
      sourceFactIds: [...new Set(proposal.sourceFactIds)].sort(),
      confidence: proposal.confidence,
      disposition,
      reasons: reasons.sort(),
      requiresReview: disposition !== "auto",
    });
  }
  entries.sort((a, b) => (a.fieldKey < b.fieldKey ? -1 : a.fieldKey > b.fieldKey ? 1 : 0));
  const content: PacketContent = {
    userId: inputs.userId,
    applicationId: inputs.applicationId,
    canonicalJobId: inputs.canonicalJobId,
    version: inputs.version,
    jobRevision: inputs.jobRevision,
    form: inputs.form ? { ...inputs.form } : null,
    fields: entries,
    artifactHashes: { ...inputs.artifactHashes },
  };
  return deepFreeze({
    ...content,
    id: inputs.id,
    packetHash: computePacketHash(content),
    createdAt: new Date(inputs.createdAt.getTime()),
  });
}

/** The hash binds content only: it excludes ids, timestamps, and any approval state. */
export function computePacketHash(content: PacketContent): string {
  return canonicalHash({
    schema: PACKET_HASH_SCHEMA,
    userId: content.userId,
    applicationId: content.applicationId,
    canonicalJobId: content.canonicalJobId,
    version: content.version,
    jobRevision: content.jobRevision,
    form: content.form,
    fields: content.fields.map((field) => ({
      ...(field.vaultReference ? { vaultReference: field.vaultReference } : {}),
      fieldKey: field.fieldKey,
      value: field.value,
      origin: field.origin,
      sourceFactIds: [...field.sourceFactIds].sort(),
      confidence: field.confidence,
      disposition: field.disposition,
      reasons: [...field.reasons].sort(),
      requiresReview: field.requiresReview,
    })),
    artifactHashes: content.artifactHashes,
  });
}

export function verifyPacketHash(packet: ApplicationPacket): boolean {
  return computePacketHash(packet) === packet.packetHash;
}

export interface ApprovalRequest {
  packetHash: string;
  consentId: string;
  /** Every field the candidate reviewed, including restricted answers even when unchanged. */
  acknowledgedFieldKeys: readonly string[];
}

export interface PacketApproval {
  packetId: string;
  packetHash: string;
  consentId: string;
  acknowledgedFieldKeys: readonly string[];
  approvedAt: Date;
  expiresAt: Date;
}

export class ApprovalRefusedError extends Error {
  readonly code:
    | "PACKET_HASH_MISMATCH"
    | "UNRESOLVED_FIELD"
    | "UNACKNOWLEDGED_FIELD"
    | "PACKET_TAMPERED";
  readonly fieldKeys: readonly string[];

  constructor(code: ApprovalRefusedError["code"], fieldKeys: readonly string[] = []) {
    super(`Approval refused: ${code}`);
    this.name = "ApprovalRefusedError";
    this.code = code;
    this.fieldKeys = fieldKeys;
  }
}

export function approvePacket(
  packet: ApplicationPacket,
  request: ApprovalRequest,
  now: Date,
): PacketApproval {
  if (!verifyPacketHash(packet)) throw new ApprovalRefusedError("PACKET_TAMPERED");
  if (request.packetHash !== packet.packetHash) {
    throw new ApprovalRefusedError("PACKET_HASH_MISMATCH");
  }
  const unresolved = packet.fields
    .filter((field) => field.disposition === "user_action" && field.value === null)
    .map((field) => field.fieldKey);
  // A field that needs direct candidate action can never be approved past while it is empty.
  if (unresolved.length > 0) throw new ApprovalRefusedError("UNRESOLVED_FIELD", unresolved);
  const acknowledged = new Set(request.acknowledgedFieldKeys);
  const missing = packet.fields
    .filter((field) => field.requiresReview && !acknowledged.has(field.fieldKey))
    .map((field) => field.fieldKey);
  if (missing.length > 0) throw new ApprovalRefusedError("UNACKNOWLEDGED_FIELD", missing);
  return {
    packetId: packet.id,
    packetHash: packet.packetHash,
    consentId: request.consentId,
    acknowledgedFieldKeys: [...acknowledged].sort(),
    approvedAt: new Date(now.getTime()),
    expiresAt: new Date(now.getTime() + MAX_APPROVAL_AGE_MS),
  };
}

export interface CurrentBindings {
  jobRevision: string;
  formHash: string | null;
  resumeHash?: string;
  coverLetterHash?: string;
  vaultReferences?: readonly VaultCurrentReference[];
}

export type ApprovalInvalidReason =
  | "packet_hash_mismatch"
  | "approval_expired"
  | "job_changed"
  | "form_changed"
  | "resume_changed"
  | "cover_letter_changed"
  | "vault_answer_changed";

export type ApprovalValidity =
  | { valid: true }
  | { valid: false; reasons: readonly ApprovalInvalidReason[] };

/** Reports which bound inputs no longer match the packet; empty means every binding holds. */
export function evaluateBindings(
  packet: ApplicationPacket,
  current: CurrentBindings,
  now: Date = new Date(),
): ApprovalInvalidReason[] {
  const reasons: ApprovalInvalidReason[] = [];
  if (current.jobRevision !== packet.jobRevision) reasons.push("job_changed");
  if ((current.formHash ?? null) !== (packet.form?.formHash ?? null)) reasons.push("form_changed");
  if (current.resumeHash !== packet.artifactHashes.resume) reasons.push("resume_changed");
  if (current.coverLetterHash !== packet.artifactHashes.coverLetter) {
    reasons.push("cover_letter_changed");
  }
  reasons.push(...evaluateVaultBindings(packet, current.vaultReferences, now));
  return reasons;
}

/** The same exact source/deadline guard protects asynchronous preparation admission. */
export function evaluateVaultBindings(
  packet: ApplicationPacket,
  current: readonly VaultCurrentReference[] | undefined,
  now: Date,
): ApprovalInvalidReason[] {
  const reasons: ApprovalInvalidReason[] = [];
  for (const field of packet.fields) {
    const expected = field.vaultReference;
    if (!expected) continue;
    const matches = (current ?? []).filter((ref) => ref.fieldKey === field.fieldKey);
    const live = matches[0];
    if (
      matches.length !== 1 ||
      !live ||
      live.id !== expected.id ||
      live.version !== expected.version ||
      live.context !== expected.context ||
      live.validUntilEpochMs !== expected.validUntilEpochMs ||
      !Number.isFinite(now.getTime()) ||
      !validVaultReference(expected) ||
      (expected.validUntilEpochMs !== null && now.getTime() >= expected.validUntilEpochMs)
    ) {
      if (!reasons.includes("vault_answer_changed")) reasons.push("vault_answer_changed");
    }
  }
  return reasons;
}

/**
 * Approval is only usable while every bound input is unchanged. Any mismatch is fatal: the
 * caller must build a new packet and obtain a new approval.
 */
export function evaluateApproval(
  packet: ApplicationPacket,
  approval: PacketApproval,
  current: CurrentBindings,
  now: Date,
): ApprovalValidity {
  const reasons: ApprovalInvalidReason[] = [];
  if (approval.packetHash !== packet.packetHash || !verifyPacketHash(packet)) {
    reasons.push("packet_hash_mismatch");
  }
  if (now.getTime() >= approval.expiresAt.getTime()) reasons.push("approval_expired");
  reasons.push(...evaluateBindings(packet, current, now));
  return reasons.length === 0 ? { valid: true } : { valid: false, reasons };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
