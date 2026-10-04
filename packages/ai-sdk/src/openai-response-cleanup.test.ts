import { describe, expect, it, vi } from "vitest";
import {
  OpenAiLunaResponseCleanup,
  validateOpenAiBackgroundResponseReference,
} from "./openai-response-cleanup.js";

const reference = () => ({
  schemaVersion: 1 as const,
  responseId: "resp_synthetic123",
  createdAt: 1_790_000_000,
});
const signal = () => new AbortController().signal;
const response = (status = "cancelled", extra: Record<string, unknown> = {}) => ({
  id: reference().responseId,
  object: "response",
  created_at: reference().createdAt,
  model: "gpt-6-luna",
  background: true,
  store: false,
  tools: [],
  previous_response_id: null,
  status,
  output: [{ text: "Synthetic confidential output, never return this." }],
  ...extra,
});
const deleted = () => ({ id: reference().responseId, object: "response.deleted", deleted: true });
const json = (value: unknown) => new Response(JSON.stringify(value));
function setup(...replies: unknown[]) {
  const transport = vi.fn<typeof fetch>();
  for (const reply of replies) transport.mockResolvedValueOnce(json(reply));
  const apiKey = vi.fn(() => "synthetic-key");
  const cleanup = new OpenAiLunaResponseCleanup({ enabled: () => true, apiKey, fetch: transport });
  return { cleanup, transport, apiKey };
}

