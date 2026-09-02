import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

const CASE_ID = "019c0000-0000-8000-8000-000000000101";
const CONTRIBUTION_ID = "019c0000-0000-7000-8000-000000000102";
const DIGEST = "a".repeat(64);

describe("Phase 2 Trust API contracts", () => {
  it("keeps owner routes scoped, private, strict, and identity-free", () => {
    const owner = contract.paths["/trust/contributions/{contributionId}"].get;
    const withdraw = contract.paths["/trust/contributions/{contributionId}/withdraw"].post;
    const appeal = contract.paths["/trust/contributions/{contributionId}/appeals"].post;
    expect(owner.security).toEqual([{ oidc: ["jobs:contribute"] }]);
    expect(withdraw.security).toEqual([{ oidc: ["jobs:contribute"] }]);
    expect(appeal.security).toEqual([{ oidc: ["jobs:contribute"] }]);
    expect(owner.responses["200"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(owner.parameters?.[0]?.name).toBe("contributionId");

    const validate = compileComponentValidator("OwnerTrustCase");
    const response = {
      id: CASE_ID,
      contributionId: CONTRIBUTION_ID,
      state: "rejected",
      policyVersion: "d2-synthetic-policy.v1",
      version: 2,
      appealed: false,
      appealDeadlineAt: "2026-09-02T12:00:00.000Z",
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T13:00:00.000Z",
    };
    expect(validate(response)).toBe(true);
    expect(validate({ ...response, contributorUserId: CASE_ID })).toBe(false);
    expect(validate({ ...response, reviewerId: CASE_ID })).toBe(false);
    expect(validate({ ...response, evidenceDigestSha256: DIGEST })).toBe(false);
  });

  it("requires explicit reviewer scopes for each mutating role", () => {
    expect(contract.paths["/admin/trust/cases"].post.security).toEqual([
      { oidc: ["trust:review", "trust:case:open"] },
    ]);
    expect(contract.paths["/admin/trust/cases/{caseId}/decision"].post.security).toEqual([
      { oidc: ["trust:review", "trust:case:decide"] },
    ]);
    expect(contract.paths["/admin/trust/cases/{caseId}/takedown"].post.security).toEqual([
      { oidc: ["trust:review", "trust:case:takedown"] },
    ]);
    expect(contract.paths["/admin/trust/cases/{caseId}/appeal-resolution"].post.security).toEqual([
      { oidc: ["trust:review", "trust:appeal:resolve"] },
    ]);
  });

  it("accepts only fixed decisions and evidence digests", () => {
    const decide = compileComponentValidator("DecideTrustCaseRequest");
    expect(
      decide({
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "independently_verified",
        evidenceDigestSha256: DIGEST,
      }),
    ).toBe(true);
    expect(
      decide({
        expectedVersion: 1,
        outcome: "accepted",
        reasonCode: "content_mismatch",
        evidenceDigestSha256: DIGEST,
      }),
    ).toBe(false);
    expect(
      decide({
        expectedVersion: 1,
        outcome: "rejected",
        reasonCode: "content_mismatch",
        evidenceDigestSha256: DIGEST,
        note: "raw evidence is forbidden",
      }),
    ).toBe(false);
  });
});
