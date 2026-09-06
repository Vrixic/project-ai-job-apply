import type { AuthPrincipal } from "@ai-job-apply/auth";
import type { TrustReviewerRole } from "@ai-job-apply/trust-service";
import { describe, expect, it } from "vitest";
import {
  OidcTrustReviewerAuthority,
  TrustReviewerAccessDeniedError,
  trustReviewerId,
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

  describe("dedicated M2M reviewer and separate human appeal reviewer", () => {
    const actors = [
      {
        label: "delegated M2M reviewer",
        subject: "synthetic-agent-reviewer@clients",
        scopes: ["trust:review", "trust:case:decide", "trust:case:takedown"],
        roles: ["case_reader", "initial_reviewer", "takedown_reviewer"],
      },
      {
        label: "human appeal reviewer",
        subject: "auth0|synthetic-human-appeal-reviewer",
        scopes: ["trust:review", "trust:appeal:resolve"],
        roles: ["case_reader", "appeal_reviewer"],
      },
    ] as const;
    const roleScopes: Readonly<Record<TrustReviewerRole, readonly string[]>> = {
      case_reader: ["trust:review"],
      case_opener: ["trust:review", "trust:case:open"],
      initial_reviewer: ["trust:review", "trust:case:decide"],
      takedown_reviewer: ["trust:review", "trust:case:takedown"],
      appeal_reviewer: ["trust:review", "trust:appeal:resolve"],
    };
    const allRoles = Object.keys(roleScopes) as TrustReviewerRole[];
    const allScopes = [...new Set(Object.values(roleScopes).flat())];
    const authority = new OidcTrustReviewerAuthority(
      actors.map((actor) => ({
        issuer: principal.issuer,
        subject: actor.subject,
        roles: actor.roles,
      })),
    );

    describe.each(actors)("$label", (actor) => {
      const actorPrincipal: AuthPrincipal = {
        ...principal,
        subject: actor.subject,
        scopes: [...actor.scopes],
      };

      it.each(["exact", "excess"] as const)(
        "allows only its assigned roles with %s token scopes",
        (scopeMode) => {
          const claims = {
            ...actorPrincipal,
            scopes: scopeMode === "exact" ? actorPrincipal.scopes : allScopes,
          };
          const assignedRoles: readonly TrustReviewerRole[] = actor.roles;
          for (const role of allRoles) {
            if (assignedRoles.includes(role)) {
              expect(authority.resolve(claims, role)).toBe(
                trustReviewerId(principal.issuer, actor.subject),
              );
            } else {
              expect(() => authority.resolve(claims, role)).toThrow(TrustReviewerAccessDeniedError);
            }
          }
        },
      );

      it("denies wrong issuer and unassigned subject even with all reviewer scopes", () => {
        for (const identity of [
          { issuer: "https://other-environment.example.auth0.com/", subject: actor.subject },
          { issuer: principal.issuer, subject: `${actor.subject}-unassigned` },
        ]) {
          for (const role of allRoles) {
            expect(() =>
              authority.resolve({ ...actorPrincipal, ...identity, scopes: allScopes }, role),
            ).toThrow(TrustReviewerAccessDeniedError);
          }
        }
      });

      it("denies each assigned operation when any required scope is missing", () => {
        for (const role of actor.roles) {
          for (const missingScope of roleScopes[role]) {
            expect(() =>
              authority.resolve(
                {
                  ...actorPrincipal,
                  scopes: allScopes.filter((scope) => scope !== missingScope),
                },
                role,
              ),
            ).toThrow(TrustReviewerAccessDeniedError);
          }
        }
      });
    });

    it("keeps the agent and human audit identities distinct and stable", () => {
      const reviewerIds = actors.map((actor) =>
        authority.resolve(
          { ...principal, subject: actor.subject, scopes: [...actor.scopes] },
          "case_reader",
        ),
      );
      expect(new Set(reviewerIds).size).toBe(2);
      expect(reviewerIds).toEqual(
        actors.map((actor) => trustReviewerId(principal.issuer, actor.subject)),
      );
    });
  });
});
