import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { PostgresProfilePrivateCaptureAccountStatus } from "./private-capture-account-status.js";

describe("PostgresProfilePrivateCaptureAccountStatus", () => {
  it("accepts only the exact Profile-owned active-account result", async () => {
    const activeOwner = "019d04cf-1f80-7000-8000-000000000041";
    const query = vi.fn(async (_strings: TemplateStringsArray, ownerUserId: string) => [
      { active: ownerUserId === activeOwner },
    ]);
    const authority = new PostgresProfilePrivateCaptureAccountStatus(
      query as unknown as postgres.Sql,
    );

    await expect(authority.isActive(activeOwner)).resolves.toBe(true);
    await expect(authority.isActive("019d04cf-1f80-7000-8000-000000000042")).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("propagates database failures for the service's unavailable mapping", async () => {
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const authority = new PostgresProfilePrivateCaptureAccountStatus(
      query as unknown as postgres.Sql,
    );
    await expect(authority.isActive("019d04cf-1f80-7000-8000-000000000041")).rejects.toThrow(
      "database unavailable",
    );
  });
});
