import { compileComponentValidator } from "@ai-job-apply/api-contracts";

const MAXIMUM_FOUNDATION_RESPONSE_BYTES = 1024 * 1024;
const FOUNDATION_RESPONSE_TIMEOUT_MILLISECONDS = 10_000;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export type FoundationResponseSchemaName =
  | "ResumeDocumentCollection"
  | "CreateResumeUploadResponse"
  | "ProfileFactCollection"
  | "ProfileFact";

const validators = new Map<
  FoundationResponseSchemaName,
  ReturnType<typeof compileComponentValidator>
>([
  ["ResumeDocumentCollection", compileComponentValidator("ResumeDocumentCollection")],
  ["CreateResumeUploadResponse", compileComponentValidator("CreateResumeUploadResponse")],
  ["ProfileFactCollection", compileComponentValidator("ProfileFactCollection")],
  ["ProfileFact", compileComponentValidator("ProfileFact")],
]);

function unavailable(): Response {
  return Response.json(
    {
      type: "urn:ai-job-apply:problem:platform_unavailable",
      title: "The platform API is unavailable",
      status: 503,
      code: "platform_unavailable",
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
      },
    },
  );
}

function cancelBody(cancellable: { cancel(): Promise<void> } | null): void {
  if (!cancellable) return;
  try {
    void cancellable.cancel().catch(() => undefined);
  } catch {
    // A hostile or already-locked body must not replace the fixed boundary response.
  }
}

async function boundedBody(
  response: Response,
  signal: AbortSignal | undefined,
  timeoutMilliseconds: number,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("The response body is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let complete = false;
  let cancellationRequested = false;
  let interrupted = false;
  let rejectInterruption: (error: Error) => void = () => undefined;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const cancel = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // A hostile or already-failed stream must not replace the fixed boundary response.
    }
  };
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    rejectInterruption(new Error("The response body was interrupted"));
    cancel();
  };

  const timer = setTimeout(interrupt, timeoutMilliseconds);
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();

  try {
    while (true) {
      const part = await Promise.race([reader.read(), interruption]);
      if (part.done) {
        complete = true;
        break;
      }
      if (part.value.byteLength > MAXIMUM_FOUNDATION_RESPONSE_BYTES - total) {
        throw new Error("The response body is too large");
      }
      total += part.value.byteLength;
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", interrupt);
    if (!complete) cancel();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function validateFoundationResponse(
  response: Response,
  expectedStatus: number,
  schemaName: FoundationResponseSchemaName,
  signal?: AbortSignal,
  timeoutMilliseconds = FOUNDATION_RESPONSE_TIMEOUT_MILLISECONDS,
): Promise<Response> {
  if (!response.ok) return response;

  const declaredLength = response.headers.get("content-length");
  if (
    response.status !== expectedStatus ||
    !JSON_CONTENT_TYPE_PATTERN.test(response.headers.get("content-type") ?? "") ||
    response.headers.get("transfer-encoding") !== null ||
    (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_FOUNDATION_RESPONSE_BYTES))
  ) {
    cancelBody(response.body);
    return unavailable();
  }

  try {
    const bytes = await boundedBody(response, signal, timeoutMilliseconds);
    if (
      bytes.byteLength === 0 ||
      (declaredLength !== null && Number(declaredLength) !== bytes.byteLength)
    ) {
      throw new Error("The response body length is invalid");
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(decoded);
    if (!validators.get(schemaName)?.(value)) {
      throw new Error("The response body does not match its contract");
    }

    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    const correlationId = response.headers.get("x-correlation-id");
    if (correlationId) headers.set("x-correlation-id", correlationId);
    return new Response(JSON.stringify(value), { status: expectedStatus, headers });
  } catch {
    return unavailable();
  }
}
