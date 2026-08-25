import { describe, expect, it, vi } from "vitest";
import { Auth0CandidateIdentityProvider } from "./candidate-rights-auth0.js";

describe("Auth0 candidate identity deletion", () => {
  it("obtains one management token and revokes sessions, refresh tokens, and the user", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "synthetic-management-token",
          token_type: "Bearer",
          expires_in: 600,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new Auth0CandidateIdentityProvider({
      issuer: "https://tenant.example.test/",
      clientId: "candidate-rights-client",
      clientSecret: "synthetic-secret",
      revocationMode: "revoke_sessions_refresh_tokens_then_delete",
      fetch,
      clock: () => new Date("2026-08-25T12:00:00.000Z"),
    });

    await provider.revokeAndDelete([
      { issuer: "https://tenant.example.test/", subject: "auth0|candidate" },
      { issuer: "https://tenant.example.test/", subject: "auth0|candidate" },
    ]);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://tenant.example.test/oauth/token", "POST"],
      ["https://tenant.example.test/api/v2/users/auth0%7Ccandidate/sessions", "DELETE"],
      ["https://tenant.example.test/api/v2/users/auth0%7Ccandidate/refresh-tokens", "DELETE"],
      ["https://tenant.example.test/api/v2/users/auth0%7Ccandidate", "DELETE"],
    ]);
    const tokenBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(tokenBody).toEqual({
      grant_type: "client_credentials",
      client_id: "candidate-rights-client",
      client_secret: "synthetic-secret",
      audience: "https://tenant.example.test/api/v2/",
    });
    expect(JSON.stringify(fetch.mock.calls.slice(1))).not.toContain("synthetic-secret");
  });

  it("fails closed for a mismatched issuer or provider rejection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ access_token: "token", token_type: "Bearer", expires_in: 600 }),
    );
    const provider = new Auth0CandidateIdentityProvider({
      issuer: "https://tenant.example.test/",
      clientId: "candidate-rights-client",
      clientSecret: "synthetic-secret",
      revocationMode: "delete_user_only",
      fetch,
    });
    await expect(
      provider.revokeAndDelete([
        { issuer: "https://other.example.test/", subject: "auth0|candidate" },
      ]),
    ).rejects.toThrow("CandidateIdentityProviderIdentityRejected");
    expect(fetch).not.toHaveBeenCalled();

    const rejectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "token", token_type: "Bearer", expires_in: 600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const rejected = new Auth0CandidateIdentityProvider({
      issuer: "https://tenant.example.test/",
      clientId: "candidate-rights-client",
      clientSecret: "synthetic-secret",
      revocationMode: "delete_user_only",
      fetch: rejectedFetch,
    });
    await expect(
      rejected.revokeAndDelete([
        { issuer: "https://tenant.example.test/", subject: "auth0|candidate" },
      ]),
    ).rejects.toThrow("CandidateIdentityProviderDeletionRejected");
  });
});
