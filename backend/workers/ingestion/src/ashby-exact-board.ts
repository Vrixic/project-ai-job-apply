import { setImmediate as yieldToEventLoop } from "node:timers/promises";

/** Separate exact-verification profile; it does not widen scheduled board acquisition. */
export const ashbyExactBoardProfile = Object.freeze({
  version: "ashby-exact-board-v1",
  maximumResponseBytes: 16_000_000,
  maximumJobs: 1_000,
  maximumRecordBytes: 512_000,
  maximumEnvelopeValueBytes: 64_000,
  maximumDepth: 32,
  maximumRootFields: 16,
  requestTimeoutMs: 5_000,
} as const);

const jobBoardPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;
const postingIdPattern = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/;
const whitespace = (character: string) =>
  character === " " || character === "\t" || character === "\r" || character === "\n";

class InvalidBoard extends Error {
  constructor() {
    super("The Ashby exact-board response is invalid or exceeds its bounds");
  }
}

/** Validate duplicate decoded keys before JSON.parse can discard them. No tree is built here. */
function parseValue(raw: string, parentDepth: number, check: () => void): unknown {
  let offset = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const skip = () => {
    while (offset < raw.length && whitespace(raw[offset] as string)) {
      if (offset % 2_048 === 0) check();
      offset += 1;
    }
  };
  const string = (): string => {
    const start = offset;
    if (raw[offset++] !== '"') throw new InvalidBoard();
    while (offset < raw.length) {
      if (offset % 2_048 === 0) check();
      const character = raw[offset++] as string;
      if (character === '"') return raw.slice(start, offset);
      if (character.charCodeAt(0) < 32) throw new InvalidBoard();
      if (character !== "\\") continue;
      const escaped = raw[offset++];
      if (escaped === "u") {
        if (!/^[\da-fA-F]{4}$/.test(raw.slice(offset, offset + 4))) throw new InvalidBoard();
        offset += 4;
      } else if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) {
        throw new InvalidBoard();
      }
    }
    throw new InvalidBoard();
  };
  const value = (depth: number): void => {
    check();
    skip();
    const character = raw[offset];
    if (character === '"') {
      string();
      return;
    }
    if (character === "{" || character === "[") {
      if (depth + 1 > ashbyExactBoardProfile.maximumDepth) throw new InvalidBoard();
      const object = character === "{";
      const end = object ? "}" : "]";
      const keys = new Set<string>();
      offset += 1;
      skip();
      if (raw[offset] === end) {
        offset += 1;
        return;
      }
      while (true) {
        if (object) {
          const key = JSON.parse(string()) as string;
          if (keys.has(key)) throw new InvalidBoard();
          keys.add(key);
          skip();
          if (raw[offset++] !== ":") throw new InvalidBoard();
        }
        value(depth + 1);
        skip();
        const separator = raw[offset++];
        if (separator === end) return;
        if (separator !== ",") throw new InvalidBoard();
        skip();
      }
    }
    for (const literal of ["true", "false", "null"]) {
      if (raw.startsWith(literal, offset)) {
        offset += literal.length;
        return;
      }
    }
    number.lastIndex = offset;
    if (!number.test(raw)) throw new InvalidBoard();
    offset = number.lastIndex;
  };
  value(parentDepth);
  skip();
  if (offset !== raw.length) throw new InvalidBoard();
  check();
  const result: unknown = JSON.parse(raw);
  check();
  return result;
}

/** One bounded raw value, appended by chunk slices rather than per-character allocations. */
class ValueCapture {
  readonly #parts: string[] = [];
  readonly #stack: string[] = [];
  readonly #kind: "container" | "string" | "primitive";
  #inString = false;
  #escaped = false;
  #bytes = 0;
  #pendingPart = "";

  constructor(
    first: string,
    readonly maximumBytes: number,
    readonly parentDepth: number,
  ) {
    this.#kind =
      first === "{" || first === "[" ? "container" : first === '"' ? "string" : "primitive";
  }

