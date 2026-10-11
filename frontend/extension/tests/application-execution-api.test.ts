import { afterEach, expect, it, vi } from "vitest";
import { applicationExecutionApi } from "../lib/application-execution-api";
import { APP, handoffFixture } from "./application-handoff-fixture";

const ATTEMPT = "00000000-0000-7000-8000-000000000009";
const key = "synthetic-command-0001";
const request = {
  expectedRevision: 4,
  adapterId: "greenhouse-application-v1",
  adapterVersion: "0.1.0",
  observedFormHash: "a".repeat(64),
};
const attempt = () => ({
  id: ATTEMPT,
  sequence: 1,
  status: "dispatched",
  adapterId: request.adapterId,
  adapterVersion: request.adapterVersion,
  startedAt: new Date().toISOString(),
  dispatchedAt: new Date().toISOString(),
});
const response = (body: unknown) =>
  Response.json(body, { headers: { "cache-control": "no-store" } });
function setup(deadline = Date.now() + 30_000) {
  const controller = new AbortController();
  const api = applicationExecutionApi({
    apiOrigin: "https://api.example",
    accessToken: "synthetic-private-credential",
    applicationId: APP,
    deadline,
    signal: controller.signal,
  });
  return { api, controller };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("uses owning routes and keeps dispatch bodyless without an invented retry key", async () => {
  const application = handoffFixture().application;
  const send = vi
    .fn()
    .mockResolvedValueOnce(response({ outcome: "started", attemptId: ATTEMPT, application }))
    .mockResolvedValueOnce(response(attempt()))
    .mockResolvedValueOnce(response(application));
  vi.stubGlobal("fetch", send);
  const { api } = setup();
  await api.start(request, key);
  await api.dispatch(ATTEMPT);
  await api.result(ATTEMPT, { kind: "unrecognized_response" }, key);
  expect(send.mock.calls.map(([url]) => String(url))).toEqual([
    `https://api.example/v1/applications/${APP}/submissions`,
    `https://api.example/v1/applications/${APP}/attempts/${ATTEMPT}/dispatch`,
    `https://api.example/v1/applications/${APP}/attempts/${ATTEMPT}/result`,
  ]);
  for (const [, options] of send.mock.calls)
    expect(options).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  expect(send.mock.calls[0]?.[1].headers["Idempotency-Key"]).toBe(key);
  expect(send.mock.calls[1]?.[1]).not.toHaveProperty("body");
  expect(send.mock.calls[1]?.[1].headers).not.toHaveProperty("Idempotency-Key");
  expect(send.mock.calls[2]?.[1].headers["Idempotency-Key"]).toBe(key);
});

it.each(["lost-ack", "status", "cache", "media", "json", "utf8", "oversize", "contract"])(
  "refuses %s without retrying dispatch",
  async (mode) => {
    const send = vi.fn(async () => {
      if (mode === "lost-ack") throw Error("Synthetic lost acknowledgement");
      const headers = {
        "cache-control": mode === "cache" ? "public" : "no-store",
        "content-type": mode === "media" ? "text/html" : "application/json",
      };
      if (mode === "utf8") return new Response(new Uint8Array([0xc3, 0x28]), { headers });
      return new Response(
        mode === "oversize"
          ? "x".repeat(512 * 1024 + 1)
          : mode === "json"
            ? "{"
            : JSON.stringify(
                mode === "contract" ? { ...attempt(), token: "forbidden" } : attempt(),
              ),
        { status: mode === "status" ? 201 : 200, headers },
      );
    });
    vi.stubGlobal("fetch", send);
    await expect(setup().api.dispatch(ATTEMPT)).rejects.toThrow("ApplicationExecutionUnavailable");
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it.each(["fetch", "stream"])(
  "bounds a stalled %s to the original deadline and cancels without retry",
  async (mode) => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const send = vi.fn(() =>
      mode === "fetch"
        ? new Promise<Response>(() => {})
        : Promise.resolve(
            new Response(new ReadableStream({ cancel: cancelled }), {
              headers: { "cache-control": "no-store", "content-type": "application/json" },
            }),
          ),
    );
    vi.stubGlobal("fetch", send);
    const promise = setup(Date.now() + 75).api.dispatch(ATTEMPT);
    const rejected = expect(promise).rejects.toThrow("ApplicationExecutionUnavailable");
    await vi.advanceTimersByTimeAsync(75);
    await rejected;
    expect(send).toHaveBeenCalledTimes(1);
    if (mode === "stream") expect(cancelled).toHaveBeenCalledTimes(1);
  },
);

it("aborts a hung transport immediately when the candidate clears material", async () => {
  const send = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", send);
  const { api, controller } = setup();
  const pending = api.dispatch(ATTEMPT);
  const rejected = expect(pending).rejects.toThrow("ApplicationExecutionUnavailable");
  controller.abort();
  await rejected;
  expect(send).toHaveBeenCalledTimes(1);
});

it("rejects expired admission, malformed identifiers, requests and keys before transport", async () => {
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  await expect(setup(Date.now() - 1).api.dispatch(ATTEMPT)).rejects.toThrow();
  await expect(setup().api.dispatch("../foreign")).rejects.toThrow();
  await expect(setup().api.start({ ...request, expectedRevision: -1 }, key)).rejects.toThrow();
  await expect(setup().api.start(request, "bad\nkey")).rejects.toThrow();
  await expect(
    setup().api.result(ATTEMPT, { kind: "unrecognized_response" }, "short"),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
