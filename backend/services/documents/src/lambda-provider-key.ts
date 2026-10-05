import { CoverLetterProviderTransportError } from "./cover-letter-provider-contract.js";

export function validProviderKey(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]{16,512}$/u.test(value);
}

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => undefined;
  try {
    signal.throwIfAborted();
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new CoverLetterProviderTransportError());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Fixed Lambda extension endpoint, one bounded read, no database or environment key fallback. */
export async function resolveLambdaProviderKey(
  input: { secretId: string; sessionToken: string },
  transport: typeof fetch = globalThis.fetch,
): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    if (
      !/^arn:aws:secretsmanager:us-east-2:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/u.test(
        input.secretId,
      ) ||
      !input.sessionToken
    )
      throw Error();
    const endpoint = new URL("http://localhost:2773/secretsmanager/get");
    endpoint.searchParams.set("secretId", input.secretId);
    const signal = AbortSignal.timeout(3_000);
    const response = await bounded(
      transport(endpoint, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { "X-Aws-Parameters-Secrets-Token": input.sessionToken },
        signal,
      }),
      signal,
    );
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw Error();
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await bounded(reader.read(), signal);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw Error();
      size += next.value.byteLength;
      if (size > 4_096) throw Error();
      chunks.push(next.value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      "SecretBinary" in payload ||
      !("SecretString" in payload) ||
      !validProviderKey(payload.SecretString)
    )
      throw Error();
    return payload.SecretString;
  } catch {
    throw new CoverLetterProviderTransportError();
  } finally {
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
