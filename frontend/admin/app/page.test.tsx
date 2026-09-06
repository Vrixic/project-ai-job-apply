import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "./page";

const { getSession, configured } = vi.hoisted(() => ({
  getSession: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("../lib/auth0", async (original) => ({
  ...(await original<typeof import("../lib/auth0")>()),
  getAuth0Client: () => ({ getSession }),
  isAuth0Configured: configured,
}));

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", undefined);
  getSession.mockResolvedValue({ user: { amr: ["mfa"] } });
  configured.mockReturnValue(true);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function markup() {
  return renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }));
}

describe("server-selected admin authorization profile", () => {
  it("preserves the standard moderation and Trust controls when the profile is unset", async () => {
    const html = await markup();
    expect(html).toContain("Job and source moderation");
    expect(html).toContain("Open review case");
    expect(html).toContain("Accept independently verified");
    expect(html).toContain("Take down: rights or policy violation");
  });

  it("renders only the appeal review surface for the appeals profile", async () => {
    vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", "appeals");
    const html = await markup();
    expect(html).toContain("Independent contribution appeals");
    expect(html).toContain('value="appeal_pending" selected=""');
    expect(html).toContain("Uphold appeal");
    expect(html).toContain("Reverse appeal");
    expect(html).toContain("A profile is not a permission grant.");
    expect(html).not.toContain("Job and source moderation");
    expect(html).not.toContain("Open review case");
    expect(html).not.toContain("Accept independently verified");
    expect(html).not.toContain("Take down: rights or policy violation");
    expect(html).not.toContain("Confirm takedown");
  });

  it("labels the human appeal sign-in without rendering privileged controls before login", async () => {
    vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", "appeals");
    getSession.mockResolvedValue(null);
    const html = await markup();
    expect(html).toContain("Sign in as appeal reviewer");
    expect(html).not.toContain("Uphold appeal");
    expect(html).not.toContain("Open review case");
  });

  it("fails closed for an invalid server profile before creating a session", async () => {
    vi.stubEnv("ADMIN_AUTHORIZATION_PROFILE", "invalid");
    await expect(markup()).rejects.toThrow(
      "ADMIN_AUTHORIZATION_PROFILE must be standard or appeals",
    );
    expect(getSession).not.toHaveBeenCalled();
  });
});
