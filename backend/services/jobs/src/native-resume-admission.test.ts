import { describe, expect, it, vi } from "vitest";
import {
  lockNativeResumeJobAdmission,
  type NativeResumeJobQuery,
} from "./native-resume-admission.js";

const scope = {
  canonicalJobId: "01960000-0000-7000-8000-000000000001",
  jobRevision: "a".repeat(64),
  jobContextSha256: "b".repeat(64),
};
describe("native resume Jobs admission", () => {
  it("is default off before SQL and refuses accessors without executing them", async () => {
    const query = vi.fn() as unknown as NativeResumeJobQuery;
    await expect(lockNativeResumeJobAdmission(scope, query)).rejects.toThrow(
      "NativeResumeJobAdmissionUnavailable",
    );
    const getter = vi.fn();
    const altered = Object.defineProperty({ ...scope }, "jobRevision", {
      get: getter,
      enumerable: true,
    });
    await expect(lockNativeResumeJobAdmission(altered, query, () => true)).rejects.toThrow(
      "NativeResumeJobAdmissionUnavailable",
    );
    expect(getter).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it("collapses SQL diagnostics and refuses withdrawal after the revision lock", async () => {
    const query = vi.fn().mockRejectedValue(Error("synthetic posting text"));
    await expect(lockNativeResumeJobAdmission(scope, query, () => true)).rejects.toThrow(
      "NativeResumeJobAdmissionUnavailable",
    );
    const read = vi.fn().mockResolvedValue([{ revision: "1" }]);
    let checks = 0;
    await expect(lockNativeResumeJobAdmission(scope, read, () => ++checks === 1)).rejects.toThrow(
      "NativeResumeJobAdmissionUnavailable",
    );
    expect(read).toHaveBeenCalledTimes(1);
  });
});
