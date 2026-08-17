export class RequestBodyTooLargeError extends Error {}

interface BoundedRequestBodyOptions {
  maximumBytes: number;
  timeoutMilliseconds: number;
}

export async function readBoundedRequestBody(
  request: Request,
  { maximumBytes, timeoutMilliseconds }: BoundedRequestBodyOptions,
): Promise<Uint8Array> {
  if (!request.body) throw new Error("The request body is unavailable");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("The request body limit is invalid");
  }
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new Error("The request body timeout is invalid");
  }

  const reader = request.body.getReader();
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
      // A hostile or already-failed stream must not replace the fixed caller response.
    }
  };
  const interrupt = () => {
    if (interrupted) return;
    interrupted = true;
    rejectInterruption(new Error("The request body was interrupted"));
    cancel();
  };

  const timer = setTimeout(interrupt, timeoutMilliseconds);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();

  try {
    while (true) {
      const part = await Promise.race([reader.read(), interruption]);
      if (part.done) {
        complete = true;
        break;
      }
      if (part.value.byteLength > maximumBytes - total) {
        throw new RequestBodyTooLargeError();
      }
      total += part.value.byteLength;
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", interrupt);
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