  consume(text: string, start: number, check: () => void): { end: number; complete: boolean } {
    let offset = start;
    let complete = false;
    for (; offset < text.length; offset += 1) {
      if (offset % 2_048 === 0) check();
      const character = text[offset] as string;
      if (this.#kind === "primitive") {
        if (whitespace(character) || character === "," || character === "}" || character === "]") {
          complete = true;
          break;
        }
        continue;
      }
      if (this.#inString) {
        if (this.#escaped) this.#escaped = false;
        else if (character === "\\") this.#escaped = true;
        else if (character === '"') {
          this.#inString = false;
          if (this.#kind === "string") {
            offset += 1;
            complete = true;
            break;
          }
        }
      } else if (character === '"') this.#inString = true;
      else if (character === "{" || character === "[") {
        this.#stack.push(character === "{" ? "}" : "]");
        if (this.parentDepth + this.#stack.length > ashbyExactBoardProfile.maximumDepth)
          throw new InvalidBoard();
      } else if (character === "}" || character === "]") {
        if (this.#stack.pop() !== character) throw new InvalidBoard();
        if (this.#stack.length === 0) {
          offset += 1;
          complete = true;
          break;
        }
      }
    }
    const part = text.slice(start, offset);
    this.#bytes += Buffer.byteLength(part, "utf8");
    if (this.#bytes > this.maximumBytes) throw new InvalidBoard();
    // Tiny transport chunks must not turn a bounded value into hundreds of
    // thousands of retained array entries. Coalesce only the small pending part,
    // never repeatedly copy the growing complete value.
    this.#pendingPart += part;
    if (this.#pendingPart.length >= 4_096) {
      this.#parts.push(this.#pendingPart);
      this.#pendingPart = "";
    }
    return { end: offset, complete };
  }

  finish(check: () => void): unknown {
    return parseValue(this.#parts.join("") + this.#pendingPart, this.parentDepth, check);
  }
}

type State =
  | "start"
  | "key_or_end"
  | "key"
  | "colon"
  | "value"
  | "root_separator"
  | "job_or_end"
  | "job"
  | "job_separator"
  | "end";

/** The root/jobs delimiters are parsed incrementally; the jobs array is never materialized. */
class BoardReader {
  #state: State = "start";
  #capture: ValueCapture | undefined;
  #captureKind: "key" | "envelope" | "job" = "key";
  readonly #keys = new Set<string>();
  #key = "";
  #jobs = 0;
  #versionAccepted = false;
  #selected: unknown = null;
  #matched = false;

  constructor(
    readonly onJob: (job: unknown) => boolean,
    readonly check: () => void,
  ) {}

  push(text: string): void {
    let offset = 0;
    while (offset < text.length) {
      this.check();
      if (this.#capture) {
        const result = this.#capture.consume(text, offset, this.check);
        offset = result.end;
        if (result.complete) this.completeValue();
        continue;
      }
      const character = text[offset] as string;
      if (whitespace(character)) {
        offset += 1;
        continue;
      }
      switch (this.#state) {
        case "start":
          if (character !== "{") throw new InvalidBoard();
          this.#state = "key_or_end";
          break;
        case "key_or_end":
          if (character === "}") {
            this.#state = "end";
            break;
          }
          this.#state = "key";
          continue;
        case "key":
          if (character !== '"') throw new InvalidBoard();
          this.capture("key", character);
          continue;
        case "colon":
          if (character !== ":") throw new InvalidBoard();
          this.#state = "value";
          break;
        case "value":
          if (this.#key === "jobs") {
            if (character !== "[") throw new InvalidBoard();
            this.#state = "job_or_end";
            break;
          }
          this.capture("envelope", character);
          continue;
        case "job_or_end":
          if (character === "]") {
            this.#state = "root_separator";
            break;
          }
          this.#state = "job";
          continue;
        case "job":
          if (character !== "{" || ++this.#jobs > ashbyExactBoardProfile.maximumJobs)
            throw new InvalidBoard();
          this.capture("job", character);
          continue;
        case "job_separator":
          if (character === ",") this.#state = "job";
          else if (character === "]") this.#state = "root_separator";
          else throw new InvalidBoard();
          break;
        case "root_separator":
          if (character === ",") this.#state = "key";
          else if (character === "}") this.#state = "end";
          else throw new InvalidBoard();
          break;
        case "end":
          throw new InvalidBoard();
      }
      offset += 1;
    }
  }

  finish(): unknown {
    this.check();
    if (this.#state !== "end" || this.#capture || !this.#versionAccepted || !this.#keys.has("jobs"))
      throw new InvalidBoard();
    return this.#selected;
  }

  private capture(kind: "key" | "envelope" | "job", first: string): void {
    this.#captureKind = kind;
    this.#capture = new ValueCapture(
      first,
      kind === "job"
        ? ashbyExactBoardProfile.maximumRecordBytes
        : ashbyExactBoardProfile.maximumEnvelopeValueBytes,
      kind === "job" ? 2 : 1,
    );
  }

  private completeValue(): void {
    const value = this.#capture?.finish(this.check);
    this.#capture = undefined;
    if (this.#captureKind === "key") {
      if (
        typeof value !== "string" ||
        this.#keys.has(value) ||
        this.#keys.size >= ashbyExactBoardProfile.maximumRootFields
      )
        throw new InvalidBoard();
      this.#keys.add(value);
      this.#key = value;
      this.#state = "colon";
    } else if (this.#captureKind === "envelope") {
      if (this.#key === "apiVersion") {
        if (value !== "1") throw new InvalidBoard();
        this.#versionAccepted = true;
      }
      this.#state = "root_separator";
    } else {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidBoard();
      let selected: boolean;
      try {
        selected = this.onJob(value);
      } catch {
        throw new InvalidBoard();
      }
      this.check();
      if (typeof selected !== "boolean" || (selected && this.#matched)) throw new InvalidBoard();
      if (selected) {
        this.#selected = value;
        this.#matched = true;
      }
      this.#state = "job_separator";
    }
  }
}

function cancel(body: { cancel(): Promise<unknown> } | null | undefined): void {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    /* Cleanup must not replace the result. */
  }
}

async function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let listener: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    listener = () => reject(new Error("The Ashby acquisition was interrupted"));
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  try {
    // Always observe the original promise, including a transport that aborts
    // synchronously before returning a rejected promise.
    return await Promise.race([promise, interrupted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

export async function fetchAshbyExactBoard(options: {
  fetch: typeof globalThis.fetch;
  jobBoardName: string;
  externalJobId: string;
  signal: AbortSignal;
  onJob: (job: unknown) => boolean;
}): Promise<
  | { kind: "success"; job: unknown | null }
  | { kind: "retry"; reason: "rate_limited" | "source_unavailable" | "timeout" }
> {
  if (
    typeof options.jobBoardName !== "string" ||
    !jobBoardPattern.test(options.jobBoardName) ||
    typeof options.externalJobId !== "string" ||
    !postingIdPattern.test(options.externalJobId) ||
    typeof options.fetch !== "function" ||
    typeof options.onJob !== "function"
  ) {
    throw new Error("Canonical Ashby exact-verification identifiers and callbacks are required");
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const deadline = performance.now() + ashbyExactBoardProfile.requestTimeoutMs;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ashbyExactBoardProfile.requestTimeoutMs);
  const check = () => {
    if (performance.now() >= deadline) {
      timedOut = true;
      controller.abort();
    }
    signal.throwIfAborted();
  };
  const unavailable = () => ({
    kind: "retry" as const,
    reason:
      timedOut && !options.signal.aborted ? ("timeout" as const) : ("source_unavailable" as const),
  });
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    check();
    const pending = options
      .fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${options.jobBoardName}?includeCompensation=false`,
        {
          method: "GET",
          redirect: "error",
          signal,
          headers: { accept: "application/json" },
        },
      )
      .then((value) => {
        // An injected fetch may resolve after cancellation despite ignoring its signal.
        if (signal.aborted) cancel(value.body);
        return value;
      });
    response = await interruptible(pending, signal);
    check();
    if (response.status === 429) return { kind: "retry", reason: "rate_limited" };
    if (response.status !== 200) return { kind: "retry", reason: "source_unavailable" };
    if (
      response.redirected ||
      response.headers.has("content-range") ||
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
    )
      throw new InvalidBoard();
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d{1,12}$/.test(declared) ||
        Number(declared) > ashbyExactBoardProfile.maximumResponseBytes)
    )
      throw new InvalidBoard();
    if (!response.body) throw new InvalidBoard();
    reader = response.body.getReader();
    // ignoreBOM retains a BOM so the JSON grammar rejects it, including at chunk boundaries.
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const parser = new BoardReader(options.onJob, check);
    let bytes = 0;
    while (true) {
      const part = await interruptible(reader.read(), signal);
      check();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new InvalidBoard();
      bytes += part.value.byteLength;
      if (bytes > ashbyExactBoardProfile.maximumResponseBytes) throw new InvalidBoard();
      // A transport can deliver a large chunk: decode/process bounded slices and yield
      // to cancellation between them instead of allocating one complete decoded board.
      for (let offset = 0; offset < part.value.byteLength; offset += 16_384) {
        let decoded: string;
        try {
          decoded = decoder.decode(part.value.subarray(offset, offset + 16_384), { stream: true });
        } catch {
          throw new InvalidBoard();
        }
        parser.push(decoded);
        await yieldToEventLoop(undefined, { signal });
        check();
      }
    }
    let tail: string;
    try {
      tail = decoder.decode();
    } catch {
      throw new InvalidBoard();
    }
    parser.push(tail);
    return { kind: "success", job: parser.finish() };
  } catch (error) {
    if (signal.aborted || performance.now() >= deadline) {
      if (performance.now() >= deadline) timedOut = true;
      return unavailable();
    }
    if (error instanceof InvalidBoard) throw error;
    return unavailable();
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (reader) {
      cancel(reader);
      try {
        reader.releaseLock();
      } catch {
        /* A hostile injected reader cannot block cleanup. */
      }
    } else cancel(response?.body);
  }
}
