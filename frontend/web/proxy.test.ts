import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  middleware: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("./lib/auth0", () => ({
  isAuth0Configured: mocks.configured,
  getAuth0Client: () => ({ middleware: mocks.middleware }),
}));
vi.mock("./lib/native-material-logout", () => ({ nativeMaterialLogout: mocks.cleanup }));

import { proxy } from "./proxy";

describe("sign-out cleanup routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.middleware.mockResolvedValue(NextResponse.next());
    mocks.cleanup.mockResolvedValue(NextResponse.redirect("https://identity.example.test/logout"));
  });
  afterEach(() => vi.unstubAllEnvs());
  it("preserves ordinary SDK logout while the deployment gate is off", async () => {
    vi.stubEnv("NATIVE_MATERIAL_LOGOUT_ENABLED", "false");
    const request = new Request("https://app.example.test/auth/logout");
    await proxy(request);
    expect(mocks.middleware).toHaveBeenCalledWith(request);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it("routes enabled direct logout through cleanup before SDK logout", async () => {
    vi.stubEnv("NATIVE_MATERIAL_LOGOUT_ENABLED", "true");
    await proxy(new Request("https://app.example.test/auth/logout"));
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.middleware).not.toHaveBeenCalled();
  });
  for (const route of ["/auth/login", "/auth/callback", "/settings", "/signed-out"]) {
    it(`leaves ${route} on the existing auth path`, async () => {
      vi.stubEnv("NATIVE_MATERIAL_LOGOUT_ENABLED", "true");
      await proxy(new Request(`https://app.example.test${route}`));
      expect(mocks.middleware).toHaveBeenCalledOnce();
      expect(mocks.cleanup).not.toHaveBeenCalled();
    });
  }
  it("does not attempt cleanup while identity is unconfigured", async () => {
    vi.stubEnv("NATIVE_MATERIAL_LOGOUT_ENABLED", "true");
    mocks.configured.mockReturnValue(false);
    expect((await proxy(new Request("https://app.example.test/auth/logout"))).status).toBe(503);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
