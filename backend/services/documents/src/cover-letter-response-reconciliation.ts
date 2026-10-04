import {
  type OpenAiLunaResponseCleanup,
  type OpenAiResponseCleanup,
  validateOpenAiBackgroundResponseReference,
} from "@ai-job-apply/ai-sdk";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type {
  CoverLetterResponseInventory,
  PostgresCoverLetterResponseStore,
} from "./cover-letter-response-store.js";
import type {
  CoverLetterWorkReference,
  PostgresCoverLetterWorkStore,
} from "./cover-letter-work-store.js";

export type CoverLetterResponseReconciliation =
  | { kind: "unresolved" }
  | { kind: "response_disposed"; reference: CoverLetterWorkReference };

function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        keys.includes(key) &&
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value")
      );
    })
  );
}
function inventory(
  value: unknown,
  ref: CoverLetterWorkReference,
): value is CoverLetterResponseInventory {
  return (
    closed(value, ["reference", "state", "response"]) &&
    validateProviderControlReference(value.reference) &&
    value.reference.id === ref.id &&
    value.reference.documentId === ref.documentId &&
    value.reference.requestSha256 === ref.requestSha256 &&
    ((value.state === "reserved" && value.response === null) ||
      ((value.state === "acknowledged" || value.state === "disposed") &&
        validateOpenAiBackgroundResponseReference(value.response)))
  );
}
function positive(
  value: unknown,
  original: NonNullable<CoverLetterResponseInventory["response"]>,
): value is Extract<OpenAiResponseCleanup, { kind: "response_deleted" }> {
  return (
    closed(value, ["kind", "reference", "terminalStatus"]) &&
    value.kind === "response_deleted" &&
    validateOpenAiBackgroundResponseReference(value.reference) &&
    value.reference.responseId === original.responseId &&
    value.reference.createdAt === original.createdAt &&
    typeof value.terminalStatus === "string" &&
    ["completed", "cancelled", "failed", "incomplete"].includes(value.terminalStatus)
  );
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(Error());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Trusted private maintenance for FAILED/ABANDONED work only, never ordinary generation.
 * The permanent admission fence precedes any provider effect. Response disposal does NOT settle
 * private writers, certify quiescence, grant finalization or authorize object/row purge.
 * Runtime/IAM and maintained scheduling are separate prerequisites; all capabilities default off.
 */
export function createCoverLetterResponseReconciler(options: {
  work: Pick<PostgresCoverLetterWorkStore, "fenceForCleanup">;
  responses: Pick<PostgresCoverLetterResponseStore, "read" | "recordDisposal">;
  cleanup: Pick<OpenAiLunaResponseCleanup, "stopAndDelete">;
  enabled?: () => boolean;
  timeoutMs?: number;
}) {
  const enabled = options.enabled ?? (() => false);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw Error("CoverLetterResponseReconciliationUnavailable");
  return async (raw: unknown, signal: AbortSignal): Promise<CoverLetterResponseReconciliation> => {
    const unresolved: CoverLetterResponseReconciliation = { kind: "unresolved" };
    try {
      if (!enabled() || signal.aborted || !validateProviderControlReference(raw)) return unresolved;
      const ref = structuredClone(raw);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      const admitted = () => {
        deadline.throwIfAborted();
        if (!enabled()) throw Error();
      };
      const fence = await bounded(options.work.fenceForCleanup(structuredClone(ref)), deadline);
      admitted();
      if (fence !== "pending" && fence !== "ledger_terminal") return unresolved;
      const row = await bounded(options.responses.read(structuredClone(ref)), deadline);
      admitted();
      if (!inventory(row, ref)) return unresolved;
      if (row.state === "disposed") return { kind: "response_disposed", reference: ref };
      if (!row.response) return unresolved;
      const original = structuredClone(row.response);
      const receipt = await bounded(
        options.cleanup.stopAndDelete(structuredClone(original), deadline),
        deadline,
      );
      admitted();
      if (!positive(receipt, original)) return unresolved;
      // Only the positive original receipt reaches SQL. A local timeout may leave a late commit;
      // replay reads the durable disposed state, never infers acknowledgement from provider 404.
      await bounded(
        options.responses.recordDisposal(structuredClone(ref), structuredClone(receipt)),
        deadline,
      );
      admitted();
      const committed = await bounded(options.responses.read(structuredClone(ref)), deadline);
      admitted();
      if (
        !inventory(committed, ref) ||
        committed.state !== "disposed" ||
        committed.response?.responseId !== original.responseId ||
        committed.response.createdAt !== original.createdAt
      )
        return unresolved;
      return { kind: "response_disposed", reference: ref };
    } catch {
      return unresolved;
    }
  };
}

/** Successful-generation response disposal only, with no admission fence/cancel/work port.
 * readCompleted must be the owning durable eligibility read, never ordinary inventory read.
 * Response disposal does not settle writers, certify quiescence or authorize object/row purge.
 */
export function createCoverLetterSuccessfulResponseReconciler(options: {
  responses: Pick<PostgresCoverLetterResponseStore, "readCompleted" | "recordDisposal">;
  cleanup: Pick<OpenAiLunaResponseCleanup, "deleteCompleted">;
  enabled?: () => boolean;
  timeoutMs?: number;
}) {
  const enabled = options.enabled ?? (() => false);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
    throw Error("CoverLetterResponseReconciliationUnavailable");
  return async (raw: unknown, signal: AbortSignal): Promise<CoverLetterResponseReconciliation> => {
    const unresolved: CoverLetterResponseReconciliation = { kind: "unresolved" };
    try {
      if (!enabled() || signal.aborted || !validateProviderControlReference(raw)) return unresolved;
      const ref = structuredClone(raw);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      const admitted = () => {
        deadline.throwIfAborted();
        if (!enabled()) throw Error();
      };
      const row = await bounded(options.responses.readCompleted(structuredClone(ref)), deadline);
      admitted();
      if (!inventory(row, ref)) return unresolved;
      if (row.state === "disposed") return { kind: "response_disposed", reference: ref };
      if (!row.response) return unresolved;
      const original = structuredClone(row.response);
      const receipt = await bounded(
        options.cleanup.deleteCompleted(structuredClone(original), deadline),
        deadline,
      );
      admitted();
      if (!positive(receipt, original) || receipt.terminalStatus !== "completed") return unresolved;
      await bounded(
        options.responses.recordDisposal(structuredClone(ref), structuredClone(receipt)),
        deadline,
      );
      admitted();
      const committed = await bounded(
        options.responses.readCompleted(structuredClone(ref)),
        deadline,
      );
      admitted();
      if (
        !inventory(committed, ref) ||
        committed.state !== "disposed" ||
        committed.response?.responseId !== original.responseId ||
        committed.response.createdAt !== original.createdAt
      )
        return unresolved;
      return { kind: "response_disposed", reference: ref };
    } catch {
      return unresolved;
    }
  };
}