describe("OpenAI background response stop/disposal (offline)", () => {
  it("stays dark before credentials and transport", async () => {
    const { apiKey, transport } = setup();
    const cleanup = new OpenAiLunaResponseCleanup({ apiKey, fetch: transport });
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(apiKey).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled", "failed", "incomplete"])(
    "deletes positively observed terminal %s without another cancel or generation",
    async (state) => {
      const { cleanup, transport } = setup(response(state), deleted());
      expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({
        kind: "response_deleted",
        reference: reference(),
        terminalStatus: state,
      });
      expect(transport.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
        ["https://api.openai.com/v1/responses/resp_synthetic123", "GET"],
        ["https://api.openai.com/v1/responses/resp_synthetic123", "DELETE"],
      ]);
      for (const [, options] of transport.mock.calls) {
        expect(options).toMatchObject({
          redirect: "error",
          headers: { Authorization: "Bearer synthetic-key" },
        });
        expect(options?.body).toBeUndefined();
      }
    },
  );

  it.each(["queued", "in_progress"])("cancels %s exactly once before disposal", async (state) => {
    const { cleanup, transport } = setup(response(state), response(), deleted());
    expect(await cleanup.stopAndDelete(reference(), signal())).toMatchObject({
      kind: "response_deleted",
    });
    expect(transport.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ["https://api.openai.com/v1/responses/resp_synthetic123", "GET"],
      ["https://api.openai.com/v1/responses/resp_synthetic123/cancel", "POST"],
      ["https://api.openai.com/v1/responses/resp_synthetic123", "DELETE"],
    ]);
  });

  it("handles completion racing cancellation without reading or returning generated text", async () => {
    const { cleanup } = setup(response("in_progress"), response("completed"), deleted());
    const result = await cleanup.stopAndDelete(reference(), signal());
    expect(result).toMatchObject({ terminalStatus: "completed" });
    expect(JSON.stringify(result)).not.toContain("confidential");
  });

  it.each([
    null,
    {},
    { ...reference(), schemaVersion: 2 },
    { ...reference(), responseId: "resp_../other" },
    { ...reference(), responseId: "resp_a?token=secret" },
    { ...reference(), createdAt: NaN },
    { ...reference(), createdAt: 0 },
    { ...reference(), createdAt: 1.5 },
    { ...reference(), owner: "extra" },
  ])("refuses invalid reference %j before I/O", async (input) => {
    const { cleanup, transport } = setup();
    expect(validateOpenAiBackgroundResponseReference(input)).toBe(false);
    expect(await cleanup.stopAndDelete(input, signal())).toEqual({ kind: "unresolved" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects accessor and prototype references without calling their getters", async () => {
    const getter = vi.fn(() => reference().responseId);
    const accessor = { ...reference() };
    Object.defineProperty(accessor, "responseId", { get: getter, enumerable: true });
    const { cleanup, transport } = setup();
    expect(await cleanup.stopAndDelete(accessor, signal())).toEqual({ kind: "unresolved" });
    expect(await cleanup.stopAndDelete(Object.create(reference()), signal())).toEqual({
      kind: "unresolved",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { id: "resp_other" },
    { created_at: 1 },
    { model: "other" },
    { background: false },
    { store: true },
    { object: "other" },
    { previous_response_id: "resp_other" },
    { tools: [{}] },
    { tools: null },
    { status: "unknown" },
  ])("refuses mismatched GET metadata %j without cancellation or deletion", async (extra) => {
    const { cleanup, transport } = setup(response("in_progress", extra));
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    response("in_progress"),
    response("queued"),
    response("cancelled", { id: "resp_other" }),
    null,
  ])("refuses nonterminal/mismatched cancellation %j without deletion", async (cancel) => {
    const { cleanup, transport } = setup(response("in_progress"), cancel);
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    { ...deleted(), id: "resp_other" },
    { ...deleted(), deleted: false },
    { ...deleted(), object: "other" },
    { ...deleted(), extra: "private" },
  ])("refuses malformed deletion acknowledgement %j", async (ack) => {
    const { cleanup, transport } = setup(response(), ack);
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(["read", "cancel", "delete"])(
    "does not retry a lost %s acknowledgement",
    async (phase) => {
      const { cleanup, transport } = setup();
      if (phase !== "read")
        transport.mockResolvedValueOnce(
          json(response(phase === "cancel" ? "in_progress" : "completed")),
        );
      transport.mockRejectedValueOnce(new Error("private-body synthetic-key"));
      expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
      expect(transport).toHaveBeenCalledTimes(phase === "read" ? 1 : 2);
    },
  );

  it.each([404, 429, 500, 204, 201])(
    "does not infer disposal or stopping from HTTP %s",
    async (status) => {
      const { cleanup, transport } = setup();
      transport.mockResolvedValueOnce(new Response(status === 204 ? null : "private", { status }));
      expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["not JSON", "x".repeat(128_001)])(
    "refuses malformed or oversized bodies",
    async (body) => {
      const { cleanup, transport } = setup();
      transport.mockResolvedValueOnce(new Response(body));
      expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it("detaches original reference across async I/O", async () => {
    const { cleanup, transport } = setup();
    const input = reference();
    transport.mockImplementationOnce(async () => {
      input.responseId = "resp_other";
      input.createdAt = 1;
      return json(response());
    });
    transport.mockResolvedValueOnce(json(deleted()));
    expect(await cleanup.stopAndDelete(input, signal())).toMatchObject({ reference: reference() });
    expect(transport.mock.calls[1]?.[0]).toBe(
      "https://api.openai.com/v1/responses/resp_synthetic123",
    );
  });

  it("fails closed on kill switch changes before the next effect", async () => {
    let enabled = true;
    const { apiKey, transport } = setup();
    transport.mockImplementationOnce(async () => {
      enabled = false;
      return json(response("in_progress"));
    });
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => enabled,
      apiKey,
      fetch: transport,
    });
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not treat local abort or a later transport response as a receipt", async () => {
    const controller = new AbortController();
    let finish: (value: Response) => void = () => undefined;
    const { cleanup, transport } = setup();
    transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = cleanup.stopAndDelete(reference(), controller.signal);
    controller.abort();
    expect(await pending).toEqual({ kind: "unresolved" });
    const discarded = vi.fn();
    finish(new Response(new ReadableStream({ cancel: discarded })));
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(discarded).toHaveBeenCalledTimes(1);
  });

  it("refuses aborted input and missing credentials before network", async () => {
    const { cleanup, transport } = setup();
    expect(await cleanup.stopAndDelete(reference(), AbortSignal.abort())).toEqual({
      kind: "unresolved",
    });
    const withoutKey = new OpenAiLunaResponseCleanup({
      enabled: () => true,
      apiKey: () => undefined,
      fetch: transport,
    });
    expect(await withoutKey.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 30_001, 1.5])("rejects invalid timeout %s", (timeoutMs) => {
    expect(() => new OpenAiLunaResponseCleanup({ apiKey: () => undefined, timeoutMs })).toThrow(
      "ProviderResponseCleanupUnresolved",
    );
  });

  it("bounds stalled transport even when the caller signal never aborts", async () => {
    const { apiKey, transport } = setup();
    transport.mockImplementationOnce(() => new Promise(() => undefined));
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => true,
      apiKey,
      fetch: transport,
      timeoutMs: 10,
    });
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("bounds a stalled response stream without converting elapsed time into disposal", async () => {
    const { apiKey, transport } = setup();
    const cancelled = vi.fn();
    transport.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled })));
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => true,
      apiKey,
      fetch: transport,
      timeoutMs: 10,
    });
    expect(await cleanup.stopAndDelete(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
describe("completion-only provider response disposal (offline)", () => {
  it("deletes exact original completion without cancellation or exposing output", async () => {
    const { cleanup, transport } = setup(response("completed"), deleted());
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({
      kind: "response_deleted",
      reference: reference(),
      terminalStatus: "completed",
    });
    expect(transport.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ["https://api.openai.com/v1/responses/resp_synthetic123", "GET"],
      ["https://api.openai.com/v1/responses/resp_synthetic123", "DELETE"],
    ]);
    for (const [, options] of transport.mock.calls) {
      expect(options).toMatchObject({
        redirect: "error",
        headers: { Authorization: "Bearer synthetic-key" },
      });
      expect(options?.body).toBeUndefined();
    }
  });

  it.each(["queued", "in_progress", "cancelled", "failed", "incomplete", "unknown"])(
    "leaves %s unresolved with no cancellation or deletion",
    async (state) => {
      const { cleanup, transport } = setup(response(state), deleted());
      expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
      expect(transport).toHaveBeenCalledExactlyOnceWith(
        "https://api.openai.com/v1/responses/resp_synthetic123",
        expect.objectContaining({ method: "GET" }),
      );
    },
  );

  it("defaults off before credentials or network", async () => {
    const { apiKey, transport } = setup();
    const cleanup = new OpenAiLunaResponseCleanup({ apiKey, fetch: transport });
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(apiKey).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { id: "resp_other" },
    { created_at: 1 },
    { model: "other" },
    { background: false },
    { store: true },
    { previous_response_id: "resp_other" },
    { tools: [{}] },
  ])("refuses changed original completion %j before deletion", async (extra) => {
    const { cleanup, transport } = setup(response("completed", extra), deleted());
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { ...reference(), createdAt: 0 },
    { ...reference(), responseId: "resp_../other" },
    { ...reference(), owner: "extra" },
  ])("refuses invalid input %j before credentials", async (raw) => {
    const { cleanup, apiKey, transport } = setup();
    expect(await cleanup.deleteCompleted(raw, signal())).toEqual({ kind: "unresolved" });
    expect(apiKey).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects accessors without executing them", async () => {
    const getter = vi.fn(() => reference().responseId);
    const raw = reference();
    Object.defineProperty(raw, "responseId", { get: getter, enumerable: true });
    const { cleanup, transport } = setup();
    expect(await cleanup.deleteCompleted(raw, signal())).toEqual({ kind: "unresolved" });
    expect(getter).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it("detaches original metadata before asynchronous completion read", async () => {
    const { cleanup, transport } = setup();
    const raw = reference();
    transport.mockImplementationOnce(async () => {
      raw.responseId = "resp_changed";
      raw.createdAt = 1;
      return json(response("completed"));
    });
    transport.mockResolvedValueOnce(json(deleted()));
    expect(await cleanup.deleteCompleted(raw, signal())).toMatchObject({ reference: reference() });
    expect(transport.mock.calls[1]?.[0]).toBe(
      "https://api.openai.com/v1/responses/resp_synthetic123",
    );
  });

  it("refuses withdrawal during completion read before deletion", async () => {
    let enabled = true;
    const { apiKey, transport } = setup();
    transport.mockImplementationOnce(async () => {
      enabled = false;
      return json(response("completed"));
    });
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => enabled,
      apiKey,
      fetch: transport,
    });
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "delete"])("never retries lost %s acknowledgement", async (phase) => {
    const { cleanup, transport } = setup();
    if (phase === "delete") transport.mockResolvedValueOnce(json(response("completed")));
    transport.mockRejectedValueOnce(Error("synthetic confidential diagnostics"));
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(phase === "read" ? 1 : 2);
  });

  it.each([
    null,
    { ...deleted(), deleted: false },
    { ...deleted(), id: "resp_other" },
    { ...deleted(), content: "synthetic" },
  ])("refuses nonpositive deletion acknowledgement %j", async (ack) => {
    const { cleanup, transport } = setup(response("completed"), ack);
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([404, 429, 500])("does not infer disposal from DELETE HTTP %s", async (status) => {
    const { cleanup, transport } = setup(response("completed"));
    transport.mockResolvedValueOnce(new Response("synthetic private response", { status }));
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("refuses pre-aborted calls before credentials", async () => {
    const { cleanup, transport, apiKey } = setup();
    expect(await cleanup.deleteCompleted(reference(), AbortSignal.abort())).toEqual({
      kind: "unresolved",
    });
    expect(transport).not.toHaveBeenCalled();
    expect(apiKey).not.toHaveBeenCalled();
  });

  it("discards a late deletion ACK after local abort without certifying disposal", async () => {
    const controller = new AbortController();
    const { cleanup, transport } = setup(response("completed"));
    let finish: (value: Response) => void = () => undefined;
    let started: () => void = () => undefined;
    const deletionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const pending = cleanup.deleteCompleted(reference(), controller.signal);
    await deletionStarted;
    controller.abort();
    expect(await pending).toEqual({ kind: "unresolved" });
    const discarded = vi.fn();
    finish(new Response(new ReadableStream({ cancel: discarded })));
    await Promise.resolve();
    expect(discarded).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("bounds stalled deletion without retry or elapsed-time completion", async () => {
    const { apiKey, transport } = setup(response("completed"));
    transport.mockImplementationOnce(() => new Promise(() => undefined));
    const cleanup = new OpenAiLunaResponseCleanup({
      enabled: () => true,
      apiKey,
      fetch: transport,
      timeoutMs: 10,
    });
    expect(await cleanup.deleteCompleted(reference(), signal())).toEqual({ kind: "unresolved" });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
  });
});
