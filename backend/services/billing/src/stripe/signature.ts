import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook authentication. A webhook is accepted only when its `Stripe-Signature` header
 * carries a timestamp inside the tolerance window and an HMAC-SHA256 of `{timestamp}.{rawBody}`
 * that matches one of the configured signing secrets (several secrets allow rotation). The raw
 * bytes Stripe signed are verified, never a re-serialized body.
 */

export const defaultSignatureToleranceSeconds = 300;
const MAX_HEADER_LENGTH = 1_024;
const MAX_SIGNATURES = 8;

export class StripeSignatureError extends Error {
  constructor() {
    super("The Stripe signature is invalid");
    this.name = "StripeSignatureError";
  }
}

interface ParsedHeader {
  timestamp: number;
  signatures: Buffer[];
}

function parseHeader(header: string): ParsedHeader | undefined {
  if (header.length === 0 || header.length > MAX_HEADER_LENGTH) return undefined;
  let timestamp: number | undefined;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) return undefined;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "t") {
      if (!/^[0-9]{1,12}$/u.test(value) || timestamp !== undefined) return undefined;
      timestamp = Number(value);
    } else if (name === "v1") {
      if (!/^[0-9a-f]{64}$/u.test(value)) continue;
      if (signatures.length >= MAX_SIGNATURES) return undefined;
      signatures.push(Buffer.from(value, "hex"));
    }
  }
  if (timestamp === undefined || signatures.length === 0) return undefined;
  return { timestamp, signatures };
}

/** Throws `StripeSignatureError` unless the payload was signed by one of `secrets` recently. */
export function verifyStripeSignature(input: {
  payload: string | Buffer;
  header: string | undefined;
  secrets: readonly string[];
  now: Date;
  toleranceSeconds?: number;
}): void {
  const tolerance = input.toleranceSeconds ?? defaultSignatureToleranceSeconds;
  const parsed = input.header === undefined ? undefined : parseHeader(input.header);
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  if (
    !parsed ||
    input.secrets.length === 0 ||
    !Number.isFinite(nowSeconds) ||
    Math.abs(nowSeconds - parsed.timestamp) > tolerance
  ) {
    throw new StripeSignatureError();
  }
  const signed = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, "utf8"),
    typeof input.payload === "string" ? Buffer.from(input.payload, "utf8") : input.payload,
  ]);
  let matched = false;
  for (const secret of input.secrets) {
    if (secret.length === 0) continue;
    const expected = createHmac("sha256", secret).update(signed).digest();
    // Compare against every presented signature without short-circuiting on the first match.
    for (const candidate of parsed.signatures) {
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
        matched = true;
      }
    }
  }
  if (!matched) throw new StripeSignatureError();
}

/** Test and tooling helper: the header Stripe would send for a payload. */
export function signStripePayload(payload: string, secret: string, at: Date): string {
  const timestamp = Math.floor(at.getTime() / 1_000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
