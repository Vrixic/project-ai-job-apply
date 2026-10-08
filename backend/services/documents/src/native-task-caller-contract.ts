import { createHash } from "node:crypto";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";

export const NATIVE_CALLER_STS_ORIGIN = "https://sts.us-east-2.amazonaws.com";
export const NATIVE_CALLER_STS_BODY = "Action=GetCallerIdentity&Version=2011-06-15";
export const NATIVE_CALLER_CONTEXT_HEADER = "x-ai-job-apply-native-caller";
export const NATIVE_CALLER_SIGNED_HEADERS = [
  "content-length",
  "content-type",
  "host",
  NATIVE_CALLER_CONTEXT_HEADER,
  "x-amz-content-sha256",
  "x-amz-date",
  "x-amz-security-token",
].sort();
export interface NativeTaskCallerProof {
  schemaVersion: 1;
  /** Ephemeral credential-bearing private transport only; never log/store/queue this proof. */
  headers: Record<string, string>;
}
export const nativeTaskCallerUnavailable = () => Error("NativeTaskCallerUnavailable");
const hash = /^[a-f0-9]{64}$/u;
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
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
/** Fixed metadata and recipient only. This digest is not authentication, admission or liveness. */
export function nativeTaskCallerScope(binding: NativeEvidenceBinding, targetArn: string) {
  const fixed = nativeEvidenceBinding(binding);
  nativeLaunchControlVersion(targetArn);
  const account = fixed.allocation.clusterArn.split(":")[4];
  if (!targetArn.startsWith(`arn:aws:lambda:us-east-2:${account}:function:`))
    throw nativeTaskCallerUnavailable();
  // Explicit field order makes equivalent validated metadata independent of JSON property order.
  const metadata = [
    1,
    targetArn,
    ...["allocationId", "ownerUserId", "applicationId", "generationId", "epochId"].map(
      (key) => fixed.scope[key as keyof typeof fixed.scope],
    ),
    ...["clusterArn", "taskArn", "taskDefinitionArn", "containerName"].map(
      (key) => fixed.allocation[key as keyof typeof fixed.allocation],
    ),
    fixed.original.id,
    fixed.original.documentId,
    fixed.original.purpose,
    fixed.original.requestSha256,
  ];
  return Object.freeze({
    binding: fixed,
    targetArn,
    digest(requestSha256: string) {
      if (typeof requestSha256 !== "string" || !hash.test(requestSha256))
        throw nativeTaskCallerUnavailable();
      return createHash("sha256")
        .update(JSON.stringify([...metadata, requestSha256]))
        .digest("hex");
    },
  });
}
/** Shape, exact signed-context and freshness only. AWS must authenticate the signature remotely. */
export function validateNativeTaskCallerProof(
  value: unknown,
  expectedContext: string,
  nowMs: number,
): value is NativeTaskCallerProof {
  try {
    if (
      !hash.test(expectedContext) ||
      !Number.isFinite(nowMs) ||
      !closed(value, ["schemaVersion", "headers"]) ||
      value.schemaVersion !== 1 ||
      !closed(value.headers, [...NATIVE_CALLER_SIGNED_HEADERS, "authorization"])
    )
      return false;
    const headers = value.headers;
    if (
      !Object.values(headers).every(
        (x) => typeof x === "string" && x.length <= 8192 && !/[\r\n]/u.test(x),
      )
    )
      return false;
    if (
      headers.host !== "sts.us-east-2.amazonaws.com" ||
      headers["content-type"] !== "application/x-www-form-urlencoded" ||
      headers["content-length"] !== String(Buffer.byteLength(NATIVE_CALLER_STS_BODY)) ||
      headers[NATIVE_CALLER_CONTEXT_HEADER] !== expectedContext ||
      headers["x-amz-content-sha256"] !==
        createHash("sha256").update(NATIVE_CALLER_STS_BODY).digest("hex") ||
      !/^[\x21-\x7e]{16,8192}$/u.test(headers["x-amz-security-token"] as string)
    )
      return false;
    const date = headers["x-amz-date"] as string;
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(date);
    if (!match) return false;
    const stamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
    const signedAt = Date.parse(stamp);
    if (
      !Number.isFinite(signedAt) ||
      new Date(signedAt).toISOString() !== stamp ||
      nowMs - signedAt < -2000 ||
      nowMs - signedAt >= 60_000
    )
      return false;
    const authorization =
      /^AWS4-HMAC-SHA256 Credential=(ASIA[A-Z0-9]{12,124})\/(\d{8})\/us-east-2\/sts\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([a-f0-9]{64})$/u.exec(
        headers.authorization as string,
      );
    return (
      !!authorization &&
      authorization[2] === date.slice(0, 8) &&
      authorization[3] === NATIVE_CALLER_SIGNED_HEADERS.join(";")
    );
  } catch {
    return false;
  }
}
