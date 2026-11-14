import { createHash } from "node:crypto";
import type { CoverLetterEvidenceSource } from "./cover-letter-generation.js";
import type { CoverLetterProviderControlInput } from "./cover-letter-provider-control-contract.js";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { type NativeMaterialReady, validateNativeMaterialReady } from "./native-material-ready.js";
import type { NativeTaskCallerProof } from "./native-task-caller-contract.js";
import type { TemporaryMaterialCompletionInput } from "./temporary-material-completion-contract.js";
import { validateTemporaryMaterialReference } from "./temporary-material-reference.js";

export type NativeOwnerRequest =
  | { action: "admit" }
  | { action: "bootstrap" }
  | { action: "principal"; issuer: string }
  | { action: "evidence"; jobContextHash: string; confirmedFactsHash: string }
  | {
      action: "work";
      input: Exclude<CoverLetterProviderControlInput, { action: "settle_terminal" }>;
    }
  | { action: "completion"; input: TemporaryMaterialCompletionInput }
  | { action: "publish_ready"; input: NativeMaterialReady };
export interface NativeOwnerRpcInput {
  schemaVersion: 1;
  binding: NativeEvidenceBinding;
  request: NativeOwnerRequest;
  /** Ephemeral credential-bearing transport; never echo, log, persist, or queue. */
  proof: NativeTaskCallerProof;
}
export interface NativeOwnerRpcOutput {
  schemaVersion: 1;
  requestSha256: string;
  outcome: "ready" | "unavailable";
  result: unknown;
}
export type NativeOwnerEvidence = Awaited<ReturnType<CoverLetterEvidenceSource["load"]>>;
export const nativeOwnerRpcUnavailable = () => Error("NativeOwnerRpcUnavailable");
export const NATIVE_OWNER_INPUT_LIMIT = 32_768;
export const NATIVE_OWNER_OUTPUT_LIMIT = 2_097_152;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
export function nativeOwnerClosed(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable === true && "value" in d;
    })
  );
}
/** Canonical closed JSON, rejecting accessors, prototypes, cycles and non-finite numbers. */
export function nativeOwnerJson(value: unknown): string {
  const seen = new Set<object>();
  function canonical(raw: unknown, depth: number): unknown {
    if (depth > 12) throw nativeOwnerRpcUnavailable();
    if (raw === null || typeof raw === "string" || typeof raw === "boolean") return raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (!raw || typeof raw !== "object" || seen.has(raw)) throw nativeOwnerRpcUnavailable();
    seen.add(raw);
    try {
      if (Array.isArray(raw)) {
        if (
          Object.getPrototypeOf(raw) !== Array.prototype ||
          raw.length > 10_000 ||
          Reflect.ownKeys(raw).length !== raw.length + 1
        )
          throw nativeOwnerRpcUnavailable();
        return Array.from({ length: raw.length }, (_, index) => {
          const d = Object.getOwnPropertyDescriptor(raw, String(index));
          if (!d?.enumerable || !("value" in d)) throw nativeOwnerRpcUnavailable();
          return canonical(d.value, depth + 1);
        });
      }
      if (Object.getPrototypeOf(raw) !== Object.prototype) throw nativeOwnerRpcUnavailable();
      const result: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(raw).sort()) {
        if (typeof key !== "string" || key === "__proto__") throw nativeOwnerRpcUnavailable();
        const d = Object.getOwnPropertyDescriptor(raw, key);
        if (!d?.enumerable || !("value" in d)) throw nativeOwnerRpcUnavailable();
        result[key] = canonical(d.value, depth + 1);
      }
      return result;
    } finally {
      seen.delete(raw);
    }
  }
  return JSON.stringify(canonical(value, 0));
}
export function nativeOwnerRequestDigest(
  binding: NativeEvidenceBinding,
  request: NativeOwnerRequest,
): string {
  const fixed = nativeEvidenceBinding(binding);
  if (!validateNativeOwnerRequest(request, fixed)) throw nativeOwnerRpcUnavailable();
  return createHash("sha256")
    .update(nativeOwnerJson({ schemaVersion: 1, binding: fixed, request }))
    .digest("hex");
}
export function validateNativeOwnerRequest(
  value: unknown,
  binding: NativeEvidenceBinding,
): value is NativeOwnerRequest {
  try {
    if (nativeOwnerClosed(value, ["action"]))
      return value.action === "admit" || value.action === "bootstrap";
    if (nativeOwnerClosed(value, ["action", "issuer"]))
      return value.action === "principal" && validNativePrincipalIssuer(value.issuer);
    if (nativeOwnerClosed(value, ["action", "jobContextHash", "confirmedFactsHash"]))
      return (
        value.action === "evidence" && hash(value.jobContextHash) && hash(value.confirmedFactsHash)
      );
    if (!nativeOwnerClosed(value, ["action", "input"])) return false;
    if (value.action === "publish_ready")
      return (
        validateNativeMaterialReady(value.input) &&
        value.input.material.ownerUserId === binding.scope.ownerUserId &&
        value.input.material.applicationId === binding.scope.applicationId &&
        value.input.material.generationId === binding.scope.generationId
      );
    if (value.action === "work") {
      const input = value.input;
      if (
        nativeOwnerClosed(input, [
          "schemaVersion",
          "action",
          "documentId",
          "requestSha256",
          "consentExpiresAt",
        ])
      )
        return (
          input.schemaVersion === 1 &&
          input.action === "claim" &&
          input.documentId === binding.original.documentId &&
          input.requestSha256 === binding.original.requestSha256 &&
          typeof input.consentExpiresAt === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.consentExpiresAt) &&
          new Date(input.consentExpiresAt).toISOString() === input.consentExpiresAt
        );
      return (
        nativeOwnerClosed(input, ["schemaVersion", "action", "documentId", "reference"]) &&
        input.schemaVersion === 1 &&
        ["settle", "settle_rejected", "settle_undispatched"].includes(String(input.action)) &&
        input.documentId === binding.original.documentId &&
        nativeOwnerJson(input.reference) === nativeOwnerJson(binding.original)
      );
    }
    if (
      value.action === "completion" &&
      nativeOwnerClosed(value.input, ["schemaVersion", "action", "work", "material"]) &&
      value.input.schemaVersion === 1 &&
      value.input.action === "claim_original_completion" &&
      validateTemporaryMaterialReference(value.input.material)
    )
      return (
        nativeOwnerJson(value.input.work) === nativeOwnerJson(binding.original) &&
        value.input.material.kind === "cover_letter" &&
        value.input.material.ownerUserId === binding.scope.ownerUserId &&
        value.input.material.applicationId === binding.scope.applicationId &&
        value.input.material.generationId === binding.scope.generationId
      );
    return false;
  } catch {
    return false;
  }
}
export function validateNativeOwnerRpcInput(value: unknown): value is NativeOwnerRpcInput {
  try {
    if (
      !nativeOwnerClosed(value, ["schemaVersion", "binding", "request", "proof"]) ||
      value.schemaVersion !== 1
    )
      return false;
    const binding = nativeEvidenceBinding(value.binding as NativeEvidenceBinding);
    // The actual verifier checks proof shape/context/freshness and AWS signature, before owner I/O.
    return (
      nativeOwnerClosed(value.proof, ["schemaVersion", "headers"]) &&
      value.proof.schemaVersion === 1 &&
      validateNativeOwnerRequest(value.request, binding) &&
      Buffer.byteLength(nativeOwnerJson(value)) <= NATIVE_OWNER_INPUT_LIMIT
    );
  } catch {
    return false;
  }
}
export function validateNativeOwnerEvidence(value: unknown): value is NativeOwnerEvidence {
  try {
    if (
      !nativeOwnerClosed(value, ["facts", "job"]) ||
      !Array.isArray(value.facts) ||
      !nativeOwnerClosed(value.job, ["title", "company", "description"]) ||
      !Object.values(value.job).every((x) => typeof x === "string")
    )
      return false;
    const required = [
      "id",
      "kind",
      "key",
      "value",
      "verification",
      "sensitivity",
      "source",
      "version",
    ];
    const optional = ["evidence", "availability", "effectiveFrom", "effectiveTo"];
    const ids = new Set<string>();
    for (const f of value.facts) {
      if (
        !f ||
        typeof f !== "object" ||
        !nativeOwnerClosed(f, [...required, ...optional.filter((k) => Object.hasOwn(f, k))]) ||
        !id(f.id) ||
        ids.has(f.id) ||
        typeof f.kind !== "string" ||
        typeof f.key !== "string" ||
        !["confirmed", "proposed", "rejected"].includes(String(f.verification)) ||
        !["standard", "confidential"].includes(String(f.sensitivity)) ||
        !Number.isSafeInteger(f.version) ||
        Number(f.version) < 1 ||
        !nativeOwnerClosed(f.source, ["type", "reference"]) ||
        typeof f.source.reference !== "string" ||
        !["user", "resume", "import", "derived"].includes(String(f.source.type))
      )
        return false;
      ids.add(f.id);
      if (
        !(
          typeof f.value === "string" ||
          typeof f.value === "boolean" ||
          (typeof f.value === "number" && Number.isFinite(f.value)) ||
          (Array.isArray(f.value) && f.value.every((x) => typeof x === "string"))
        )
      )
        return false;
      for (const k of ["effectiveFrom", "effectiveTo"])
        if (Object.hasOwn(f, k) && (typeof f[k] !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(f[k])))
          return false;
      if (
        Object.hasOwn(f, "availability") &&
        !(
          (nativeOwnerClosed(f.availability, ["state"]) && f.availability.state === "available") ||
          (nativeOwnerClosed(f.availability, ["state", "reasonCode"]) &&
            f.availability.state === "invalidated" &&
            f.availability.reasonCode === "source_security_hold")
        )
      )
        return false;
      if (Object.hasOwn(f, "evidence")) {
        if (
          !nativeOwnerClosed(f.evidence, ["supportingSpans"]) ||
          !Array.isArray(f.evidence.supportingSpans)
        )
          return false;
        for (const span of f.evidence.supportingSpans) {
          const keys = [
            "documentId",
            "documentVersion",
            "parserVersion",
            "blockIndex",
            "startOffset",
            "endOffset",
          ];
          if (
            !nativeOwnerClosed(span, [...keys, ...(Object.hasOwn(span, "page") ? ["page"] : [])]) ||
            !id(span.documentId) ||
            typeof span.parserVersion !== "string" ||
            ![
              "documentVersion",
              "blockIndex",
              "startOffset",
              "endOffset",
              ...(Object.hasOwn(span, "page") ? ["page"] : []),
            ].every(
              (k) =>
                Number.isSafeInteger(span[k]) &&
                Number(span[k]) >= (k === "documentVersion" || k === "page" ? 1 : 0),
            ) ||
            Number(span.endOffset) < Number(span.startOffset)
          )
            return false;
        }
      }
    }
    return Buffer.byteLength(nativeOwnerJson(value)) <= NATIVE_OWNER_OUTPUT_LIMIT - 512;
  } catch {
    return false;
  }
}
export function validateNativeOwnerRpcOutput(
  value: unknown,
  binding: NativeEvidenceBinding,
  request: NativeOwnerRequest,
): value is NativeOwnerRpcOutput {
  try {
    if (
      !nativeOwnerClosed(value, ["schemaVersion", "requestSha256", "outcome", "result"]) ||
      value.schemaVersion !== 1 ||
      value.requestSha256 !== nativeOwnerRequestDigest(binding, request) ||
      Buffer.byteLength(nativeOwnerJson(value)) > NATIVE_OWNER_OUTPUT_LIMIT
    )
      return false;
    if (value.outcome === "unavailable") return value.result === null;
    if (value.outcome !== "ready") return false;
    if (request.action === "admit")
      return nativeOwnerClosed(value.result, ["admitted"]) && value.result.admitted === true;
    if (request.action === "bootstrap") return validateNativeOwnerBootstrap(value.result, binding);
    if (request.action === "principal")
      return validateNativeOwnerPrincipal(value.result, request.issuer);
    if (request.action === "evidence") return validateNativeOwnerEvidence(value.result);
    if (request.action === "publish_ready")
      return nativeOwnerClosed(value.result, ["published"]) && value.result.published === true;
    if (request.action === "work") {
      const result = value.result;
      return (
        nativeOwnerClosed(result, [
          "schemaVersion",
          "action",
          "documentId",
          "outcome",
          "reference",
        ]) &&
        result.schemaVersion === 1 &&
        result.action === request.input.action &&
        result.documentId === binding.original.documentId &&
        result.outcome === (request.input.action === "claim" ? "claimed" : "settled") &&
        nativeOwnerJson(result.reference) === nativeOwnerJson(binding.original)
      );
    }
    if (
      !nativeOwnerClosed(value.result, [
        "schemaVersion",
        "action",
        "work",
        "material",
        "outcome",
      ]) ||
      !["claimed", "already_completed"].includes(String(value.result.outcome))
    )
      return false;
    const { outcome: _outcome, ...input } = value.result;
    return nativeOwnerJson(input) === nativeOwnerJson(request.input);
  } catch {
    return false;
  }
}

