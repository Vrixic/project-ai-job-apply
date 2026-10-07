import { createHash } from "node:crypto";
import {
  nativeOwnerClosed,
  nativeOwnerJson,
  type NativeOwnerRpcOutput,
} from "./native-owner-rpc-contract.js";
import {
  type NativeResumeBootstrap,
  validateNativeResumeBootstrap,
} from "./native-resume-owner-rpc-contract.js";
import {
  type NativeResumeTaskBinding,
  nativeResumeTaskBinding,
} from "./native-resume-task-binding.js";
import {
  nativeResumeSourceUnavailable,
  validateNativeResumeSource,
} from "./native-resume-source.js";
import {
  NATIVE_CALLER_SIGNED_HEADERS,
  type NativeTaskCallerProof,
} from "./native-task-caller-contract.js";

export const NATIVE_RESUME_SOURCE_INPUT_LIMIT = 32_768;
export const NATIVE_RESUME_SOURCE_OUTPUT_LIMIT = 2_010_000;
export interface NativeResumeSourceRequest {
  action: "load_source";
  bootstrap: NativeResumeBootstrap;
}
export interface NativeResumeSourceInput {
  schemaVersion: 1;
  binding: NativeResumeTaskBinding;
  request: NativeResumeSourceRequest;
  proof: NativeTaskCallerProof;
}
export function nativeResumeSourceRequestDigest(
  binding: NativeResumeTaskBinding,
  request: NativeResumeSourceRequest,
): string {
  const fixed = nativeResumeTaskBinding(binding);
  if (
    !nativeOwnerClosed(request, ["action", "bootstrap"]) ||
    request.action !== "load_source" ||
    !validateNativeResumeBootstrap(request.bootstrap, fixed)
  )
    throw nativeResumeSourceUnavailable();
  return createHash("sha256")
    .update(nativeOwnerJson({ kind: "native-resume-source.v1", binding: fixed, request }))
    .digest("hex");
}
export function validateNativeResumeSourceInput(value: unknown): value is NativeResumeSourceInput {
  try {
    if (
      !nativeOwnerClosed(value, ["schemaVersion", "binding", "request", "proof"]) ||
      value.schemaVersion !== 1 ||
      !nativeOwnerClosed(value.proof, ["schemaVersion", "headers"]) ||
      value.proof.schemaVersion !== 1 ||
      !nativeOwnerClosed(value.proof.headers, [...NATIVE_CALLER_SIGNED_HEADERS, "authorization"]) ||
      !Object.values(value.proof.headers).every((v) => typeof v === "string")
    )
      return false;
    nativeResumeSourceRequestDigest(
      value.binding as NativeResumeTaskBinding,
      value.request as NativeResumeSourceRequest,
    );
    return Buffer.byteLength(nativeOwnerJson(value)) <= NATIVE_RESUME_SOURCE_INPUT_LIMIT;
  } catch {
    return false;
  }
}
export function validateNativeResumeSourceOutput(
  value: unknown,
  binding: NativeResumeTaskBinding,
  request: NativeResumeSourceRequest,
): value is NativeOwnerRpcOutput {
  try {
    return (
      nativeOwnerClosed(value, ["schemaVersion", "requestSha256", "outcome", "result"]) &&
      value.schemaVersion === 1 &&
      value.requestSha256 === nativeResumeSourceRequestDigest(binding, request) &&
      Buffer.byteLength(nativeOwnerJson(value)) <= NATIVE_RESUME_SOURCE_OUTPUT_LIMIT &&
      ((value.outcome === "unavailable" && value.result === null) ||
        (value.outcome === "ready" && validateNativeResumeSource(value.result, request.bootstrap)))
    );
  } catch {
    return false;
  }
}
