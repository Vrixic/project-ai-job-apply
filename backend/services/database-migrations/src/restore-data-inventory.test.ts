import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildRestoreDataQuery,
  collectRestoreDataInventory,
  compareRestoreDataInventories,
  type RestoreDataInventory,
  restoreDataLimits,
} from "./restore-data-inventory.js";
import { loadCurrentRestoreManifest, type RestoreSqlClient } from "./restore-verifier.js";

const source = loadCurrentRestoreManifest();
function sign(body: Omit<RestoreDataInventory, "digest">): RestoreDataInventory {
  return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}
function inventory(): RestoreDataInventory {
  return sign({
    schemaVersion: 1,
    serializer: "postgres16-jsonb-whole-row-sha256-v1",
    manifestSha256: source.sha256,
    relations: source.manifest.contributors
      .flatMap((owner) => owner.relations)
      .sort()
      .map((relation) => ({
        relation,
        columns: [{ name: "id", type: "bigint", notNull: true, identity: "", generated: "" }],
        rowCount: 0,
        byteCount: 0,
        rowDigest: "a".repeat(64),
      })),
  });
}
function changeRelation(relation: string, update: Record<string, unknown>): RestoreDataInventory {
  const { digest: _digest, ...body } = inventory();
  return sign({
    ...body,
    relations: body.relations.map((row) =>
      row.relation === relation ? { ...row, ...update } : row,
    ),
  });
}

describe("restore data comparison refuses unproven equality", () => {
  it("compares all current manifest relations", () => {
    expect(inventory().relations).toHaveLength(100);
    expect(compareRestoreDataInventories(inventory(), inventory())).toEqual({
      equal: true,
      manifestEqual: true,
      differingRelations: [],
    });
  });
  it.each([
    "profile.restricted_answer_versions",
    "privacy.account_deletion_ledger",
    "profile.ugc_contribution_consents",
    "applications.schema_migrations",
    "applications.command_receipts",
    "applications_restricted.legacy_receipts",
    "applications.native_material_withdrawals",
    "documents.native_resume_generations",
  ])("never excludes %s", (relation) => {
    const result = compareRestoreDataInventories(
      inventory(),
      changeRelation(relation, { rowDigest: "b".repeat(64) }),
    );
    expect(result.equal).toBe(false);
    expect(result.differingRelations).toEqual([relation]);
  });
  it("detects empty-table schema changes", () => {
    expect(
      compareRestoreDataInventories(
        inventory(),
        changeRelation("identity.users", {
          columns: [{ name: "id", type: "text", notNull: true, identity: "", generated: "" }],
        }),
      ).equal,
    ).toBe(false);
  });
  it("rejects matching inventories that omit a declared relation", () => {
    const { digest: _digest, ...body } = inventory();
    const omitted = sign({ ...body, relations: body.relations.slice(1) });
    expect(() => compareRestoreDataInventories(omitted, omitted)).toThrow("inventory is invalid");
  });
  it("rejects stale or unbound manifests and evidence hashes", () => {
    const original = inventory();
    expect(() =>
      compareRestoreDataInventories(original, { ...original, manifestSha256: "b".repeat(64) }),
    ).toThrow();
    expect(() =>
      compareRestoreDataInventories(original, { ...original, digest: "b".repeat(64) }),
    ).toThrow();
  });
  it("requires an explicit separate contract for an older snapshot", () => {
    const { digest: _digest, ...body } = inventory();
    const historical = sign({ ...body, manifestSha256: "b".repeat(64) });
    expect(() => compareRestoreDataInventories(inventory(), historical)).toThrow();
    const result = compareRestoreDataInventories(inventory(), historical, source, {
      ...source,
      sha256: historical.manifestSha256,
    });
    expect(result).toEqual({ equal: false, manifestEqual: false, differingRelations: [] });
  });
  it("rejects oversized evidence even with a recomputed checksum", () => {
    const { digest: _digest, ...body } = inventory();
    const oversized = sign({
      ...body,
      relations: body.relations.map((row) => ({
        ...row,
        rowCount: restoreDataLimits.rowsPerRelation,
      })),
    });
    expect(() => compareRestoreDataInventories(oversized, oversized)).toThrow("budget exceeded");
    const tableOverflow = changeRelation("identity.users", {
      byteCount: restoreDataLimits.bytesPerRelation + 1,
    });
    expect(() => compareRestoreDataInventories(tableOverflow, tableOverflow)).toThrow(
      "budget exceeded",
    );
  });
  it.each([
    { rowCount: "0" },
    { byteCount: "0" },
    { rowCount: -1 },
    { byteCount: 0.5 },
    { payload: "candidate-secret" },
  ])("rejects malformed rehashed relation evidence %j", (change) => {
    const modified = changeRelation("identity.users", change);
    expect(() => compareRestoreDataInventories(modified, modified)).toThrow();
  });
  it("rejects extra top-level and column payload fields", () => {
    const { digest: _digest, ...body } = inventory();
    const extra = sign({ ...body, payload: "candidate-secret" } as typeof body);
    expect(() => compareRestoreDataInventories(extra, extra)).toThrow("shape is invalid");
    const columnExtra = changeRelation("identity.users", {
      columns: [
        {
          name: "id",
          type: "text",
          notNull: true,
          identity: "",
          generated: "",
          payload: "candidate-secret",
        },
      ],
    });
    expect(() => compareRestoreDataInventories(columnExtra, columnExtra)).toThrow(
      "shape is invalid",
    );
  });
  it.each([
    "identity.users; DROP SCHEMA profile",
    "identity.users.extra",
    'identity."users"',
    "identity.Users",
  ])("refuses injected relation %s", (relation) =>
    expect(() => buildRestoreDataQuery(relation)).toThrow(),
  );
  it("redacts raw SQL/credential/value errors", async () => {
    const client: RestoreSqlClient = {
      async begin() {
        throw new Error("postgres://platform:secret@host candidate-secret SQL detail");
      },
    };
    await expect(collectRestoreDataInventory(client)).rejects.toEqual(
      new Error("Restore data inventory failed"),
    );
  });
});
