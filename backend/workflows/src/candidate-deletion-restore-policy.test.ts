import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_CANDIDATE_DELETION_POLICIES,
  ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256,
  MAX_RESTORED_DELETION_MARKERS,
  validateHistoricalRecoveryEntries,
} from "./candidate-deletion-restore-policy.js";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

function entry(policyIndex = 1): CandidateDeletionRecoveryEntry {
  const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[policyIndex];
  if (!policy) throw new Error("Missing synthetic policy");
  return {
    requestId: "019c2b89-79b2-7000-8000-000000000001",
    operationId: "019c2b89-79b2-7000-8000-000000000002",
    userId: "019c2b89-79b2-7000-8000-000000000003",
    subjectDigest: "a".repeat(64),
    policyVersion: policy.version,
    policySha256: policy.sha256,
    confirmedAt: new Date("2026-09-02T00:00:00.000Z"),
    backupExpiresAt: new Date("2026-10-07T00:00:00.000Z"),
    completedAt: new Date("2026-09-02T00:00:01.000Z"),
  };
}

const now = new Date("2026-12-01T00:00:00.000Z");
describe("immutable restore-only candidate rights policy catalog", () => {
  it("binds only the exact recorded D1/D2 policy identities and immutable inventory", () => {
    expect(
      ACCEPTED_CANDIDATE_DELETION_POLICIES.map((policy) => policy.ownerInventory.length),
    ).toEqual([6, 7]);
    for (const index of [0, 1]) {
      expect(validateHistoricalRecoveryEntries([entry(index)], now)).toEqual([entry(index)]);
      const policy = ACCEPTED_CANDIDATE_DELETION_POLICIES[index];
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy?.ownerInventory)).toBe(true);
    }
    expect(ACCEPTED_CANDIDATE_DELETION_POLICY_CATALOG_SHA256).toBe(
      createHash("sha256")
        .update("candidate-deletion-restore-policy-catalog-v1\n")
        .update(JSON.stringify(ACCEPTED_CANDIDATE_DELETION_POLICIES))
        .update("\n")
        .digest("hex"),
    );
  });

  it("proves the historical D2 digest from the original pretty-printed source, not its reformat", () => {
    const source = JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/security/policies/candidate-rights.d2-development-synthetic-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const originalBytes = `${JSON.stringify(source, null, 2)}\n`;
    expect(createHash("sha256").update(originalBytes).digest("hex")).toBe(
      ACCEPTED_CANDIDATE_DELETION_POLICIES[1]?.sha256,
    );
    const d1 = readFileSync(
      new URL(
        "../../../docs/security/policies/candidate-rights.d1-development-synthetic-v1.json",
        import.meta.url,
      ),
    );
    expect(createHash("sha256").update(d1).digest("hex")).toBe(
      ACCEPTED_CANDIDATE_DELETION_POLICIES[0]?.sha256,
    );
  });

  it("does not invent policy expiry, renewal or current live-owner exceptions", () => {
    expect(validateHistoricalRecoveryEntries([entry(0)], now)).toHaveLength(1);
    expect(ACCEPTED_CANDIDATE_DELETION_POLICIES[0]?.ownerInventory).not.toContain("trust");
    expect(validateHistoricalRecoveryEntries([], now)).toEqual([]);
  });

  it.each([
    { policyVersion: "unapproved-v1" },
    { policySha256: "b".repeat(64) },
    { policySha256: "81ce181e671c525297a0997691bfeeb32db533af8e9fac23af34221dc03c2679" },
    { confirmedAt: new Date("invalid") },
    { backupExpiresAt: new Date("invalid") },
    { completedAt: new Date("invalid") },
    { completedAt: undefined },
    { completedAt: new Date("2026-09-01T00:00:00.000Z") },
    { completedAt: new Date("2027-01-01T00:00:00.000Z") },
    { backupExpiresAt: new Date("2026-10-07T00:00:00.001Z") },
    { requestId: "019C2B89-79b2-7000-8000-000000000001" },
    { userId: "not-a-uuid" },
    { operationId: "not-a-uuid" },
    { subjectDigest: "A".repeat(64) },
    { extra: "not-accepted" },
  ])("rejects malformed or unbound marker %j before returning entries", (change) => {
    expect(() =>
      validateHistoricalRecoveryEntries(
        [{ ...entry(), ...change } as CandidateDeletionRecoveryEntry],
        now,
      ),
    ).toThrow();
  });

  it.each(["requestId", "operationId", "userId", "subjectDigest"] as const)(
    "rejects duplicate %s across the whole set",
    (field) => {
      const first = entry();
      const second = {
        ...entry(),
        requestId: "019c2b89-79b2-7000-8000-000000000004",
        operationId: "019c2b89-79b2-7000-8000-000000000005",
        userId: "019c2b89-79b2-7000-8000-000000000006",
        subjectDigest: "b".repeat(64),
      };
      second[field] = first[field];
      expect(() => validateHistoricalRecoveryEntries([first, second], now)).toThrow(
        "CandidateDeletionRestoreMarkerCollision",
      );
    },
  );

  it("rejects invalid whole-set clock and bounds, and clones returned dates", () => {
    expect(() => validateHistoricalRecoveryEntries([], new Date("invalid"))).toThrow();
    expect(() =>
      validateHistoricalRecoveryEntries(
        Array(MAX_RESTORED_DELETION_MARKERS + 1).fill(entry()),
        now,
      ),
    ).toThrow();
    const original = entry();
    const [validated] = validateHistoricalRecoveryEntries([original], now);
    original.confirmedAt.setUTCFullYear(2020);
    expect(validated?.confirmedAt.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
});
