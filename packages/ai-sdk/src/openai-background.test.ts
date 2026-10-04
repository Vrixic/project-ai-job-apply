import { afterEach, describe, expect, it, vi } from "vitest";
import { type BackgroundResponseCapture, ModelGateway } from "./gateway.js";
import { OpenAiLunaProvider } from "./openai.js";

describe("original background terminal receipts (offline only)", () => {
  const run = (f: ReturnType<typeof fixture>) =>
    f.gateway.generateWithBackgroundTermination(request, disclosure, f.capture);

  it.each(["failed", "cancelled", "incomplete"] as const)(
    "%s original creation closes with metadata only after capture",
    async (terminalStatus) => {
      const f = fixture();
      f.transport.mockImplementation(async () =>
        response({
          status: terminalStatus,
          output: [{ secret: "SyntheticDiscardedContent" }],
          error: { message: "SyntheticDiscardedError" },
        }),
      );
      const ordinary = vi.spyOn(f.provider, "completeBackgroundForLifecycle");
      const receipt = await run(f);
      expect(receipt).toEqual({
        kind: "terminal_no_content",
        terminalStatus,
        reference: { schemaVersion: 1, responseId: "resp_original1", createdAt: 1791028800 },
        model: f.provider.identity,
        promptId: "cover_letter",
        promptVersion: "1.0.0",
      });
      expect(f.events).toEqual(["reserve", "capture"]);
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect(ordinary).not.toHaveBeenCalled();
      expect(JSON.stringify(receipt)).not.toContain("SyntheticDiscarded");
    },
  );

  it.each(["failed", "cancelled", "incomplete"] as const)(
    "old capture API still throws for %s",
    async (status) => {
      const f = fixture();
      f.transport.mockResolvedValue(response({ status }));
      await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
      expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["failed", "cancelled", "incomplete"] as const)(
    "polls the exact captured response before %s receipt",
    async (status) => {
      vi.useFakeTimers();
      const f = fixture();
      f.transport
        .mockResolvedValueOnce(response({ status: "queued" }))
        .mockResolvedValueOnce(response({ status }));
      const pending = run(f);
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(pending).resolves.toMatchObject({
        kind: "terminal_no_content",
        terminalStatus: status,
      });
      expect(f.transport.mock.calls.map(([url, input]) => [String(url), input?.method])).toEqual([
        ["https://api.openai.com/v1/responses", "POST"],
        ["https://api.openai.com/v1/responses/resp_original1", "GET"],
      ]);
      expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
    },
  );

  it("completed original response retains successful JSON result", async () => {
    const f = fixture();
    await expect(run(f)).resolves.toMatchObject({
      kind: "completed",
      result: { value: JSON.parse(text) },
    });
  });

  it("older provider ports remain compatible without error fallback", async () => {
    const f = fixture();
    Object.defineProperty(f.provider, "completeBackgroundForTermination", { value: undefined });
    const old = vi.spyOn(f.provider, "completeBackgroundForLifecycle");
    await expect(run(f)).resolves.toMatchObject({ kind: "completed" });
    expect(old).toHaveBeenCalledTimes(1);
  });

  it.each([
    { id: "resp_changed" },
    { created_at: 1791028801 },
    { model: "other" },
    { background: false },
    { store: true },
    { tools: [{}] },
    { previous_response_id: "resp_other" },
  ])("changed terminal poll metadata refuses: %j", async (patch) => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport
      .mockResolvedValueOnce(response({ status: "queued" }))
      .mockResolvedValueOnce(response({ status: "failed", ...patch }));
    const checked = expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    await vi.advanceTimersByTimeAsync(1_001);
    await checked;
  });

  it("lost original capture ACK cannot return even a terminal creation receipt", async () => {
    const f = fixture();
    f.transport.mockResolvedValue(response({ status: "cancelled" }));
    f.capture.recordCreation.mockRejectedValue(Error("SyntheticLostACK"));
    await expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it.each([404, 500])("HTTP %i never proves original termination", async (status) => {
    const f = fixture();
    f.transport.mockResolvedValue(
      new Response(JSON.stringify(responseValue({ status: "failed" })), { status }),
    );
    await expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
  });

  it("late fulfilled receipt after gateway deadline cannot become terminal proof", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10 });
    let finish: (value: never) => void = () => undefined;
    vi.spyOn(f.provider, "completeBackgroundForTermination").mockImplementation(
      async (_request, capture) => {
        await capture.reserve();
        await capture.recordCreation({
          schemaVersion: 1,
          responseId: "resp_original1",
          createdAt: 1791028800,
        });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const checked = expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await checked;
    finish({
      kind: "terminal_no_content",
      reference: { schemaVersion: 1, responseId: "resp_original1", createdAt: 1791028800 },
      terminalStatus: "failed",
    } as never);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([
    { terminalStatus: "completed" },
    { terminalStatus: "in_progress" },
    { terminalStatus: "queued" },
    { reference: { schemaVersion: 1, responseId: "resp_other", createdAt: 1791028800 } },
    { reference: { schemaVersion: 1, responseId: "resp_original1", createdAt: 1791028801 } },
    { text: "SyntheticForbiddenText" },
    { reference: null },
  ])("forged fulfilled terminal metadata is refused: %j", async (patch) => {
    const f = fixture();
    vi.spyOn(f.provider, "completeBackgroundForTermination").mockImplementation(
      async (_request, capture) => {
        await capture.reserve();
        await capture.recordCreation({
          schemaVersion: 1,
          responseId: "resp_original1",
          createdAt: 1791028800,
        });
        return {
          kind: "terminal_no_content",
          terminalStatus: "failed",
          reference: { schemaVersion: 1, responseId: "resp_original1", createdAt: 1791028800 },
          ...patch,
        } as never;
      },
    );
    await expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("fulfilled receipt without positive original capture is refused", async () => {
    const f = fixture();
    vi.spyOn(f.provider, "completeBackgroundForTermination").mockResolvedValue({
      kind: "terminal_no_content",
      terminalStatus: "failed",
      reference: { schemaVersion: 1, responseId: "resp_original1", createdAt: 1791028800 },
    });
    await expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.capture.reserve).not.toHaveBeenCalled();
  });

  it("a thrown receipt never becomes positive fulfillment", async () => {
    const f = fixture();
    vi.spyOn(f.provider, "completeBackgroundForTermination").mockRejectedValue({
      kind: "terminal_no_content",
      terminalStatus: "failed",
      reference: { schemaVersion: 1, responseId: "resp_original1", createdAt: 1791028800 },
    });
    await expect(run(f)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  });
});

const approvedAt = new Date("2026-10-03T12:00:00.000Z");
const text = JSON.stringify({ paragraphs: [{ text: "Synthetic services", factIds: ["f1"] }] });
const responseValue = (patch: Record<string, unknown> = {}) => ({
  object: "response",
  id: "resp_original1",
  created_at: 1791028800,
  model: "gpt-6-luna",
  background: true,
  store: false,
  previous_response_id: null,
  conversation: null,
  tools: [],
  status: "completed",
  output: [
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text }],
    },
  ],
  ...patch,
});
const response = (patch: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(responseValue(patch)));
const request = {
  promptId: "cover_letter",
  promptVersion: "1.0.0",
  purpose: "cover_letter" as const,
  categories: ["profile_facts", "job_posting"] as const,
  system: "Synthetic rules",
  user: "Synthetic facts",
};
const disclosure = { purpose: "cover_letter" as const, categories: request.categories, approvedAt };

function fixture(
  settings: {
    backgroundEnabled?: boolean;
    gatewayEnabled?: boolean;
    timeoutMs?: number;
    maxOutputChars?: number;
  } = {},
) {
  const events: string[] = [];
  const transport = vi.fn<typeof fetch>(async () => {
    events.push("POST");
    return response();
  });
  const apiKey = vi.fn(() => "synthetic-test-key");
  let enabled = true;
  const provider = new OpenAiLunaProvider({
    enabled: () => enabled,
    ...(settings.backgroundEnabled === false ? {} : { backgroundEnabled: () => enabled }),
    apiKey,
    fetch: transport,
  });
  const gateway = new ModelGateway(provider, {
    enabled: () => settings.gatewayEnabled !== false,
    clock: () => approvedAt,
    timeoutMs: settings.timeoutMs ?? 10_000,
    ...(settings.maxOutputChars === undefined ? {} : { maxOutputChars: settings.maxOutputChars }),
  });
  const capture = {
    reserve: vi.fn<BackgroundResponseCapture["reserve"]>(async () => {
      events.push("reserve");
      return "reserved";
    }),
    recordCreation: vi.fn<BackgroundResponseCapture["recordCreation"]>(async () => {
      events.push("capture");
    }),
  };
  const run = () => gateway.generateWithBackgroundCapture(request, disclosure, capture);
  return {
    gateway,
    provider,
    transport,
    apiKey,
    capture,
    run,
    events,
    disable: () => {
      enabled = false;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("original background capture (offline transport only)", () => {
  it("defaults off independently of foreground credentials", async () => {
    const f = fixture({ backgroundEnabled: false });
    await expect(f.run()).rejects.toMatchObject({ code: "MODEL_DISABLED" });
    expect(f.apiKey).not.toHaveBeenCalled();
    expect(f.capture.reserve).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("preserves gateway local refusal without reserving or dispatching", async () => {
    const f = fixture({ gatewayEnabled: false });
    await expect(f.run()).resolves.toMatchObject({
      kind: "not_dispatched",
      code: "MODEL_DISABLED",
    });
    expect(f.capture.reserve).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("requires disclosure before reservation", async () => {
    const f = fixture();
    await expect(
      f.gateway.generateWithBackgroundCapture(request, undefined, f.capture),
    ).resolves.toMatchObject({ kind: "not_dispatched", code: "DISCLOSURE_MISSING" });
    expect(f.capture.reserve).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("never falls back to foreground when the background port is absent", async () => {
    const complete = vi.fn(async () => ({ text }));
    const gateway = new ModelGateway(
      { identity: { provider: "openai", model: "gpt-6-luna", version: "gpt-6-luna" }, complete },
      { enabled: () => true, clock: () => approvedAt },
    );
    await expect(
      gateway.generateWithBackgroundCapture(request, disclosure, fixture().capture),
    ).resolves.toMatchObject({ kind: "not_dispatched", code: "MODEL_DISABLED" });
    expect(complete).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    {},
    { reserve: () => undefined, recordCreation: () => undefined, extra: true },
  ])("rejects malformed capture before dispatch (%j)", async (invalid) => {
    const f = fixture();
    await expect(
      f.gateway.generateWithBackgroundCapture(
        request,
        disclosure,
        invalid as BackgroundResponseCapture,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("does not evaluate capture getters", async () => {
    const f = fixture();
    const getter = vi.fn(() => f.capture.reserve);
    const invalid = { ...f.capture };
    Object.defineProperty(invalid, "reserve", { get: getter, enumerable: true });
    await expect(
      f.gateway.generateWithBackgroundCapture(request, disclosure, invalid),
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(getter).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("hostile capture reflection exposes only the fixed failure", async () => {
    const f = fixture();
    const invalid = new Proxy(f.capture, {
      getPrototypeOf: () => {
        throw Error("SyntheticPrivateDiagnostic");
      },
    });
    await expect(
      f.gateway.generateWithBackgroundCapture(request, disclosure, invalid),
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("snapshots original capture functions before caller mutation", async () => {
    const f = fixture();
    const original = f.capture.recordCreation;
    f.capture.reserve.mockImplementation(async () => {
      f.capture.recordCreation = vi.fn(async () => {
        throw Error("SyntheticReplacement");
      });
      return "reserved";
    });
    await expect(f.run()).resolves.toMatchObject({ kind: "completed" });
    expect(original).toHaveBeenCalledTimes(1);
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
  });
  it("withdrawn gateway activation after reservation cannot create", async () => {
    const f = fixture();
    let enabled = true;
    const gateway = new ModelGateway(f.provider, {
      enabled: () => enabled,
      clock: () => approvedAt,
    });
    f.capture.reserve.mockImplementation(async () => {
      enabled = false;
      return "reserved";
    });
    await expect(
      gateway.generateWithBackgroundCapture(request, disclosure, f.capture),
    ).rejects.toMatchObject({ code: "MODEL_DISABLED" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("disclosure expiry after reservation cannot create or claim local non-dispatch", async () => {
    const f = fixture();
    let now = approvedAt;
    const gateway = new ModelGateway(f.provider, { enabled: () => true, clock: () => now });
    f.capture.reserve.mockImplementation(async () => {
      now = new Date(approvedAt.getTime() + 900001);
      return "reserved";
    });
    await expect(
      gateway.generateWithBackgroundCapture(request, disclosure, f.capture),
    ).rejects.toMatchObject({ code: "DISCLOSURE_STALE" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("provider fulfillment without capture never produces completion", async () => {
    const f = fixture();
    const background = vi
      .spyOn(f.provider, "completeBackgroundForLifecycle")
      .mockResolvedValue({ text });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(background).toHaveBeenCalledTimes(1);
    expect(f.capture.reserve).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("a provider cannot capture before reservation", async () => {
    const f = fixture();
    vi.spyOn(f.provider, "completeBackgroundForLifecycle").mockImplementation(
      async (_request, capture) => {
        await capture.recordCreation({
          schemaVersion: 1,
          responseId: "resp_original1",
          createdAt: 1791028800,
        });
        return { text };
      },
    );
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
  });
  it("a provider cannot retry the original reservation", async () => {
    const f = fixture();
    vi.spyOn(f.provider, "completeBackgroundForLifecycle").mockImplementation(
      async (_request, capture) => {
        await capture.reserve();
        await capture.reserve();
        return { text };
      },
    );
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.capture.reserve).toHaveBeenCalledTimes(1);
  });
  it("the background port is snapshotted once without foreground fallback", async () => {
    const f = fixture();
    const original = f.provider.completeBackgroundForLifecycle.bind(f.provider);
    const foreground = vi.spyOn(f.provider, "completeForLifecycle");
    let reads = 0;
    Object.defineProperty(f.provider, "completeBackgroundForLifecycle", {
      get: () => {
        reads++;
        return reads === 1 ? original : undefined;
      },
    });
    await expect(f.run()).resolves.toMatchObject({ kind: "completed" });
    expect(reads).toBe(1);
    expect(foreground).not.toHaveBeenCalled();
  });
  it("reserves then captures only original id/time before accepting even immediate completion", async () => {
    const f = fixture();
    await expect(f.run()).resolves.toMatchObject({ kind: "completed" });
    expect(f.events).toEqual(["reserve", "POST", "capture"]);
    expect(f.capture.recordCreation).toHaveBeenCalledWith({
      schemaVersion: 1,
      responseId: "resp_original1",
      createdAt: 1791028800,
    });
    const [url, init] = f.transport.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      background: true,
      store: false,
      stream: false,
      reasoning: { effort: "low" },
      max_output_tokens: 4096,
    });
    expect(body.tools).toBeUndefined();
    expect(body.previous_response_id).toBeUndefined();
    expect(body.conversation).toBeUndefined();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each(["already_reserved", "invalid"])(
    "reservation result %s cannot redispatch",
    async (kind) => {
      const f = fixture();
      f.capture.reserve.mockResolvedValue(kind as "already_reserved");
      await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
      expect(f.transport).not.toHaveBeenCalled();
    },
  );
  it("lost reservation ACK never creates a response", async () => {
    const f = fixture();
    f.capture.reserve.mockRejectedValue(Error("SyntheticLostACK"));
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("lost creation-capture ACK never polls or accepts output", async () => {
    const f = fixture();
    f.transport.mockResolvedValue(response({ status: "queued", output: [] }));
    f.capture.recordCreation.mockRejectedValue(Error("SyntheticCommittedLostACK"));
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("polls only the original id after durable capture", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.mockImplementationOnce(async () => {
      f.events.push("POST");
      return response({ status: "queued", output: [] });
    });
    f.transport.mockImplementationOnce(async () => {
      f.events.push("GET");
      return response();
    });
    const pending = f.run();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ kind: "completed" });
    expect(f.events).toEqual(["reserve", "POST", "capture", "GET"]);
    expect(f.transport.mock.calls[1]?.[0]).toBe(
      "https://api.openai.com/v1/responses/resp_original1",
    );
    expect(f.transport.mock.calls[1]?.[1]?.method).toBe("GET");
  });
  it.each([
    { id: "bad" },
    { created_at: 0 },
    { model: "unexpected" },
    { background: false },
    { store: true },
    { tools: [{ type: "web_search" }] },
    { previous_response_id: "resp_other" },
    { conversation: { id: "c1" } },
    { status: "unknown" },
  ])("rejects unsafe original metadata %j before capture", async (patch) => {
    const f = fixture();
    f.transport.mockResolvedValue(response(patch));
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ id: "resp_other" }, { created_at: 1791028801 }, { store: true }])(
    "rejects changed polling metadata %j",
    async (patch) => {
      vi.useFakeTimers();
      const f = fixture();
      f.transport
        .mockResolvedValueOnce(response({ status: "queued", output: [] }))
        .mockResolvedValueOnce(response(patch));
      const assertion = expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
      expect(f.transport).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["failed", "cancelled", "incomplete"])(
    "retains captured identity without claiming completed on %s",
    async (status) => {
      const f = fixture();
      f.transport.mockResolvedValue(response({ status }));
      await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
      expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
      expect(f.transport).toHaveBeenCalledTimes(1);
    },
  );
  it("HTTP failure never retries or falls back", async () => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response("Synthetic failure", { status: 503 }));
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
  });
  it("bounded output rejection happens after immutable capture", async () => {
    const f = fixture({ maxOutputChars: 10 });
    await expect(f.run()).resolves.toMatchObject({
      kind: "completed_rejected",
      code: "OUTPUT_TOO_LARGE",
    });
    expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
  });
  it("non-JSON output rejection happens after immutable capture", async () => {
    const f = fixture();
    f.transport.mockResolvedValue(
      response({
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "not-json" }],
          },
        ],
      }),
    );
    await expect(f.run()).resolves.toMatchObject({
      kind: "completed_rejected",
      code: "OUTPUT_NOT_JSON",
    });
    expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
  });
  it("a late reservation ACK cannot create after gateway timeout", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10 });
    let acknowledge: (kind: "reserved") => void = () => undefined;
    f.capture.reserve.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const assertion = expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    acknowledge("reserved");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("stalled response streams abort without capturing or waiting for cancellation", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10 });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    f.transport.mockResolvedValue(
      new Response(new ReadableStream({ pull: () => new Promise(() => undefined), cancel })),
    );
    const assertion = expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("activation withdrawal after capture cannot accept output", async () => {
    const f = fixture();
    f.capture.recordCreation.mockImplementation(async () => {
      f.disable();
    });
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("late capture acknowledgement after timeout cannot accept completed output", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10 });
    let acknowledge: () => void = () => undefined;
    f.capture.recordCreation.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const assertion = expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    acknowledge();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("oversized response bytes fail before identity capture", async () => {
    const f = fixture();
    f.transport.mockResolvedValue(new Response("x".repeat(128001)));
    await expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("late HTTP acknowledgement is cancelled after timeout, never captured", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10 });
    let acknowledge: (value: Response) => void = () => undefined;
    f.transport.mockImplementation(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    const assertion = expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    const cancel = vi.fn();
    acknowledge(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.capture.recordCreation).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it("polling has a fixed request cap without another create or terminal claim", async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 60000 });
    f.transport.mockImplementation(async () => response({ status: "queued", output: [] }));
    const assertion = expect(f.run()).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    await vi.advanceTimersByTimeAsync(31000);
    await assertion;
    expect(f.transport).toHaveBeenCalledTimes(31);
    expect(f.transport.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    expect(f.capture.recordCreation).toHaveBeenCalledTimes(1);
  });
});
