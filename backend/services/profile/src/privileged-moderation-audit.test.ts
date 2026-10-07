import type postgres from "postgres";
import { expect, it, vi } from "vitest";
import {
  PostgresPrivilegedModerationAuditStore,
  type PrivilegedModerationAuditRecord,
} from "./privileged-moderation-audit.js";

const input = {
  action: "jobs.moderation.case_search.access",
  operatorId: `oidc:${"a".repeat(64)}`,
  resourceId: null,
} as const;
it.each([
  { ...input, operatorId: "synthetic raw subject" },
  { ...input, resourceId: "bad" },
  { ...input, body: "synthetic forbidden content" },
  { ...input, token: "synthetic forbidden token" },
  { ...input, action: "profile.fact.confirmed" },
])("rejects out-of-scope or content-bearing records before SQL", async (bad) => {
  const begin = vi.fn();
  const store = new PostgresPrivilegedModerationAuditStore(
    { begin } as unknown as postgres.Sql,
    () => true,
  );
  await expect(store.record(bad as PrivilegedModerationAuditRecord)).rejects.toThrow(
    "PrivilegedModerationAuditUnavailable",
  );
  expect(begin).not.toHaveBeenCalled();
});
it("defaults off and does not evaluate input accessors", async () => {
  const begin = vi.fn(),
    getter = vi.fn(() => input.operatorId);
  const sql = { begin } as unknown as postgres.Sql;
  await expect(new PostgresPrivilegedModerationAuditStore(sql).record(input)).rejects.toThrow();
  const bad = Object.defineProperty({ ...input }, "operatorId", { enumerable: true, get: getter });
  await expect(
    new PostgresPrivilegedModerationAuditStore(sql, () => true).record(bad),
  ).rejects.toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(begin).not.toHaveBeenCalled();
});
