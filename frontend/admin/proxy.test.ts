import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMfaRequiredError } from "./lib/auth0";
import { proxy } from "./proxy";

const { middleware, configured } = vi.hoisted(() => ({
  middleware: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("./lib/auth0", async (original) => ({
  ...(await original<typeof import("./lib/auth0")>()),
  getAuth0Client: () => ({ middleware }),
  isAuth0Configured: configured,
}));

beforeEach(() => {
  configured.mockReturnValue(true);
  vi.stubEnv("APP_BASE_URL", "http://localhost:3001");
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("admin callback failure boundary", () => {
  it("converts a post-callback MFA rejection into a fixed uncached redirect without cookies", async () => {
    middleware.mockRejectedValue(new AdminMfaRequiredError());
    const response = await proxy(
      new Request(
        "http://untrusted.example/auth/callback?code=synthetic-private-code&state=synthetic-private-state",
      ),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3001/?auth_error=mfa_required");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-middleware-next")).toBe(false);
    expect(await response.text()).not.toContain("synthetic-private");
  });

  it("preserves a successful SDK response without manufacturing another session", async () => {
    const expected = new Response(null, { status: 307, headers: { location: "/" } });
    middleware.mockResolvedValue(expected);
    expect(await proxy(new Request("http://localhost:3001/auth/callback"))).toBe(expected);
  });

  it("does not trust a spoofed error name or message as an MFA classification", async () => {
    const error = Object.assign(new Error("Admin authentication did not prove MFA"), {
      name: "AdminMfaRequiredError",
    });
    middleware.mockRejectedValue(error);
    const response = await proxy(new Request("http://localhost:3001/auth/callback"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/?auth_error=authentication_failed",
    );
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it.each(["/", "/auth/login", "/api/trust/cases"])(
    "does not turn an unrelated failure at %s into successful request continuation",
    async (path) => {
      const error = new AdminMfaRequiredError();
      middleware.mockRejectedValue(error);
      await expect(proxy(new Request(`http://localhost:3001${path}`))).rejects.toBe(error);
    },
  );

  it("keeps unknown callback failures distinct from the typed MFA refusal", async () => {
    const error = new Error("synthetic-private-provider-token-and-subject");
    middleware.mockRejectedValue(error);
    const response = await proxy(new Request("http://localhost:3001/auth/callback"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/?auth_error=authentication_failed",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-middleware-next")).toBe(false);
    expect(await response.text()).not.toContain("synthetic-private");
  });

  it("does not redirect through an invalid configured origin", async () => {
    vi.stubEnv("APP_BASE_URL", "https://admin.example.test/unexpected-path");
    middleware.mockRejectedValue(new AdminMfaRequiredError());
    await expect(proxy(new Request("http://localhost:3001/auth/callback"))).rejects.toThrow(
      "APP_BASE_URL must be an exact HTTP(S) origin",
    );
  });

  it("keeps identity-dark authentication unavailable without invoking the SDK", async () => {
    configured.mockReturnValue(false);
    const response = await proxy(new Request("http://localhost:3001/auth/login"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "identity_unavailable" });
    expect(middleware).not.toHaveBeenCalled();
  });
});
