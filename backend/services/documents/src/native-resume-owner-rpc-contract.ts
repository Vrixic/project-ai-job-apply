import { createHash } from "node:crypto";
import {
  nativeOwnerClosed,
  nativeOwnerJson,
  validNativePrincipalIssuer,
  validateNativeOwnerPrincipal,
  type NativeOwnerRpcOutput,
} from "./native-owner-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import type { NativeResumeIdentity } from "./native-resume-session.js";
import {
  NATIVE_CALLER_SIGNED_HEADERS,
  type NativeTaskCallerProof,
} from "./native-task-caller-contract.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
  sameTemporaryMaterialReference,
} from "./temporary-material-reference.js";

export const NATIVE_RESUME_OWNER_INPUT_LIMIT = 32_768;
export const NATIVE_RESUME_OWNER_OUTPUT_LIMIT = 16_384;
export const nativeResumeOwnerUnavailable = () => Error("NativeResumeOwnerUnavailable");
export type NativeResumeOwnerRequest =
  | { action: "admit" }
  | { action: "bootstrap" }
  | { action: "principal"; issuer: string }
  | { action: "completion"; material: TemporaryMaterialReference }
  | { action: "publish_ready"; material: TemporaryMaterialReference };
export interface NativeResumeOwnerRpcInput {
  schemaVersion: 1;
  binding: NativeResumeTaskBinding;
  request: NativeResumeOwnerRequest;
  proof: NativeTaskCallerProof;
}
export type NativeResumeOwnerRpcOutput = NativeOwnerRpcOutput;
export interface NativeResumeBootstrap {
  identity: NativeResumeIdentity;
  normalizedSha256: string;
  canonicalJobId: string;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
export function validateNativeResumeBootstrap(
  value: unknown,
  binding: NativeResumeTaskBinding,
): value is NativeResumeBootstrap {
  if (
    !nativeOwnerClosed(value, ["identity", "normalizedSha256", "canonicalJobId"]) ||
    !hash(value.normalizedSha256) ||
    !uuid(value.canonicalJobId) ||
    !nativeOwnerClosed(value.identity, [
      "generationId",
      "ownerUserId",
      "applicationId",
      "version",
      "baseDocumentId",
      "baseVersion",
      "baseSha256",
      "jobContextSha256",
    ])
  )
    return false;
  const identity = value.identity;
  return (
    ["generationId", "ownerUserId", "applicationId"].every(
      (key) => identity[key] === binding.scope[key as keyof typeof binding.scope],
    ) &&
    uuid(identity.baseDocumentId) &&
    hash(identity.baseSha256) &&
    hash(identity.jobContextSha256) &&
    [identity.version, identity.baseVersion].every(
      (v) => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 2_147_483_647,
    )
  );
}
export function validateNativeResumeOwnerRequest(
  value: unknown,
  binding: NativeResumeTaskBinding,
): value is NativeResumeOwnerRequest {
  try {
    if (nativeOwnerClosed(value, ["action"]))
      return value.action === "admit" || value.action === "bootstrap";
    if (nativeOwnerClosed(value, ["action", "issuer"]))
      return value.action === "principal" && validNativePrincipalIssuer(value.issuer);
    if (
      !nativeOwnerClosed(value, ["action", "material"]) ||
      (value.action !== "completion" && value.action !== "publish_ready") ||
      !validateTemporaryMaterialReference(value.material)
    )
      return false;
    const material = value.material;
    return (
      material.kind === "tailored_resume" &&
      material.ownerUserId === binding.scope.ownerUserId &&
      material.applicationId === binding.scope.applicationId &&
      material.generationId === binding.scope.generationId
    );
  } catch {
    return false;
  }
}
export function nativeResumeOwnerRequestDigest(
  raw: NativeResumeTaskBinding,
  request: NativeResumeOwnerRequest,
): string {
  const binding = nativeResumeTaskBinding(raw);
  if (!validateNativeResumeOwnerRequest(request, binding)) throw nativeResumeOwnerUnavailable();
  return createHash("sha256")
    .update(nativeOwnerJson({ kind: "native-resume-owner.v1", binding, request }))
    .digest("hex");
}
export function validateNativeResumeOwnerRpcInput(
  value: unknown,
): value is NativeResumeOwnerRpcInput {
  try {
    if (
      !nativeOwnerClosed(value, ["schemaVersion", "binding", "request", "proof"]) ||
      value.schemaVersion !== 1
    )
      return false;
    const binding = nativeResumeTaskBinding(value.binding);
    return (
      nativeOwnerClosed(value.proof, ["schemaVersion", "headers"]) &&
      value.proof.schemaVersion === 1 &&
      nativeOwnerClosed(value.proof.headers, [...NATIVE_CALLER_SIGNED_HEADERS, "authorization"]) &&
      Object.values(value.proof.headers).every((header) => typeof header === "string") &&
      validateNativeResumeOwnerRequest(value.request, binding) &&
      Buffer.byteLength(nativeOwnerJson(value)) <= NATIVE_RESUME_OWNER_INPUT_LIMIT
    );
  } catch {
    return false;
  }
}
export function validateNativeResumeOwnerRpcOutput(
  value: unknown,
  binding: NativeResumeTaskBinding,
  request: NativeResumeOwnerRequest,
): value is NativeResumeOwnerRpcOutput {
  try {
    if (
      !nativeOwnerClosed(value, ["schemaVersion", "requestSha256", "outcome", "result"]) ||
      value.schemaVersion !== 1 ||
      value.requestSha256 !== nativeResumeOwnerRequestDigest(binding, request) ||
      Buffer.byteLength(nativeOwnerJson(value)) > NATIVE_RESUME_OWNER_OUTPUT_LIMIT
    )
      return false;
    if (value.outcome === "unavailable") return value.result === null;
    if (value.outcome !== "ready") return false;
    if (request.action === "admit")
      return nativeOwnerClosed(value.result, ["admitted"]) && value.result.admitted === true;
    if (request.action === "bootstrap") return validateNativeResumeBootstrap(value.result, binding);
    if (request.action === "principal")
      return validateNativeOwnerPrincipal(value.result, request.issuer);
    if (request.action === "completion")
      return (
        nativeOwnerClosed(value.result, ["outcome", "material"]) &&
        (value.result.outcome === "claimed" || value.result.outcome === "already_completed") &&
        validateTemporaryMaterialReference(value.result.material) &&
        sameTemporaryMaterialReference(value.result.material, request.material)
      );
    return (
      nativeOwnerClosed(value.result, ["published", "material"]) &&
      value.result.published === true &&
      validateTemporaryMaterialReference(value.result.material) &&
      sameTemporaryMaterialReference(value.result.material, request.material)
    );
  } catch {
    return false;
  }
}
