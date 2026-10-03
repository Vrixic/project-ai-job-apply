import type { BackgroundResponseCapture, ProviderRequest } from "./gateway.js";
import { validateOpenAiBackgroundResponseReference } from "./openai-response-cleanup.js";

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_BYTES = 128_000;
const MAX_POLLS = 30;

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(Error());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function read(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (response.status !== 200 || response.redirected || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw Error();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await bounded(reader.read(), signal);
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_BYTES) throw Error();
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value as Record<string, unknown>;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Internal adapter implementation only. No credentials/bootstrap, settlement, disposal or retry.
 * Creation is single-attempt; GETs poll the same original identity, never redispatch generation.
 * Lost creation/capture acknowledgements remain unresolved even after temporary polling expiry.
 */
export async function originalBackgroundResponse(options: {
  request: ProviderRequest;
  capture: BackgroundResponseCapture;
  enabled: () => boolean;
  apiKey: string;
  transport: typeof fetch;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { request, capture, enabled, transport } = options;
  request.signal.throwIfAborted();
  if (!enabled()) throw Error();
  // Await the actual committed reservation, not a local timeout race. Its lost ACK grants nothing.
  if ((await capture.reserve()) !== "reserved") throw Error();
  const call = async (method: "POST" | "GET", url: string) => {
    request.signal.throwIfAborted();
    if (!enabled()) throw Error();
    const pending = transport(url, {
      method,
      redirect: "error",
      signal: request.signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(options.body) } : {}),
    });
    void pending.then(
      (late) => {
        if (request.signal.aborted) void late.body?.cancel().catch(() => undefined);
      },
      () => undefined,
    );
    return read(await bounded(pending, request.signal), request.signal);
  };
  let value = await call("POST", ENDPOINT);
  const reference = {
    schemaVersion: 1 as const,
    responseId: value.id,
    createdAt: value.created_at,
  };
  if (!validateOpenAiBackgroundResponseReference(reference)) throw Error();
  const verify = (current: Record<string, unknown>) => {
    if (
      current.object !== "response" ||
      current.id !== reference.responseId ||
      current.created_at !== reference.createdAt ||
      current.model !== "gpt-6-luna" ||
      current.background !== true ||
      current.store !== false ||
      current.previous_response_id !== null ||
      current.conversation != null ||
      !Array.isArray(current.tools) ||
      current.tools.length !== 0 ||
      typeof current.status !== "string" ||
      !["queued", "in_progress", "completed", "failed", "cancelled", "incomplete"].includes(
        current.status,
      )
    )
      throw Error();
  };
  verify(value);
  // Persist only id/time, even if the creation response already contains completed output.
  // No poll, content consumption or completion is permitted after a lost capture ACK.
  await capture.recordCreation(structuredClone(reference));
  for (let poll = 0; value.status === "queued" || value.status === "in_progress"; poll++) {
    if (poll >= MAX_POLLS) throw Error();
    await bounded(
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 1_000);
        request.signal.addEventListener("abort", finish, { once: true });
        if (request.signal.aborted) finish();
      }),
      request.signal,
    );
    value = await call("GET", `${ENDPOINT}/${reference.responseId}`);
    verify(value);
  }
  request.signal.throwIfAborted();
  if (!enabled() || value.status !== "completed") throw Error();
  return value;
}
