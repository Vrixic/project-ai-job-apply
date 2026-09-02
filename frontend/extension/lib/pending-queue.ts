import type { CaptureField, SanitizedJobCapture } from "./job-capture";

export const PENDING_QUEUE_KEY = "d2PendingJobIntentsV1";
export const MAXIMUM_ATTEMPTS = 5;
export const MAXIMUM_QUEUE_ITEMS = 25;
const BACKOFF_MILLISECONDS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;

export type JobIntentKind = "contribute" | "private_save";
export type PendingState = "blocked" | "pending" | "terminal";

export interface PendingJobIntent {
  approvedFields: readonly CaptureField[];
  attempt: number;
  capture: SanitizedJobCapture;
  createdAt: string;
  id: string;
  idempotencyKey: string;
  identityFence: string;
  intent: JobIntentKind;
  lastError?: "authentication_required" | "identity_changed" | "request_rejected" | "retryable";
  nextAttemptAt: string;
  state: PendingState;
}

export interface DispatchResult {
  outcome: "accepted" | "retryable" | "terminal";
}

export function uuidV7(
  now = Date.now(),
  random = crypto.getRandomValues(new Uint8Array(10)),
): string {
  if (!Number.isSafeInteger(now) || now < 0 || random.length !== 10) {
    throw new TypeError("UUIDv7 input is invalid");
  }
  const bytes = new Uint8Array(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  bytes.set(random.slice(3), 9);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createPendingIntent(input: {
  approvedFields: readonly CaptureField[];
  capture: SanitizedJobCapture;
  identityFence: string;
  intent: JobIntentKind;
  now?: Date;
  randomId?: () => string;
}): PendingJobIntent {
  const now = input.now ?? new Date();
  const randomId = input.randomId ?? (() => uuidV7(now.getTime()));
  const id = randomId();
  return {
    approvedFields: [...new Set(input.approvedFields)],
    attempt: 0,
    capture: input.capture,
    createdAt: now.toISOString(),
    id,
    idempotencyKey: `extension-job-intent-${id}`,
    identityFence: input.identityFence,
    intent: input.intent,
    nextAttemptAt: now.toISOString(),
    state: "pending",
  };
}

export function dueForDispatch(
  intent: PendingJobIntent,
  identityFence: string,
  now: Date,
): boolean {
  return (
    intent.state === "pending" &&
    intent.identityFence === identityFence &&
    Date.parse(intent.nextAttemptAt) <= now.getTime()
  );
}

export function settleDispatch(
  intent: PendingJobIntent,
  result: DispatchResult,
  now = new Date(),
): PendingJobIntent | undefined {
  if (result.outcome === "accepted") {
    return undefined;
  }
  const attempt = intent.attempt + 1;
  if (result.outcome === "terminal" || attempt >= MAXIMUM_ATTEMPTS) {
    return { ...intent, attempt, lastError: "request_rejected", state: "terminal" };
  }
  const delay = BACKOFF_MILLISECONDS[Math.min(attempt - 1, BACKOFF_MILLISECONDS.length - 1)] ?? 0;
  return {
    ...intent,
    attempt,
    lastError: "retryable",
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
  };
}

export function fenceMismatchedIntent(intent: PendingJobIntent): PendingJobIntent {
  return { ...intent, lastError: "identity_changed", state: "blocked" };
}

export function classifyResponse(status: number): DispatchResult {
  if (status >= 200 && status < 300) return { outcome: "accepted" };
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { outcome: "retryable" };
  }
  return { outcome: "terminal" };
}
