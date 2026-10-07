import { expect, it, vi } from "vitest";
import type { NativeMaterialAdmissionQuery } from "./native-material-admission.js";
import { lockNativeResumePreparationAdmission } from "./native-resume-admission.js";

const id = (n: number) => `019d04cf-1f80-7000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  ownerUserId: id(1),
  applicationId: id(2),
  canonicalJobId: id(3),
  expectedRevision: 1,
  packetId: id(4),
  packetHash: "a".repeat(64),
  jobRevision: "b".repeat(64),
};
it("defaults off before owner access and refuses unrecognized input or getters", async () => {
  const query = vi.fn(),
    getter = vi.fn();
  await expect(
    lockNativeResumePreparationAdmission(scope, query as NativeMaterialAdmissionQuery),
  ).rejects.toThrow();
  for (const input of [
    { ...scope, reason: "synthetic-private" },
    { ...scope, expectedRevision: 0 },
    Object.defineProperty({ ...scope }, "ownerUserId", { enumerable: true, get: getter }),
  ])
    await expect(
      lockNativeResumePreparationAdmission(
        input,
        query as NativeMaterialAdmissionQuery,
        () => true,
      ),
    ).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
  expect(getter).not.toHaveBeenCalled();
});
it("captures scalar intent before an owning identity await", async () => {
  const input = { ...scope };
  const query = vi
    .fn()
    .mockImplementationOnce(async () => {
      input.applicationId = id(9);
      input.packetHash = "f".repeat(64);
      return [];
    })
    .mockResolvedValueOnce([{ admitted: 1 }]);
  await lockNativeResumePreparationAdmission(
    input,
    query as NativeMaterialAdmissionQuery,
    () => true,
  );
  expect(query.mock.calls[1]?.slice(1)).toEqual([
    scope.applicationId,
    scope.ownerUserId,
    scope.canonicalJobId,
    scope.expectedRevision,
    scope.packetId,
    scope.packetHash,
    scope.jobRevision,
  ]);
});
it("projects owner errors and withdrawal to a fixed refusal", async () => {
  const query = vi.fn().mockRejectedValue(Error("synthetic-private-owner-error"));
  await expect(
    lockNativeResumePreparationAdmission(scope, query as NativeMaterialAdmissionQuery, () => true),
  ).rejects.toThrow(/^NativeResumeAdmissionUnavailable$/);
  let checks = 0;
  query.mockResolvedValue([]);
  await expect(
    lockNativeResumePreparationAdmission(
      scope,
      query as NativeMaterialAdmissionQuery,
      () => ++checks === 1,
    ),
  ).rejects.toThrow();
  expect(query).toHaveBeenCalledTimes(2);
});
