import { afterEach, describe, expect, it, vi } from "vitest";
import { ashbyExactBoardProfile, fetchAshbyExactBoard } from "./ashby-exact-board.js";

const board = "synthetic-board";
const targetId = "12345678-abcd-4abc-8abc-1234567890ab";
const targetUrl = `https://jobs.ashbyhq.com/${board}/${targetId}`;
const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=false`;
const encoder = new TextEncoder();

function job(index = 0, extra: Record<string, unknown> = {}) {
  return {
    jobUrl:
      index === 0 ? targetUrl : `https://jobs.ashbyhq.com/${board}/synthetic-posting-${index}`,
    title: "Generated boundary test posting",
    isListed: true,
    ...extra,
  };
}

function selected(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).jobUrl === targetUrl
  );
}

function document(jobs: unknown[] = [job()], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ apiVersion: "1", jobs, ...extra });
}

function streamingResponse(
  value: string | Uint8Array,
  chunkSize = 16_384,
  headers: Record<string, string> = {},
) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let readBytes = 0;
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (readBytes === bytes.byteLength) {
            controller.close();
            return;
          }
          const next = Math.min(readBytes + chunkSize, bytes.byteLength);
          controller.enqueue(bytes.slice(readBytes, next));
          readBytes = next;
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
    { headers: { "content-type": "application/json; charset=utf-8", ...headers } },
  );
  return { response, cancel, readBytes: () => readBytes, length: bytes.byteLength };
}

function read(
  response: Response,
  options: { signal?: AbortSignal; onJob?: (value: unknown) => boolean } = {},
) {
  return fetchAshbyExactBoard({
    fetch: vi.fn<typeof globalThis.fetch>(async () => response),
    jobBoardName: board,
    externalJobId: targetId,
    signal: options.signal ?? new AbortController().signal,
    onJob: options.onJob ?? selected,
  });
}

function sizedJob(bytes: number): string {
  const record = job(0, { padding: "" });
  const overhead = encoder.encode(JSON.stringify(record)).byteLength;
  return JSON.stringify({ ...record, padding: "x".repeat(bytes - overhead) });
}

