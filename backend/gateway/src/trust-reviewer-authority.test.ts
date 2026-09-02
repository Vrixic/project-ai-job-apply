import type { AuthPrincipal } from "@ai-job-apply/auth";
import { describe, expect, it } from "vitest";
import {
  OidcTrustReviewerAuthority,
  TrustReviewerAccessDeniedError,
} from "./trust-reviewer-authority.js";

const principal: AuthPrincipal = {
  issuer: "https://development.example.auth0.com/",
  subject: "auth0|synthetic-reviewer",
  audience: ["ai-job-apply-api"],
  scopes: ["trust:review", "trust:case:decide"],
};

describe("OIDC Trust reviewer authority", () => {
  it("requires both exact verified claims/scopes and an explicit server-side role", () => {
    const authority = new OidcTrustReviewerAuthority([
      { issuer: principal.issuer, subject: principal.subject, roles: ["initial_reviewer"] },
    ]);
    expect(authority.resolve(principal, "initial_reviewer")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(() => authority.resolve(principal, "appeal_reviewer")).toThrow(
      TrustReviewerAccessDeniedError,
    );
    expect(() =>
      authority.resolve({ ...principal, subject: "auth0|other" }, "initial_reviewer"),
    ).toThrow(TrustReviewerAccessDeniedError);
  });

  it("requires the dedicated verified-requester takedown scope", () => {
    const authority = new OidcTrustReviewerAuthority();
    expect(() => authority.requireVerifiedRequesterScope(principal)).toThrow(
      TrustReviewerAccessDeniedError,
    );
    expect(() =>
      authority.requireVerifiedRequesterScope({
        ...principal,
        scopes: [...principal.scopes, "trust:requester:takedown"],
      }),
    ).not.toThrow();
  });

  it("fails closed without assignments", () => {
    expect(() => new OidcTrustReviewerAuthority().resolve(principal, "initial_reviewer")).toThrow(
      TrustReviewerAccessDeniedError,
    );
  });
});
