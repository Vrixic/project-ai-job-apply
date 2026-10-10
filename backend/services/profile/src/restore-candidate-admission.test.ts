import { expect, it, vi } from "vitest";
import { verifyRestoreCandidateOwners } from "./restore-candidate-admission.js";

const owner = "11111111-1111-4111-8111-111111111111";
const refused = /^RestoreCandidateAdmissionUnavailable$/;
it("reads bounded active Identity owners without taking a write lease", async () => {
  const unsafe = vi.fn().mockResolvedValue([{ count: "1" }]);
  await expect(verifyRestoreCandidateOwners({ unsafe }, [owner])).resolves.toBeUndefined();
  expect(unsafe).toHaveBeenCalledTimes(1);
  expect(unsafe.mock.calls[0]?.[0]).toContain("account_state='active'");
  expect(unsafe.mock.calls[0]?.[0]).not.toMatch(/FOR SHARE|FOR UPDATE|INSERT|UPDATE|DELETE/);
});
it.each(
  [
    [],
    [owner, owner],
    ["';SELECT private;--"],
    Array.from({ length: 8 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`),
  ].map((owners) => [owners]),
)("refuses malformed or unbounded owners before SQL: %j", async (owners) => {
  const unsafe = vi.fn();
  await expect(verifyRestoreCandidateOwners({ unsafe }, owners)).rejects.toThrow(refused);
  expect(unsafe).not.toHaveBeenCalled();
});
it.each(
  [[{ count: "0" }], [], [{ count: 1 }], [{ count: "1" }, { count: "1" }]].map((rows) => [rows]),
)("refuses missing or quarantined owners and malformed results", async (rows) => {
  const unsafe = vi.fn().mockResolvedValue(rows);
  await expect(verifyRestoreCandidateOwners({ unsafe }, [owner])).rejects.toThrow(refused);
});
it("redacts Identity SQL failures", async () => {
  const unsafe = vi.fn().mockRejectedValue(Error("private-owner-details"));
  await expect(verifyRestoreCandidateOwners({ unsafe }, [owner])).rejects.toThrow(refused);
});
