import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { nativeMaterialLogout } from "./native-material-logout";

const environment = {
  APP_BASE_URL: "https://app.example.test",
  PLATFORM_API_BASE_URL: "https://api.example.test",
  AUTH0_APPLICATIONS_SCOPES: "enabled",
};
const request = (headers: Record<string, string> = {}) =>
  new NextRequest("https://app.example.test/auth/logout?returnTo=https://untrusted.example/", {
    headers: { "sec-fetch-site": "same-origin", cookie: "synthetic-session=cookie", ...headers },
  });
function fixture() {
  const client = {
    getSession: vi.fn().mockResolvedValue({
      user: { sub: "synthetic-owner" },
      tokenSet: { accessToken: "synthetic-secret-token" },
    }),
    getAccessToken: vi.fn().mockResolvedValue({ token: "synthetic-secret-token" }),
    middleware: vi
      .fn()
      .mockResolvedValue(NextResponse.redirect("https://identity.example.test/logout")),
  };
  const fetcher = vi.fn(async (input: URL | RequestInfo) =>
    Response.json(
      {
        requestId: new URL(String(input)).pathname.split("/").at(-1),
        requestedAt: "2026-10-08T12:00:00.000Z",
        state: "pending",
      },
      { status: 202 },
    ),
  );
  const invoke = (req = request(), env = environment, timeoutMilliseconds = 1000) =>
    nativeMaterialLogout(
      req,
      client as unknown as Parameters<typeof nativeMaterialLogout>[1],
      env,
      { fetch: fetcher as typeof fetch, timeoutMilliseconds },
    );
  return { client, fetcher, invoke };
}
function cleanupResult(client: ReturnType<typeof fixture>["client"]) {
  const delegated = client.middleware.mock.calls[0]?.[0] as NextRequest;
  expect(delegated.nextUrl.origin).toBe(environment.APP_BASE_URL);
  expect(delegated.nextUrl.pathname).toBe("/auth/logout");
  const destination = new URL(delegated.nextUrl.searchParams.get("returnTo") ?? "");
  expect(destination.origin).toBe(environment.APP_BASE_URL);
  expect(destination.pathname).toBe("/signed-out");
  return destination.searchParams.get("cleanup");
}

describe("native material sign-out cleanup", () => {
  it("never refreshes credentials while logging out", async () => {
    const { client, invoke } = fixture();
    await invoke();
    expect(client.getAccessToken).not.toHaveBeenCalled();
  });
  it("requests owner withdrawal before SDK logout, keeping tokens and receipt IDs server-side", async () => {
    const { client, fetcher, invoke } = fixture();
    const result = await invoke();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe(environment.PLATFORM_API_BASE_URL);
    expect(url.pathname).toMatch(
      /^\/v1\/material-withdrawals\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(init).toMatchObject({
      method: "PUT",
      cache: "no-store",
      redirect: "error",
      headers: { authorization: "Bearer synthetic-secret-token" },
    });
    expect(init.body).toBeUndefined();
    expect(client.middleware.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetcher.mock.invocationCallOrder[0] ?? 0,
    );
    expect(cleanupResult(client)).toBe("requested");
    expect(result.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(result.headers.get("cache-control")).toBe("no-store");
    const headers: string[] = [];
    result.headers.forEach((value) => {
      headers.push(value);
    });
    expect(headers.join(" ")).not.toContain("synthetic-secret-token");
    expect(client.middleware.mock.calls[0]?.[0].headers.get("cookie")).toBe(
      "synthetic-session=cookie",
    );
  });

  for (const headers of [
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { "sec-fetch-site": "" },
    { origin: "https://evil.example" },
    { referer: "https://evil.example" },
    { referer: "malformed" },
  ]) {
    it(`refuses untrusted navigation ${JSON.stringify(headers)}`, async () => {
      const { client, fetcher, invoke } = fixture();
      expect((await invoke(request(headers))).status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
      expect(client.getSession).not.toHaveBeenCalled();
      expect(client.middleware).not.toHaveBeenCalled();
    });
  }
  it("permits direct user navigation and ignores caller redirect overrides", async () => {
    const { client, invoke } = fixture();
    await invoke(request({ "sec-fetch-site": "none" }));
    expect(cleanupResult(client)).toBe("requested");
  });

  for (const [name, response] of [
    ["upstream rejection", () => Response.json({ secret: "raw-error" }, { status: 503 })],
    ["wrong success status", () => Response.json({}, { status: 200 })],
    ["wrong content type", () => new Response("secret", { status: 202 })],
    [
      "oversized body",
      () =>
        new Response("a".repeat(4097), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
    ],
    [
      "oversized length",
      () =>
        new Response("{}", {
          status: 202,
          headers: { "content-type": "application/json", "content-length": "99999" },
        }),
    ],
    [
      "malformed JSON",
      () => new Response("{", { status: 202, headers: { "content-type": "application/json" } }),
    ],
    [
      "wrong receipt",
      () =>
        Response.json(
          {
            requestId: "019a4000-0000-7000-8000-000000000001",
            requestedAt: "2026-10-08T12:00:00.000Z",
            state: "pending",
          },
          { status: 202 },
        ),
    ],
  ] as const) {
    it(`still logs out with unconfirmed cleanup after ${name}`, async () => {
      const { client, fetcher, invoke } = fixture();
      fetcher.mockImplementation(async () => response());
      expect((await invoke()).status).toBe(307);
      expect(cleanupResult(client)).toBe("unconfirmed");
    });
  }
  it("does not claim deletion for an already-settled native receipt", async () => {
    const { client, fetcher, invoke } = fixture();
    fetcher.mockImplementation(async (input) =>
      Response.json(
        {
          requestId: new URL(String(input)).pathname.split("/").at(-1),
          requestedAt: "2026-10-08T12:00:00.000Z",
          state: "native_tasks_settled",
        },
        { status: 202 },
      ),
    );
    await invoke();
    expect(cleanupResult(client)).toBe("requested");
  });
  it("bounds a stalled receipt stream and cancels it before logging out", async () => {
    const { client, fetcher, invoke } = fixture();
    const cancel = vi.fn();
    fetcher.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    await invoke(request(), environment, 20);
    expect(cleanupResult(client)).toBe("unconfirmed");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("bounds stalled auth retrieval and never sends a late cleanup request", async () => {
    const { client, fetcher, invoke } = fixture();
    let resolve: (value: { tokenSet: { accessToken: string } }) => void = () => undefined;
    client.getSession.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await invoke(request(), environment, 20);
    expect(cleanupResult(client)).toBe("unconfirmed");
    resolve({ tokenSet: { accessToken: "late-token" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("logs out without making a cleanup request when scopes are disabled", async () => {
    const { client, fetcher, invoke } = fixture();
    await invoke(request(), { ...environment, AUTH0_APPLICATIONS_SCOPES: "disabled" });
    expect(cleanupResult(client)).toBe("unconfirmed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not expose authentication errors", async () => {
    const { client, fetcher, invoke } = fixture();
    client.getSession.mockRejectedValue(new Error("private-token"));
    await invoke();
    expect(cleanupResult(client)).toBe("unconfirmed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sanitizes SDK logout failure", async () => {
    const { client, invoke } = fixture();
    client.middleware.mockRejectedValue(new Error("private-session-error"));
    const result = await invoke();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private-session-error");
  });
});
