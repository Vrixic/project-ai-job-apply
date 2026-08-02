import type { AuthPrincipal } from "@ai-job-apply/auth";
import { AuthenticationError } from "@ai-job-apply/auth";
import { describe, expect, it, vi } from "vitest";
import { handleDarkConformanceRequest } from "./dark-conformance-bridge.js";
import type { AuthorizedHttpApiEvent } from "./lambda.js";

const issuer = "https://identity.example.test/";
const audience = "ai-job-apply-api";
const principal: AuthPrincipal = {
  issuer,
  subject: "auth0|candidate-a",
  audience: [audience],
  scopes: ["profile:read", "profile:write"],
  email: "must-not-be-forwarded@example.test",
};

function response(statusCode = 200): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      statusCode,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }),
  );
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    audience,
    issuer,
    expectedVersion: "1",
    verifier: { verify: vi.fn().mockResolvedValue(principal) },
    invoker: {
      invoke: vi.fn().mockResolvedValue({ executedVersion: "1", payload: response() }),
    },
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    requestId: () => "request-id-0001",
    ...overrides,
  };
}

describe("development dark Lambda conformance bridge", () => {
  it("validates the real token but forwards only trusted claims and a placeholder bearer", async () => {
    const setup = dependencies();
    const result = await handleDarkConformanceRequest(
      {
        method: "PUT",
        path: "/v1/me/job-preferences",
        headers: {
          authorization: "Bearer restricted-real-token",
          "content-type": "application/json",
          "idempotency-key": "preferences-0000000000000001",
        },
        body: '{"targetRoles":["Engineer"]}',
      },
      setup,
    );

    expect(setup.verifier.verify).toHaveBeenCalledWith("restricted-real-token");
    expect(setup.invoker.invoke).toHaveBeenCalledOnce();
    const event = setup.invoker.invoke.mock.calls[0]?.[0] as AuthorizedHttpApiEvent;
    expect(event.headers.authorization).toBe("Bearer validated-loopback-authorizer-context");
    expect(JSON.stringify(event)).not.toContain("restricted-real-token");
    expect(JSON.stringify(event)).not.toContain(principal.email);
    expect(event.requestContext.authorizer?.jwt?.claims).toMatchObject({
      iss: issuer,
      sub: principal.subject,
      aud: [audience],
      scope: "profile:read profile:write",
    });
    expect(result.statusCode).toBe(200);
  });

  it("fails closed before Lambda invocation when token validation fails", async () => {
    const setup = dependencies({
      verifier: {
        verify: vi.fn().mockRejectedValue(new AuthenticationError()),
      },
    });
    const result = await handleDarkConformanceRequest(
      {
        method: "GET",
        path: "/v1/me",
        headers: { authorization: "Bearer invalid" },
      },
      setup,
    );

    expect(result.statusCode).toBe(401);
    expect(setup.invoker.invoke).not.toHaveBeenCalled();
  });

  it("allows only the explicit conformance route surface", async () => {
    const setup = dependencies();
    const result = await handleDarkConformanceRequest(
      {
        method: "POST",
        path: "/v1/admin",
        headers: { authorization: "Bearer valid" },
      },
      setup,
    );

    expect(result.statusCode).toBe(404);
    expect(setup.verifier.verify).not.toHaveBeenCalled();
    expect(setup.invoker.invoke).not.toHaveBeenCalled();
  });

  it("does not invent authorizer context for public health checks", async () => {
    const setup = dependencies();
    const result = await handleDarkConformanceRequest(
      { method: "GET", path: "/health/ready", headers: {} },
      setup,
    );

    const event = setup.invoker.invoke.mock.calls[0]?.[0] as AuthorizedHttpApiEvent;
    expect(event.requestContext.authorizer).toBeUndefined();
    expect(event.headers.authorization).toBeUndefined();
    expect(setup.verifier.verify).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
  });

  it("rejects an invocation that did not execute the pinned alias version", async () => {
    const setup = dependencies({
      invoker: {
        invoke: vi.fn().mockResolvedValue({ executedVersion: "$LATEST", payload: response() }),
      },
    });
    const result = await handleDarkConformanceRequest(
      { method: "GET", path: "/health/live", headers: {} },
      setup,
    );

    expect(result.statusCode).toBe(503);
  });
});
