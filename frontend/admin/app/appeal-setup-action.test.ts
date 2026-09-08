import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyReviewerSetup } from "./appeal-setup-action";

const { getHeaders, verify, getSession } = vi.hoisted(() => ({
  getHeaders: vi.fn(),
  verify: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: getHeaders }));
vi.mock("../lib/appeal-setup", () => ({ verifyAppealSetup: verify }));
vi.mock("../lib/auth0", () => ({ getAuth0Client: () => ({ getSession }) }));

beforeEach(() => {
  vi.resetAllMocks();
});
describe("server-only reviewer setup action", () => {
  it("uses request headers and the SDK server-held session without token refresh", async () => {
    const headers = new Headers({ origin: "http://localhost:3001", host: "localhost:3001" });
    const syntheticSession = { user: { sub: "auth0|synthetic" } };
    getHeaders.mockResolvedValue(headers);
    getSession.mockResolvedValue(syntheticSession);
    verify.mockImplementation(async (receivedHeaders, dependencies) => {
      expect(receivedHeaders).toBe(headers);
      expect(dependencies.environment).toBe(process.env);
      expect(dependencies.fetch).toBe(globalThis.fetch);
      expect(await dependencies.getSession()).toBe(syntheticSession);
      return { status: "verified" };
    });
    expect(await verifyReviewerSetup()).toEqual({ status: "verified" });
    expect(getSession).toHaveBeenCalledExactlyOnceWith();
  });
  it("projects unexpected header or validation failures to one fixed result", async () => {
    getHeaders.mockRejectedValue(new Error("private callback error"));
    expect(await verifyReviewerSetup()).toEqual({ status: "verification_failed" });
    expect(verify).not.toHaveBeenCalled();
    getHeaders.mockResolvedValue(new Headers());
    verify.mockRejectedValue(new Error("private token error"));
    expect(await verifyReviewerSetup()).toEqual({ status: "verification_failed" });
  });
});
