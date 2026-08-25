import { describe, expect, it, vi } from "vitest";
import { resolveCandidateRightsAuth0Secret } from "./candidate-rights-secret.js";

describe("candidate-rights managed identity secret", () => {
  it("retrieves and validates the exact secret without accepting configuration extras", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            SecretString: JSON.stringify({
              clientId: "candidate-rights-client",
              clientSecret: "synthetic-secret-value",
              revocationMode: "delete_user_only",
            }),
          }),
          { status: 200 },
        ),
    );
    await expect(
      resolveCandidateRightsAuth0Secret("secret-arn", {
        sessionToken: "session-token",
        fetchImplementation,
        retryDelaysMilliseconds: [],
      }),
    ).resolves.toEqual({
      clientId: "candidate-rights-client",
      clientSecret: "synthetic-secret-value",
      revocationMode: "delete_user_only",
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("http://localhost:2773/secretsmanager/get?secretId=secret-arn"),
      expect.objectContaining({
        headers: { "X-Aws-Parameters-Secrets-Token": "session-token" },
      }),
    );

    await expect(
      resolveCandidateRightsAuth0Secret("secret-arn", {
        sessionToken: "session-token",
        retryDelaysMilliseconds: [],
        fetchImplementation: async () =>
          new Response(
            JSON.stringify({
              SecretString: JSON.stringify({
                clientId: "candidate-rights-client",
                clientSecret: "synthetic-secret-value",
                revocationMode: "delete_user_only",
                unexpected: true,
              }),
            }),
          ),
      }),
    ).rejects.toThrow("CandidateRightsIdentitySecretInvalid");
  });

  it("fails closed without the extension context and retries only bounded transient failures", async () => {
    await expect(resolveCandidateRightsAuth0Secret(undefined)).rejects.toThrow(
      "CandidateRightsIdentitySecretContextUnavailable",
    );
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      resolveCandidateRightsAuth0Secret("secret-arn", {
        sessionToken: "session-token",
        fetchImplementation,
        retryDelaysMilliseconds: [0],
        sleepImplementation: async () => undefined,
      }),
    ).rejects.toThrow("CandidateRightsIdentitySecretUnavailable");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
