import type { AuthPrincipal, IdTokenVerifier } from "@ai-job-apply/auth";
import { describe, expect, it } from "vitest";
import {
  bindCandidateReauthenticationProof,
  CANDIDATE_REAUTHENTICATION_HEADER,
} from "./app.module.js";

const signedIdToken = "signed-header-segment.signed-payload-segment.signed-signature-segment";

const accessPrincipal: AuthPrincipal = {
  issuer: "https://identity.example.test/",
  subject: "auth0|candidate-1",
  audience: ["ai-job-apply-api"],
  scopes: ["profile:write"],
  authenticatedAt: 1,
  authenticationMethods: ["pwd"],
};

function verifier(overrides: Partial<Awaited<ReturnType<IdTokenVerifier["verify"]>>> = {}) {
  return {
    async verify(token: string) {
      expect(token).toBe(signedIdToken);
      return {
        issuer: accessPrincipal.issuer,
        subject: accessPrincipal.subject,
        audience: ["auth0-client-id-1234"],
        authenticatedAt: 1_787_595_600,
        authenticationMethods: ["pwd", "mfa"],
        ...overrides,
      };
    },
    async verifyIdentity() {
      throw new Error("The identity-only check is not part of this boundary");
    },
  } satisfies IdTokenVerifier;
}

describe("candidate reauthentication boundary", () => {
  it("binds verified ID-token authentication evidence to the access-token principal", async () => {
    expect(CANDIDATE_REAUTHENTICATION_HEADER).toBe("x-ai-job-apply-reauthentication");
    await expect(
      bindCandidateReauthenticationProof(accessPrincipal, signedIdToken, verifier()),
    ).resolves.toMatchObject({
      issuer: accessPrincipal.issuer,
      subject: accessPrincipal.subject,
      authenticatedAt: 1_787_595_600,
      authenticationMethods: ["pwd", "mfa"],
    });
  });

  it("rejects absent, repeated, oversized, and unconfigured proofs", async () => {
    await expect(
      bindCandidateReauthenticationProof(accessPrincipal, undefined, verifier()),
    ).rejects.toThrow();
    await expect(
      bindCandidateReauthenticationProof(
        accessPrincipal,
        ["one.two.three", "four.five.six"],
        verifier(),
      ),
    ).rejects.toThrow();
    await expect(
      bindCandidateReauthenticationProof(accessPrincipal, `${"a".repeat(16_384)}.b.c`, verifier()),
    ).rejects.toThrow();
    await expect(
      bindCandidateReauthenticationProof(accessPrincipal, "Bearer signed.id.token", verifier()),
    ).rejects.toThrow();
    await expect(
      bindCandidateReauthenticationProof(accessPrincipal, signedIdToken, null),
    ).rejects.toThrow();
  });

  it("rejects an ID-token proof for a different issuer or subject", async () => {
    await expect(
      bindCandidateReauthenticationProof(
        accessPrincipal,
        signedIdToken,
        verifier({ subject: "auth0|other-candidate" }),
      ),
    ).rejects.toThrow("does not match");
    await expect(
      bindCandidateReauthenticationProof(
        accessPrincipal,
        signedIdToken,
        verifier({ issuer: "https://other.example.test/" }),
      ),
    ).rejects.toThrow("does not match");
  });
});
