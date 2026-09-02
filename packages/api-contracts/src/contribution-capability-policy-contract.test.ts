import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

const envelope = {
  keyId: "extension-policy-key-v1",
  payload: {
    schemaVersion: 1,
    revision: "extension-policy-r42",
    issuedAt: "2026-09-02T12:00:00.000Z",
    expiresAt: "2026-09-02T18:00:00.000Z",
    intakeEnabled: true,
    processingEnabled: false,
    clients: { "0.2.0": true },
    providers: { ashby: true, greenhouse: true, lever: false },
    variants: {
      "ashby-job-board-v1": true,
      "greenhouse-board-v1": true,
      "lever-posting-v1": false,
    },
    domains: {
      "boards.greenhouse.io": true,
      "jobs.ashbyhq.com": true,
      "jobs.lever.co": false,
    },
  },
  signature: "a".repeat(86),
} as const;

describe("extension contribution capability policy contract", () => {
  const validate = compileComponentValidator("SignedContributionCapabilityPolicy");

  it("is an explicit public no-store route with a bounded unavailable response", () => {
    const operation = contract.paths["/extension/contribution-capability-policy"].get;
    expect(operation.security).toEqual([]);
    expect(operation.responses["200"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(operation.responses["400"]).toBeDefined();
    expect(operation.responses["503"]).toBeDefined();
  });

  it("accepts only the exact signed policy envelope", () => {
    expect(validate(envelope)).toBe(true);
    expect(validate({ ...envelope, publicKeys: { key: "pem" } })).toBe(false);
    expect(validate({ ...envelope, signingSecret: "secret" })).toBe(false);
    expect(validate({ ...envelope, signature: "not-a-signature" })).toBe(false);
    expect(
      validate({
        ...envelope,
        payload: { ...envelope.payload, clients: { latest: true } },
      }),
    ).toBe(false);
    expect(
      validate({
        ...envelope,
        payload: { ...envelope.payload, domains: { "example.com": true } },
      }),
    ).toBe(false);
  });
});

describe("job contribution owner status states", () => {
  const validate = compileComponentValidator("JobContribution");
  const status = {
    id: "019c0000-0000-7000-8000-000000000010",
    submittedAt: "2026-09-02T12:00:00.000Z",
    updatedAt: "2026-09-02T12:01:00.000Z",
  } as const;

  it("admits every safe processing state and no internal state", () => {
    const safeStates = [
      "queued",
      "normalized",
      "awaiting_independent_verification",
      "independently_verified",
      "awaiting_trust",
      "rejected",
      "ready_for_publication",
      "published",
      "consent_invalid",
      "withdrawn",
      "taken_down",
      "removed",
    ] as const;
    for (const state of safeStates) expect(validate({ ...status, state })).toBe(true);
    expect(validate({ ...status, state: "retryable_failure" })).toBe(false);
    expect(validate({ ...status, state: "published", reason: "sensitive evidence" })).toBe(false);
  });
});
