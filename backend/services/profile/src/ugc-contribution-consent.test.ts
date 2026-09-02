import { describe, expect, it } from "vitest";
import {
  assertGrantCommand,
  assertTransitionCommand,
  validateVerificationCommand,
} from "./ugc-contribution-consent.js";

const ownerUserId = "019d04cf-1f80-7000-8000-000000000001";
const consentId = "019d04cf-1f80-7000-8000-000000000002";

describe("UGC contribution consent invariants", () => {
  it("accepts only an exact extension preview binding", () => {
    expect(() =>
      assertGrantCommand({
        documentVersion: "ugc-contribution-preview.v1",
        expiresAt: "2026-09-02T12:00:00.000Z",
        grantedAt: "2026-09-01T12:00:00.000Z",
        idempotencyKey: "ugc-consent-unit-0001",
        ownerUserId,
        policyVersion: "d2-ugc-policy.v1",
        previewPayloadSha256: "a".repeat(64),
        traceId: "unit-trace",
      }),
    ).not.toThrow();
    expect(() =>
      assertGrantCommand({
        documentVersion: "ugc-contribution-preview.v1",
        grantedAt: "2026-09-01T12:00:00.000Z",
        idempotencyKey: "ugc-consent-unit-0001",
        ownerUserId,
        policyVersion: "d2-ugc-policy.v1",
        previewPayloadSha256: "candidate value",
        traceId: "unit-trace",
      }),
    ).toThrow("payload binding");
  });

  it("rejects malformed owner, chronology, transition, and verification inputs", () => {
    expect(() =>
      assertGrantCommand({
        documentVersion: "ugc-contribution-preview.v1",
        expiresAt: "2026-09-01T11:00:00.000Z",
        grantedAt: "2026-09-01T12:00:00.000Z",
        idempotencyKey: "ugc-consent-unit-0002",
        ownerUserId,
        policyVersion: "d2-ugc-policy.v1",
        previewPayloadSha256: "b".repeat(64),
        traceId: "unit-trace",
      }),
    ).toThrow("expiry");
    expect(() =>
      assertTransitionCommand({
        consentId: "not-a-consent",
        idempotencyKey: "ugc-consent-unit-0003",
        occurredAt: "2026-09-01T12:00:00.000Z",
        ownerUserId,
        traceId: "unit-trace",
      }),
    ).toThrow("transition");
    expect(
      validateVerificationCommand({
        consentId,
        documentVersion: "ugc-contribution-preview.v1",
        ownerUserId: "wrong-owner",
        policyVersion: "d2-ugc-policy.v1",
        previewPayloadSha256: "c".repeat(64),
        verifiedAt: "2026-09-01T12:00:01.000Z",
      }),
    ).toBe(false);
  });
});
