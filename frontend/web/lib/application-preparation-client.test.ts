import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareApplicationPacket,
  readApplicationPreparation,
} from "./application-preparation-client";

const APP = "019d04cf-1f80-7000-8000-000000000001";
const OP = "019d04cf-1f80-7000-8000-000000000002";
const request = {
  expectedRevision: 1,
  coverLetter: {
    disclosure: { noticeVersion: "bedrock-cover-letter.v1" as const, acknowledged: true as const },
  },
};
const operation = {
  id: OP,
  applicationId: APP,
  state: "queued",
  createdAt: "2026-10-09T12:00:00Z",
  updatedAt: "2026-10-09T12:00:00Z",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.useRealTimers());

describe("browser packet preparation", () => {
  it("sends explicit disclosure with a stable action key and reads only its addressed operation", async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      response(operation, init?.method === "POST" ? 202 : 200),
    );
    expect(
      await prepareApplicationPacket(APP, request, "opaque-action", { fetch: send }),
    ).toMatchObject({ ok: true, kind: "preparation", preparation: operation });
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(request),
      headers: { "idempotency-key": "opaque-action" },
    });
    expect(await readApplicationPreparation(APP, OP, { fetch: send })).toMatchObject({
      ok: true,
      kind: "preparation",
    });
    expect(send.mock.calls[1]?.[0]).toBe(`/api/platform/applications/${APP}/preparations/${OP}`);
    expect(send.mock.calls[1]?.[1]?.body).toBeUndefined();
  });
  it("keeps synchronous preparation separate from asynchronous admission", async () => {
    const application = { id: APP, revision: 2, status: "review_required" };
    expect(
      await prepareApplicationPacket(APP, { expectedRevision: 1 }, "key", {
        fetch: async () => response(application, 201),
      }),
    ).toMatchObject({ ok: true, kind: "application" });
    expect(
      await prepareApplicationPacket(APP, { expectedRevision: 1 }, "key", {
        fetch: async () => response(operation, 202),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await prepareApplicationPacket(APP, request, "key", {
        fetch: async () => response(application, 201),
      }),
    ).toMatchObject({ ok: false });
  });
  it("refuses foreign or incomplete operation results", async () => {
    for (const changed of [
      { id: APP },
      { applicationId: OP },
      { state: "succeeded" },
      { state: "succeeded", result: { packetId: OP, revision: 0 } },
      { state: "failed" },
    ]) {
      expect(
        await readApplicationPreparation(APP, OP, {
          fetch: async () => response({ ...operation, ...changed }),
        }),
      ).toMatchObject({ ok: false });
    }
  });
  it("times out a held read and rejects a late response without renewing work", async () => {
    vi.useFakeTimers();
    let finish: ((value: Response) => void) | undefined;
    let signal: AbortSignal | undefined;
    const result = readApplicationPreparation(APP, OP, {
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(signal?.aborted).toBe(true);
    finish?.(response(operation));
    expect(await result).toMatchObject({ ok: false });
  });
  it("propagates navigation cancellation and projects only fixed error copy", async () => {
    const controller = new AbortController();
    let finish: ((value: Response) => void) | undefined;
    let signal: AbortSignal | undefined;
    const pending = readApplicationPreparation(APP, OP, {
      signal: controller.signal,
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      },
    });
    controller.abort();
    expect(signal?.aborted).toBe(true);
    finish?.(response(operation));
    expect(await pending).toMatchObject({ ok: false });
    const failed = await readApplicationPreparation(APP, OP, {
      fetch: async () =>
        response({ code: "private-upstream-value", detail: "private-upstream-value" }, 503),
    });
    expect(JSON.stringify(failed)).not.toContain("private-upstream-value");
  });
});
