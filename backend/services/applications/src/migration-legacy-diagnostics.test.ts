import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  isRestrictedPacketLegacyMigrationFailure,
  reportRestrictedPacketLegacyFailure,
} from "./migration-legacy-diagnostics.js";

const failure = {
  code: "55000",
  message: "restricted packet migration requires an explicit legacy evidence transition",
};

describe("restricted legacy migration failure diagnostics", () => {
  it.each([
    null,
    Error("private connection details"),
    { ...failure, code: "42501" },
    { ...failure, message: "other guard" },
  ])("does not inspect unrelated migration failures", async (error) => {
    const begin = vi.fn();
    const report = vi.fn();
    await reportRestrictedPacketLegacyFailure(error, { begin } as unknown as postgres.Sql, report);
    expect(isRestrictedPacketLegacyMigrationFailure(error)).toBe(false);
    expect(begin).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("redacts diagnostic failures without rejecting or replacing the original failure", async () => {
    const begin = vi.fn().mockRejectedValue(new Error("synthetic private query and connection"));
    const report = vi.fn();
    await expect(
      reportRestrictedPacketLegacyFailure(failure, { begin } as unknown as postgres.Sql, report),
    ).resolves.toBeUndefined();
    expect(report.mock.calls).toEqual([
      ["Applications restricted legacy inventory unavailable; migration remains failed."],
    ]);
  });

  it("does not replace the migration failure when its log sink is unavailable", async () => {
    const begin = vi.fn().mockRejectedValue(new Error("synthetic private connection"));
    await expect(
      reportRestrictedPacketLegacyFailure(failure, { begin } as unknown as postgres.Sql, () => {
        throw new Error("log sink unavailable");
      }),
    ).resolves.toBeUndefined();
  });
});