export interface NativeOwnerBootstrap {
  documentVersion: number;
  id: string;
  ownerUserId: string;
  applicationId: string;
  jobContextHash: string;
  confirmedFactsHash: string;
  noticeVersion: "bedrock-cover-letter.v1";
  approvedAt: string;
  expiresAt: string;
}

export function validNativePrincipalIssuer(value: unknown): value is string {
  try {
    if (typeof value !== "string" || value.length > 512) return false;
    const issuer = new URL(value);
    return (
      issuer.protocol === "https:" &&
      !issuer.username &&
      !issuer.password &&
      !issuer.search &&
      !issuer.hash &&
      issuer.href === value
    );
  } catch {
    return false;
  }
}
export function validateNativeOwnerPrincipal(
  value: unknown,
  issuer: string,
): value is { issuer: string; subject: string } {
  return (
    nativeOwnerClosed(value, ["issuer", "subject"]) &&
    value.issuer === issuer &&
    validNativePrincipalIssuer(value.issuer) &&
    typeof value.subject === "string" &&
    /^[\x21-\x7e]{1,512}$/u.test(value.subject)
  );
}
/** Approval comes from the owning persisted preparation, never from task launch overrides. */
export function validateNativeOwnerBootstrap(
  value: unknown,
  binding: NativeEvidenceBinding,
): value is NativeOwnerBootstrap {
  try {
    if (
      !nativeOwnerClosed(value, [
        "documentVersion",
        "id",
        "ownerUserId",
        "applicationId",
        "jobContextHash",
        "confirmedFactsHash",
        "noticeVersion",
        "approvedAt",
        "expiresAt",
      ])
    )
      return false;
    if (
      !Number.isSafeInteger(value.documentVersion) ||
      (value.documentVersion as number) < 1 ||
      (value.documentVersion as number) > 2_147_483_647 ||
      value.id !== binding.scope.generationId ||
      value.ownerUserId !== binding.scope.ownerUserId ||
      value.applicationId !== binding.scope.applicationId ||
      !hash(value.jobContextHash) ||
      !hash(value.confirmedFactsHash) ||
      value.noticeVersion !== "bedrock-cover-letter.v1"
    )
      return false;
    for (const key of ["approvedAt", "expiresAt"]) {
      const date = value[key];
      if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date) ||
        new Date(date).toISOString() !== date
      )
        return false;
    }
    const approved = Date.parse(value.approvedAt as string);
    const expires = Date.parse(value.expiresAt as string);
    const now = Date.now();
    return approved <= now && expires > now && expires - approved === 900_000;
  } catch {
    return false;
  }
}
