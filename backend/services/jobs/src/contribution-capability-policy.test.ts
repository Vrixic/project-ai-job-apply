import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contributionCapabilityPolicyDigestInput,
  type D2ContributionCapabilityPolicy,
  evaluateContributionCapability,
  verifySignedContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";

const policy: D2ContributionCapabilityPolicy = {
  schemaVersion: 1,
  revision: "d2-synthetic-capability-v1",
  issuedAt: "2026-09-01T12:00:00.000Z",
  expiresAt: "2026-09-02T12:00:00.000Z",
  intakeEnabled: true,
  processingEnabled: false,
  clients: { "0.2.0": true, "0.2.1": false },
  providers: { ashby: false, greenhouse: false, lever: true },
  variants: {
    "ashby-job-board-v1": false,
    "greenhouse-board-v1": false,
    "lever-posting-v1": true,
  },
  domains: {
    "boards.greenhouse.io": false,
    "job-boards.greenhouse.io": false,
    "jobs.ashbyhq.com": false,
    "jobs.eu.lever.co": false,
    "jobs.lever.co": true,
  },
};

describe("signed contribution capability policy", () => {
  it("verifies an exact Ed25519 envelope and rejects tampering or unknown keys", () => {
    const keys = generateKeyPairSync("ed25519");
    const signature = sign(
      null,
      Buffer.from(contributionCapabilityPolicyDigestInput(policy)),
      keys.privateKey,
    ).toString("base64url");
    const envelope = { keyId: "synthetic-key-v1", payload: policy, signature };
    const publicKeys = {
      "synthetic-key-v1": keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    };
    expect(verifySignedContributionCapabilityPolicy(envelope, publicKeys)).toEqual(policy);
    expect(() =>
      verifySignedContributionCapabilityPolicy(
        { ...envelope, payload: { ...policy, processingEnabled: true } },
        publicKeys,
      ),
    ).toThrow(/signature/u);
    expect(() =>
      verifySignedContributionCapabilityPolicy(
        { ...envelope, keyId: "unknown-key-v1" },
        publicKeys,
      ),
    ).toThrow(/unknown/u);
  });

  it("denies each intake and processing gate independently", () => {
    const base = {
      stage: "intake" as const,
      clientVersion: "0.2.0",
      provider: "lever" as const,
      pageVariant: "lever-posting-v1" as const,
      domain: "jobs.lever.co",
      now: new Date("2026-09-01T13:00:00.000Z"),
    };
    expect(evaluateContributionCapability(policy, base)).toEqual({
      allowed: true,
      policyRevision: policy.revision,
    });
    expect(evaluateContributionCapability(policy, { ...base, stage: "processing" })).toEqual({
      allowed: false,
      reason: "global_disabled",
    });
    expect(evaluateContributionCapability(policy, { ...base, clientVersion: "0.2.1" })).toEqual({
      allowed: false,
      reason: "client_disabled",
    });
    expect(evaluateContributionCapability(policy, { ...base, provider: "ashby" })).toEqual({
      allowed: false,
      reason: "provider_disabled",
    });
    expect(
      evaluateContributionCapability(policy, {
        ...base,
        pageVariant: "greenhouse-board-v1",
      }),
    ).toEqual({ allowed: false, reason: "variant_disabled" });
    expect(evaluateContributionCapability(policy, { ...base, domain: "jobs.eu.lever.co" })).toEqual(
      { allowed: false, reason: "domain_disabled" },
    );
    expect(
      evaluateContributionCapability(policy, {
        ...base,
        now: new Date("2026-09-02T12:00:00.000Z"),
      }),
    ).toEqual({ allowed: false, reason: "policy_expired" });
    expect(
      evaluateContributionCapability(policy, {
        ...base,
        now: new Date("2026-09-01T11:59:59.999Z"),
      }),
    ).toEqual({ allowed: false, reason: "policy_not_yet_valid" });
  });

  it("rejects incomplete boundaries, overlong lifetimes, and unknown fields", () => {
    expect(() =>
      contributionCapabilityPolicyDigestInput({
        ...policy,
        providers: { ashby: false, greenhouse: false } as never,
      }),
    ).toThrow(/incomplete/u);
    expect(() =>
      contributionCapabilityPolicyDigestInput({
        ...policy,
        expiresAt: "2026-09-03T12:00:00.001Z",
      }),
    ).toThrow(/lifetime/u);
    expect(() =>
      contributionCapabilityPolicyDigestInput({ ...policy, remoteCode: "https://bad" } as never),
    ).toThrow(/invalid/u);
    for (const version of ["latest", "01.2.3", "1234567.2.3", "1.2.3-abcdefghijklmnopq"]) {
      expect(() =>
        contributionCapabilityPolicyDigestInput({
          ...policy,
          clients: { [version]: true },
        }),
      ).toThrow(/map/u);
    }
  });
});
