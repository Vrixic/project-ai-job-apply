import { describe, expect, it, vi } from "vitest";
import { installSessionExpiryGuard, SESSION_EXPIRED_SIGN_OUT_PATH } from "./session-expiry";

const ORIGIN = "https://app.example.test";
const problem = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ code }), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });

function setup(response: () => Response | Promise<Response>) {
  const original = vi.fn<typeof fetch>(async () => response());
  const target = {
    fetch: original as typeof fetch,
    location: { origin: ORIGIN, href: `${ORIGIN}/jobs` },
  };
  const signOut = vi.fn();
  const dispose = installSessionExpiryGuard(target, signOut);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { target, original, signOut, dispose, settle };
}

describe("session expiry guard", () => {
  it("signs the candidate out when the BFF says the session expired", async () => {
    const { target, signOut, settle } = setup(() => problem(401, "session_expired"));
    const response = await target.fetch("/api/platform/jobs/abc");
    await settle();
    expect(signOut).toHaveBeenCalledTimes(1);
    // The page still gets its response, with a body it can read, until the sign-out navigates.
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "session_expired" });
  });

  it("signs out once however many requests find the session expired", async () => {
    const { target, signOut, settle } = setup(() => problem(401, "session_expired"));
    await Promise.all([
      target.fetch("/api/platform/profile/personal"),
      target.fetch("/api/platform/jobs/abc"),
      target.fetch(`${ORIGIN}/api/platform/notifications`),
    ]);
    await settle();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a missing session, which the page handles itself", 401, "authentication_required"],
    ["a recent-sign-in prompt for account deletion", 401, "authentication_required"],
    ["a refusal the candidate can act on", 403, "forbidden"],
    ["a server failure", 503, "platform_unavailable"],
    ["a success", 200, "session_expired"],
  ])("leaves %s alone", async (_name, status, code) => {
    const { target, signOut, settle } = setup(() => problem(status, code));
    await target.fetch("/api/platform/jobs/abc");
    await settle();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("ignores another site's answers and routes that are not the BFF", async () => {
    const { target, signOut, settle } = setup(() => problem(401, "session_expired"));
    await target.fetch("https://other.example.test/api/platform/jobs/abc");
    await target.fetch("/auth/profile");
    await target.fetch(new Request(`${ORIGIN}/health`));
    await settle();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("ignores a 401 that is not the problem body it knows", async () => {
    const { target, signOut, settle } = setup(
      () =>
        new Response("session_expired", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await target.fetch("/api/platform/jobs/abc");
    const broken = setup(
      () => new Response("{", { status: 401, headers: { "content-type": "application/json" } }),
    );
    await broken.target.fetch("/api/platform/jobs/abc");
    await settle();
    expect(signOut).not.toHaveBeenCalled();
    expect(broken.signOut).not.toHaveBeenCalled();
  });

  it("passes a rejected request through untouched", async () => {
    const original = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network down");
    });
    const target = {
      fetch: original as typeof fetch,
      location: { origin: ORIGIN, href: `${ORIGIN}/` },
    };
    installSessionExpiryGuard(target, vi.fn());
    await expect(target.fetch("/api/platform/jobs/abc")).rejects.toThrow("network down");
  });

  it("puts the page's own fetch back when it is removed", () => {
    const { target, original, dispose } = setup(() => problem(200, "ok"));
    expect(target.fetch).not.toBe(original);
    dispose();
    expect(target.fetch).toBe(original);
  });

  it("signs out through the existing sign-out, with the reason", () => {
    expect(SESSION_EXPIRED_SIGN_OUT_PATH).toBe("/auth/logout?reason=session_expired");
  });
});
