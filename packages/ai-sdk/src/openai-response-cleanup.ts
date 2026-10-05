import {
  type OpenAiBackgroundResponseReference,
  validateOpenAiBackgroundResponseReference,
} from "./provider-background-contract.js";

export {
  type OpenAiBackgroundResponseReference,
  validateOpenAiBackgroundResponseReference,
} from "./provider-background-contract.js";

/** Private provider-response cleanup only. References must come from owned, durably captured
 * original creation acknowledgements, never candidate input. No creation/generation capability.
 * A response deletion receipt is not platform quiescence or abuse-monitoring deletion proof.
 */
export type OpenAiResponseCleanup =
  | { kind: "unresolved" }
  | {
      kind: "response_deleted";
      reference: OpenAiBackgroundResponseReference;
      terminalStatus: "completed" | "cancelled" | "failed" | "incomplete";
    };

const ENDPOINT = "https://api.openai.com/v1/responses/";
const MAX_BYTES = 128_000;
const terminal = ["completed", "cancelled", "failed", "incomplete"] as const;
type TerminalStatus = (typeof terminal)[number];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("ProviderResponseCleanupUnresolved"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function read(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.status !== 200 || response.redirected || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw Error();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await bounded(reader.read(), signal);
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_BYTES) throw Error();
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    // Do not let a stalled cancellation acknowledgement hold the bounded caller open.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function status(
  value: unknown,
  reference: OpenAiBackgroundResponseReference,
): TerminalStatus | "queued" | "in_progress" | undefined {
  if (
    !record(value) ||
    value.object !== "response" ||
    value.id !== reference.responseId ||
    value.created_at !== reference.createdAt ||
    value.model !== "gpt-6-luna" ||
    value.background !== true ||
    value.store !== false ||
    value.previous_response_id !== null ||
    !Array.isArray(value.tools) ||
    value.tools.length !== 0
  )
    return;
  if (value.status === "queued" || value.status === "in_progress") return value.status;
  return terminal.find((candidate) => candidate === value.status);
}

/** Default-off, fixed-endpoint, single-attempt cleanup for an already-owned response.
 * Each call does one GET, at most one cancel POST, then one DELETE after exact terminal proof.
 * Missing/expired responses, HTTP errors, malformed/lost/late acknowledgements and local abort
 * all remain unresolved. No retry, polling loop, provider dispatch or SQL settlement is supplied.
 */
export class OpenAiLunaResponseCleanup {
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      enabled?: () => boolean;
      apiKey: () => string | undefined;
      fetch?: typeof fetch;
      /** Local I/O budget only, never a provider stopping or retention guarantee. */
      timeoutMs?: number;
    },
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000)
      throw new Error("ProviderResponseCleanupUnresolved");
  }

  async stopAndDelete(raw: unknown, signal: AbortSignal): Promise<OpenAiResponseCleanup> {
    return this.cleanup(raw, signal, "any_terminal");
  }

  /** Completion-only maintenance: exact original completed proof before deletion, no cancel.
   * Caller must separately establish successful-generation eligibility from owned durable state.
   * A completion/disposal receipt cannot settle writers or authorize platform purge.
   */
  async deleteCompleted(raw: unknown, signal: AbortSignal): Promise<OpenAiResponseCleanup> {
    return this.cleanup(raw, signal, "completed");
  }

  private async cleanup(
    raw: unknown,
    signal: AbortSignal,
    mode: "any_terminal" | "completed",
  ): Promise<OpenAiResponseCleanup> {
    const unresolved: OpenAiResponseCleanup = { kind: "unresolved" };
    try {
      if (!validateOpenAiBackgroundResponseReference(raw)) return unresolved;
      const reference = structuredClone(raw);
      if (this.options.enabled?.() !== true || signal.aborted) return unresolved;
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
      const apiKey = this.options.apiKey();
      if (!apiKey) return unresolved;
      const transport = this.options.fetch ?? globalThis.fetch;
      const call = async (method: "GET" | "POST" | "DELETE", suffix = "") => {
        deadline.throwIfAborted();
        if (this.options.enabled?.() !== true) throw Error();
        const pending = transport(`${ENDPOINT}${reference.responseId}${suffix}`, {
          method,
          redirect: "error",
          signal: deadline,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        });
        // A transport that ignores cancellation can deliver a body after our bounded caller
        // has returned. Dispose that unread local stream; never promote it to a receipt.
        void pending.then(
          (late) => {
            if (deadline.aborted) void late.body?.cancel().catch(() => undefined);
          },
          () => undefined,
        );
        const response = await bounded(pending, deadline);
        const value = await read(response, deadline);
        if (this.options.enabled?.() !== true) throw Error();
        deadline.throwIfAborted();
        return value;
      };
      let observed = status(await call("GET"), reference);
      if (mode === "completed" && observed !== "completed") return unresolved;
      if (mode === "any_terminal" && (observed === "queued" || observed === "in_progress"))
        observed = status(await call("POST", "/cancel"), reference);
      if (!observed || observed === "queued" || observed === "in_progress") return unresolved;
      const deleted = await call("DELETE");
      if (
        !record(deleted) ||
        Reflect.ownKeys(deleted).length !== 3 ||
        deleted.id !== reference.responseId ||
        deleted.object !== "response.deleted" ||
        deleted.deleted !== true
      )
        return unresolved;
      return { kind: "response_deleted", reference, terminalStatus: observed };
    } catch {
      // Never reflect provider bodies, candidate text, credentials or transport diagnostics.
      return unresolved;
    }
  }
}