function nested(levels: number): unknown {
  let result: unknown = "leaf";
  for (let depth = 0; depth < levels; depth += 1) result = { child: result };
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Ashby exact-board fixed acquisition boundary", () => {
  it("publishes a frozen, versioned profile independent of the general board limits", () => {
    expect(ashbyExactBoardProfile).toEqual({
      version: "ashby-exact-board-v1",
      maximumResponseBytes: 16_000_000,
      maximumJobs: 1_000,
      maximumRecordBytes: 512_000,
      maximumEnvelopeValueBytes: 64_000,
      maximumDepth: 32,
      maximumRootFields: 16,
      requestTimeoutMs: 5_000,
    });
    expect(Object.isFrozen(ashbyExactBoardProfile)).toBe(true);
  });

  it("requests only the documented fixed-host GET without compensation, credentials or redirects", async () => {
    const fixture = streamingResponse(document());
    const fetch = vi.fn<typeof globalThis.fetch>(async () => fixture.response);
    const result = await fetchAshbyExactBoard({
      fetch,
      jobBoardName: board,
      externalJobId: targetId,
      signal: new AbortController().signal,
      onJob: selected,
    });
    expect(result).toEqual({ kind: "success", job: job() });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    const request = fetch.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(request?.body).toBeUndefined();
    expect(fixture.readBytes()).toBe(fixture.length);
    expect(fixture.response.body?.locked).toBe(false);
  });

  it.each([
    { jobBoardName: "../synthetic-board", externalJobId: targetId },
    { jobBoardName: "synthetic-board?includeCompensation=true", externalJobId: targetId },
    { jobBoardName: "synthetic-board/elsewhere", externalJobId: targetId },
    { jobBoardName: "https://example.test", externalJobId: targetId },
    { jobBoardName: board, externalJobId: "../other-job" },
    { jobBoardName: board, externalJobId: "job?query=value" },
    { jobBoardName: board, externalJobId: "job%2fother" },
    { jobBoardName: board, externalJobId: "short" },
  ])("rejects invalid target identity before any request: %j", async (identity) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      fetchAshbyExactBoard({
        fetch,
        ...identity,
        signal: new AbortController().signal,
        onJob: selected,
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("streams more than one megabyte and 100 jobs, parsing records individually and returning only the target", async () => {
    const records = Array.from({ length: 120 }, (_, index) =>
      job(index, { descriptionPlain: `generated-${index}:${"x".repeat(10_000)}` }),
    );
    const fixture = streamingResponse(document(records));
    expect(fixture.length).toBeGreaterThan(1_000_000);
    const observedProgress: number[] = [];
    const onJob = vi.fn((value: unknown) => {
      observedProgress.push(fixture.readBytes());
      return selected(value);
    });
    const parse = vi.spyOn(JSON, "parse");
    const result = await read(fixture.response, { onJob });
    expect(result).toEqual({ kind: "success", job: records[0] });
    expect(onJob).toHaveBeenCalledTimes(120);
    expect(observedProgress[0]).toBeLessThan(fixture.length);
    expect(parse.mock.calls.every(([value]) => encoder.encode(value).byteLength <= 512_000)).toBe(
      true,
    );
    expect(Object.keys(result).sort()).toEqual(["job", "kind"]);
    expect(fixture.response.body?.locked).toBe(false);
  });

  it("accepts exactly 1,000 records without reducing the source to the first 100", async () => {
    const records = Array.from({ length: 999 }, (_, index) => job(index + 1));
    records.push(job());
    const onJob = vi.fn(selected);
    await expect(read(streamingResponse(document(records)).response, { onJob })).resolves.toEqual({
      kind: "success",
      job: job(),
    });
    expect(onJob).toHaveBeenCalledTimes(1_000);
  });

  it("refuses record 1,001 even when the target was first", async () => {
    const records = Array.from({ length: 1_001 }, (_, index) => job(index));
    const fixture = streamingResponse(document(records));
    await expect(read(fixture.response)).rejects.toThrow();
    expect(fixture.response.body?.locked).toBe(false);
  });

  it.each([512_000, 512_001])("enforces the record byte boundary at %i", async (length) => {
    const rawJob = sizedJob(length);
    expect(encoder.encode(rawJob).byteLength).toBe(length);
    const fixture = streamingResponse(`{"apiVersion":"1","jobs":[${rawJob}]}`);
    if (length === 512_000) {
      await expect(read(fixture.response)).resolves.toEqual({
        kind: "success",
        job: JSON.parse(rawJob),
      });
    } else {
      await expect(read(fixture.response)).rejects.toThrow();
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
    }
    expect(fixture.response.body?.locked).toBe(false);
  });

  it("counts multibyte record bytes rather than UTF-16 characters", async () => {
    const fixture = streamingResponse(document([job(0, { padding: "界".repeat(180_000) })]));
    await expect(read(fixture.response)).rejects.toThrow();
  });

  it.each([64_000, 64_001])(
    "enforces the ignored envelope-value byte boundary at %i",
    async (length) => {
      const fixture = streamingResponse(document([job()], { metadata: "x".repeat(length - 2) }));
      if (length === 64_000) {
        await expect(read(fixture.response)).resolves.toEqual({ kind: "success", job: job() });
      } else {
        await expect(read(fixture.response)).rejects.toThrow();
      }
    },
  );

  it("counts multibyte envelope bytes even for an ignored root field", async () => {
    await expect(
      read(streamingResponse(document([job()], { metadata: "界".repeat(22_000) })).response),
    ).rejects.toThrow();
  });

  it.each([16, 17])("enforces the total root-field boundary at %i", async (fields) => {
    const metadata = Object.fromEntries(
      Array.from({ length: fields - 2 }, (_, index) => [`metadata${index}`, true]),
    );
    const result = read(streamingResponse(document([job()], metadata)).response);
    if (fields === 16) await expect(result).resolves.toEqual({ kind: "success", job: job() });
    else await expect(result).rejects.toThrow();
  });

  it.each(["record", "envelope"])(
    "rejects excessive %s nesting, including ignored content",
    async (kind) => {
      const raw =
        kind === "record"
          ? document([job(0, { metadata: nested(40) })])
          : document([job()], { metadata: nested(40) });
      await expect(read(streamingResponse(raw, 7).response)).rejects.toThrow();
    },
  );

  it.each([
    { kind: "record", nestedLevels: 29, accepted: true },
    { kind: "record", nestedLevels: 30, accepted: false },
    { kind: "envelope", nestedLevels: 31, accepted: true },
    { kind: "envelope", nestedLevels: 32, accepted: false },
  ])("counts total document depth, including the root and jobs array: %j", async (test) => {
    const target = job(0, test.kind === "record" ? { metadata: nested(test.nestedLevels) } : {});
    const raw = document(
      [target],
      test.kind === "envelope" ? { metadata: nested(test.nestedLevels) } : {},
    );
    const pending = read(streamingResponse(raw, 3).response);
    if (test.accepted) await expect(pending).resolves.toEqual({ kind: "success", job: target });
    else await expect(pending).rejects.toThrow();
  });

  it("accepts bounded nested values with delimiters inside quoted strings", async () => {
    const value = job(0, { metadata: nested(20), text: 'escaped " } ] { [ \\ end' });
    await expect(read(streamingResponse(document([value]), 1).response)).resolves.toEqual({
      kind: "success",
      job: value,
    });
  });

  it.each([16_000_000, 16_000_001])(
    "enforces all acquired bytes, including trailing whitespace, at %i",
    async (length) => {
      const prefix = document();
      const raw = prefix + " ".repeat(length - encoder.encode(prefix).byteLength);
      // An inaccurate or compressed-wire Content-Length cannot bypass the acquired-byte count.
      const fixture = streamingResponse(raw, 65_536, { "content-length": "1" });
      if (length === 16_000_000) {
        await expect(read(fixture.response)).resolves.toEqual({ kind: "success", job: job() });
      } else {
        await expect(read(fixture.response)).rejects.toThrow();
        expect(fixture.cancel).toHaveBeenCalledTimes(1);
      }
      expect(fixture.response.body?.locked).toBe(false);
    },
  );

  it.each(["16000001", "-1", "unknown", "1.5", "1e3"])(
    "rejects invalid or oversized declared content length %s without consuming the body",
    async (length) => {
      const fixture = streamingResponse(document(), 1, { "content-length": length });
      await expect(read(fixture.response)).rejects.toThrow();
      expect(fixture.readBytes()).toBe(0);
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
      expect(fixture.response.body?.locked).toBe(false);
    },
  );

  it.each(["text/html", "text/plain", "application/problem+json", ""])(
    "rejects non-JSON response type %s and cancels unread data",
    async (type) => {
      const fixture = streamingResponse(document(), 1, { "content-type": type });
      await expect(read(fixture.response)).rejects.toThrow();
      expect(fixture.readBytes()).toBe(0);
      expect(fixture.cancel).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Ashby exact-board complete JSON and target evidence", () => {
  it.each([
    null,
    true,
    false,
    0,
    -0.125,
    1.25e30,
    "",
    "literal } ] { [ delimiters",
    [],
    {},
    [true, null, 1, "x", { inner: [false, 'quoted \\" value'] }],
  ])(
    "matches independently decoded valid JSON for bounded ignored metadata: %j",
    async (metadata) => {
      const raw = JSON.stringify({ apiVersion: "1", metadata, jobs: [job()] });
      const independentlyParsed = JSON.parse(raw) as { jobs: unknown[] };
      for (const chunkSize of [1, 7, 128]) {
        await expect(read(streamingResponse(raw, chunkSize).response)).resolves.toEqual({
          kind: "success",
          job: independentlyParsed.jobs[0],
        });
      }
    },
  );

  it.each([1, 2, 7, 31, 65_536])(
    "matches independent JSON decoding across %i-byte Unicode chunks",
    async (chunkSize) => {
      const records = [
        job(1, { text: "discarded generated record" }),
        job(0, { text: '界🧪é\n\t"\\ ][}{', metadata: [true, false, null, -12.3e4, nested(4)] }),
        job(2, { text: "discarded final generated record" }),
      ];
      const raw = ` \r\n\t${JSON.stringify({ metadata: { escaped: "\\u007b" }, jobs: records, apiVersion: "1" })}\r\n`;
      const independentlyParsed = JSON.parse(raw) as { jobs: unknown[] };
      await expect(read(streamingResponse(raw, chunkSize).response)).resolves.toEqual({
        kind: "success",
        job: independentlyParsed.jobs.find(selected),
      });
    },
  );

  it("decodes escaped root and nested keys while preserving escaped text", async () => {
    const raw = `{"api\\u0056ersion":"1","jo\\u0062s":[{"jobUrl":${JSON.stringify(targetUrl)},"te\\u0078t":"\\u754c\\ud83e\\uddea"}]}`;
    const expected = (JSON.parse(raw) as { jobs: unknown[] }).jobs[0];
    await expect(read(streamingResponse(raw, 1).response)).resolves.toEqual({
      kind: "success",
      job: expected,
    });
  });

  it.each([
    ["no target", document([job(1), job(2)])],
    ["empty board", document([])],
  ])("returns target absence, never withdrawal or closure: %s", async (_label, raw) => {
    await expect(read(streamingResponse(raw).response)).resolves.toEqual({
      kind: "success",
      job: null,
    });
  });

  it("returns an explicitly unlisted target unchanged for the owning adapter's disposition", async () => {
    const unlisted = job(0, { isListed: false });
    await expect(read(streamingResponse(document([unlisted])).response)).resolves.toEqual({
      kind: "success",
      job: unlisted,
    });
  });

  it("rejects two matching targets even when their complete records agree", async () => {
    await expect(read(streamingResponse(document([job(), job()]), 3).response)).rejects.toThrow();
  });

  it.each([
    ["duplicate apiVersion", '{"apiVersion":"1","apiVersion":"1","jobs":[]}'],
    ["escaped duplicate root key", '{"apiVersion":"1","api\\u0056ersion":"1","jobs":[]}'],
    ["duplicate jobs", '{"apiVersion":"1","jobs":[],"jobs":[]}'],
    ["duplicate ignored root key", '{"apiVersion":"1","jobs":[],"meta":1,"meta":1}'],
    ["duplicate record key", '{"apiVersion":"1","jobs":[{"key":1,"key":2}]}'],
    ["escaped duplicate record key", '{"apiVersion":"1","jobs":[{"key":1,"\\u006bey":2}]}'],
    ["duplicate nested record key", '{"apiVersion":"1","jobs":[{"meta":{"key":1,"key":2}}]}'],
    ["duplicate ignored nested key", '{"apiVersion":"1","jobs":[],"meta":{"key":1,"key":2}}'],
  ])("rejects ambiguous object keys: %s", async (_label, raw) => {
    await expect(read(streamingResponse(raw, 1).response)).rejects.toThrow();
  });

  const malformed = [
    ["empty", ""],
    ["whitespace", " \n\t"],
    ["root array", "[]"],
    ["root null", "null"],
    ["missing version", '{"jobs":[]}'],
    ["wrong version", '{"apiVersion":"2","jobs":[]}'],
    ["numeric version", '{"apiVersion":1,"jobs":[]}'],
    ["missing jobs", '{"apiVersion":"1"}'],
    ["object jobs", '{"apiVersion":"1","jobs":{}}'],
    ["null jobs", '{"apiVersion":"1","jobs":null}'],
    ["null record", '{"apiVersion":"1","jobs":[null]}'],
    ["array record", '{"apiVersion":"1","jobs":[[]]}'],
    ["numeric record", '{"apiVersion":"1","jobs":[1]}'],
    ["missing colon", '{"apiVersion" "1","jobs":[]}'],
    ["root trailing comma", '{"apiVersion":"1","jobs":[],}'],
    ["record trailing comma", '{"apiVersion":"1","jobs":[{},]}'],
    ["record missing comma", '{"apiVersion":"1","jobs":[{}{}]}'],
    ["leading comma", '{,"apiVersion":"1","jobs":[]}'],
    ["array leading comma", '{"apiVersion":"1","jobs":[,{}]}'],
    ["double comma", '{"apiVersion":"1",,"jobs":[]}'],
    ["invalid escape", '{"apiVersion":"1","jobs":[],"meta":"\\q"}'],
    ["incomplete unicode escape", '{"apiVersion":"1","jobs":[],"meta":"\\u00"}'],
    ["unescaped newline", '{"apiVersion":"1","jobs":[],"meta":"line\nline"}'],
    ["invalid number", '{"apiVersion":"1","jobs":[],"meta":01}'],
    ["invalid literal", '{"apiVersion":"1","jobs":[],"meta":TRUE}'],
    ["comment", '{"apiVersion":"1",/* unsupported */"jobs":[]}'],
    ["trailing second document", `${document()}{}`],
    ["trailing literal", `${document()}null`],
    ["trailing garbage", `${document()}synthetic-marker`],
    ["leading BOM", `\uFEFF${document()}`],
    ["trailing BOM", `${document()}\uFEFF`],
    ["non-JSON whitespace", `${document()}\u00A0`],
    ["target then truncated root", document().slice(0, -1)],
    ["target then truncated array", document().slice(0, -2)],
    ["target then unfinished string", `${document().slice(0, -2)},{"text":"unfinished`],
    ["target then malformed later record", `${document().slice(0, -2)},{"text":}]}`],
  ] as const;

  it.each(malformed)("requires complete valid envelope and EOF: %s", async (_label, raw) => {
    for (const chunkSize of [1, 7, 65_536]) {
      const fixture = streamingResponse(raw, chunkSize);
      await expect(read(fixture.response)).rejects.toThrow();
      expect(fixture.response.body?.locked).toBe(false);
    }
  });

  it.each([
    new Uint8Array([0xc0, 0xaf]),
    new Uint8Array([0xed, 0xa0, 0x80]),
    new Uint8Array([0xf0, 0x9f, 0x92]),
    new Uint8Array([0xff]),
  ])("rejects malformed or truncated UTF-8 even after a complete target", async (invalid) => {
    const prefix = encoder.encode(`${document().slice(0, -1)},"meta":"`);
    const suffix = encoder.encode('"}');
    const bytes = new Uint8Array(prefix.byteLength + invalid.byteLength + suffix.byteLength);
    bytes.set(prefix);
    bytes.set(invalid, prefix.byteLength);
    bytes.set(suffix, prefix.byteLength + invalid.byteLength);
    await expect(read(streamingResponse(bytes, 1).response)).rejects.toThrow();
  });

  it("flushes and rejects an incomplete final UTF-8 sequence at actual EOF", async () => {
    const prefix = encoder.encode(document());
    const bytes = new Uint8Array(prefix.byteLength + 2);
    bytes.set(prefix);
    bytes.set([0xf0, 0x9f], prefix.byteLength);
    await expect(read(streamingResponse(bytes, 1).response)).rejects.toThrow();
  });

  it("requires the synchronous selection callback to return a boolean", async () => {
    await expect(
      read(streamingResponse(document()).response, {
        onJob: (() => "truthy is not authorization") as unknown as (value: unknown) => boolean,
      }),
    ).rejects.toThrow();
  });

  it("does not reflect provider text or callback errors", async () => {
    const marker = "DO_NOT_ECHO_SYNTHETIC_PROVIDER_MARKER";
    for (const raw of [document() + marker, document([job(0, { descriptionPlain: marker })])]) {
      const result = read(streamingResponse(raw).response, {
        onJob() {
          throw Error(marker);
        },
      });
      await expect(result).rejects.toThrow();
      await result.catch((error: unknown) => expect(String(error)).not.toContain(marker));
    }
  });
});

describe("Ashby exact-board cancellation and transport isolation", () => {
  it("refuses HTTP 206 even when its partial body happens to be a complete valid envelope", async () => {
    const response = new Response(document(), {
      status: 206,
      headers: { "content-type": "application/json" },
    });
    await expect(read(response)).resolves.toEqual({ kind: "retry", reason: "source_unavailable" });
  });

  it("refuses a Content-Range response even when it advertises HTTP 200 and complete JSON", async () => {
    const fixture = streamingResponse(document(), 1, { "content-range": "bytes 0-200/1000" });
    await expect(read(fixture.response)).rejects.toThrow();
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
  });

  it("refuses a response already redirected by a nonconforming injected transport", async () => {
    const fixture = streamingResponse(document());
    Object.defineProperty(fixture.response, "redirected", { value: true });
    await expect(read(fixture.response)).rejects.toThrow();
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
  });

  it("refuses a successful status without a response body", async () => {
    const response = new Response(null, { headers: { "content-type": "application/json" } });
    await expect(read(response)).rejects.toThrow();
  });

  it.each([
    [429, "rate_limited"],
    [503, "source_unavailable"],
    [404, "source_unavailable"],
    [302, "source_unavailable"],
  ] as const)(
    "returns one value-free retry for HTTP %i without retrying or reading the body",
    async (status, reason) => {
      const cancel = vi.fn();
      const pull = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }),
        { status },
      );
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
      await expect(
        fetchAshbyExactBoard({
          fetch,
          jobBoardName: board,
          externalJobId: targetId,
          signal: new AbortController().signal,
          onJob: selected,
        }),
      ).resolves.toEqual({ kind: "retry", reason });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(response.body?.locked).toBe(false);
    },
  );

  it("does not fetch for a caller signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort(Error("synthetic private abort reason"));
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      fetchAshbyExactBoard({
        fetch,
        jobBoardName: board,
        externalJobId: targetId,
        signal: controller.signal,
        onJob: selected,
      }),
    ).resolves.toEqual({ kind: "retry", reason: "source_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["deadline", "caller abort"])(
    "bounds a fetch that ignores cancellation: %s",
    async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
      const pending = fetchAshbyExactBoard({
        fetch,
        jobBoardName: board,
        externalJobId: targetId,
        signal: controller.signal,
        onJob: selected,
      });
      const assertion = expect(pending).resolves.toEqual({
        kind: "retry",
        reason: mode === "deadline" ? "timeout" : "source_unavailable",
      });
      if (mode === "deadline") await vi.advanceTimersByTimeAsync(5_001);
      else controller.abort(Error("synthetic private abort reason"));
      await assertion;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cancels a transport response that arrives only after the request deadline", async () => {
    vi.useFakeTimers();
    let complete: ((value: Response) => void) | undefined;
    const fixture = streamingResponse(document(), 1);
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const pending = fetchAshbyExactBoard({
      fetch,
      jobBoardName: board,
      externalJobId: targetId,
      signal: new AbortController().signal,
      onJob: selected,
    });
    const assertion = expect(pending).resolves.toEqual({ kind: "retry", reason: "timeout" });
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    expect(complete).toBeTypeOf("function");
    complete?.(fixture.response);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.readBytes()).toBe(0);
    expect(fixture.response.body?.locked).toBe(false);
  });

  it("handles a fetch that synchronously aborts before returning a rejected promise", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      controller.abort();
      return Promise.reject(Error("DO_NOT_ECHO_SYNTHETIC_FETCH_ABORT_MARKER"));
    });
    await expect(
      fetchAshbyExactBoard({
        fetch,
        jobBoardName: board,
        externalJobId: targetId,
        signal: controller.signal,
        onJob: selected,
      }),
    ).resolves.toEqual({ kind: "retry", reason: "source_unavailable" });
    // Let unhandled-rejection detection run; the cancelled request's promise still needs a handler.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("handles a reader that synchronously aborts before returning a rejected promise", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const response = new Response(document(), { headers: { "content-type": "application/json" } });
    Object.defineProperty(response.body, "getReader", {
      value: () => ({
        read: () => {
          controller.abort();
          return Promise.reject(Error("DO_NOT_ECHO_SYNTHETIC_READ_ABORT_MARKER"));
        },
        cancel,
        releaseLock,
      }),
    });
    await expect(read(response, { signal: controller.signal })).resolves.toEqual({
      kind: "retry",
      reason: "source_unavailable",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("does not await a never-settling cancellation after a malformed body", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"apiVersion":"1","jobs":[],"meta":invalid}'));
        },
        pull: () => new Promise<void>(() => {}),
        cancel,
      }),
      { headers: { "content-type": "application/json" } },
    );
    await expect(read(response)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it.each(["deadline", "caller abort"])(
    "bounds a stalled body after an early target even when cancel never settles: %s",
    async (mode) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(encoder.encode(document().slice(0, -1)));
          },
          pull: () => new Promise<void>(() => {}),
          cancel,
        }),
        { headers: { "content-type": "application/json" } },
      );
      const pending = read(response, { signal: controller.signal });
      const assertion = expect(pending).resolves.toEqual({
        kind: "retry",
        reason: mode === "deadline" ? "timeout" : "source_unavailable",
      });
      await vi.advanceTimersByTimeAsync(1);
      if (mode === "deadline") await vi.advanceTimersByTimeAsync(5_000);
      else controller.abort();
      await assertion;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(response.body?.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("uses one total five-second deadline across headers and body, not a renewed body allowance", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel }),
      { headers: { "content-type": "application/json" } },
    );
    const fetch = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(response), 4_000)),
    );
    const pending = fetchAshbyExactBoard({
      fetch,
      jobBoardName: board,
      externalJobId: targetId,
      signal: new AbortController().signal,
      onJob: selected,
    });
    const assertion = expect(pending).resolves.toEqual({ kind: "retry", reason: "timeout" });
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns source unavailable without exposing an arbitrary rejected fetch reason", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw Error("DO_NOT_ECHO_SYNTHETIC_TRANSPORT_MARKER");
    });
    await expect(
      fetchAshbyExactBoard({
        fetch,
        jobBoardName: board,
        externalJobId: targetId,
        signal: new AbortController().signal,
        onJob: selected,
      }),
    ).resolves.toEqual({ kind: "retry", reason: "source_unavailable" });
  });

  it("fails closed on a read error after the target instead of returning partial evidence", async () => {
    let pulls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(encoder.encode(document().slice(0, -1)));
          else controller.error(Error("DO_NOT_ECHO_SYNTHETIC_BODY_MARKER"));
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const pending = read(response);
    const result = await pending.catch((error: unknown) => ({ error: String(error) }));
    expect(result).not.toMatchObject({ kind: "success" });
    expect(JSON.stringify(result)).not.toContain("DO_NOT_ECHO_SYNTHETIC_BODY_MARKER");
    expect(response.body?.locked).toBe(false);
  });
});
