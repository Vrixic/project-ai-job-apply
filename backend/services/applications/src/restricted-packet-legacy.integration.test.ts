import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultFieldDefinitions } from "./field-definitions.js";
import { readRestrictedPacketLegacyDiagnostics } from "./migration-legacy-diagnostics.js";
import { assemblePacket, computePacketHash } from "./packet.js";

const requested = process.env.RESTRICTED_PACKET_LEGACY_INTEGRATION === "1";
const url = process.env.RESTRICTED_PACKET_LEGACY_TEST_DATABASE_URL ?? "postgres://invalid";
if (requested) {
  const target = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/restricted_packet_legacy_[a-z0-9_]{1,40}$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("RestrictedPacketLegacyIntegrationTargetRejected");
}
const execute = promisify(execFile);
const versions = [
  "0001_applications_foundation",
  "0002_candidate_rights",
  "0003_manual_submission",
  "0004_packet_preparation",
  "0005_preparation_dispatch",
  "0006_vault_approval_binding",
  "0007_document_field_hashes",
  "0008_temporary_material_bindings",
] as const;
const relations = [
  "applications",
  "packets",
  "approvals",
  "attempts",
  "history",
  "command_receipts",
  "outbox",
  "packet_preparations",
  "preparation_outbox",
  "preparation_audit",
  "schema_migrations",
] as const;
const hash = "a".repeat(64);
const at = "2026-10-05T12:00:00.000Z";
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
  ),
);

describe.skipIf(!requested)(
  "restricted packet migration from the exact historical eight-migration boundary",
  () => {
    const sql = postgres(url, { max: 2, onnotice: () => undefined });
    let migration: string;
    beforeAll(async () => {
      const [existing] = await sql`SELECT to_regnamespace('applications') AS schema`;
      if (existing?.schema !== null) throw Error("LegacyFixtureRequiresFreshOwnedDatabase");
      await execute(
        process.execPath,
        [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
        {
          env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url },
        },
      );
      // Reproduce the historical driver with original immutable SQL and exact LF checksums.
      await sql.begin(async (tx) => {
        await tx.unsafe(`CREATE SCHEMA applications;
        CREATE TABLE applications.schema_migrations (
          version text PRIMARY KEY, checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
        for (const version of versions) {
          const text = (
            await readFile(new URL(`../migrations/${version}.sql`, import.meta.url), "utf8")
          ).replaceAll("\r\n", "\n");
          await tx.unsafe(text);
          await tx`INSERT INTO applications.schema_migrations (version, checksum)
          VALUES (${version}, ${createHash("sha256").update(text).digest("hex")})`;
        }
      });
      migration = (
        await readFile(
          new URL("../migrations/0009_restricted_packet_values.sql", import.meta.url),
          "utf8",
        )
      ).replaceAll("\r\n", "\n");
    }, 60_000);
    afterAll(async () => {
      await sql.end();
    });

    async function snapshot(tx: postgres.Sql | postgres.TransactionSql) {
      const rows: Record<string, unknown> = {};
      for (const relation of relations) {
        const [row] =
          await tx.unsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(record) ORDER BY to_jsonb(record)::text), '[]'::jsonb) AS rows
        FROM applications.${relation} AS record`);
        rows[relation] = row?.rows;
      }
      const functions =
        await tx`SELECT function.proname, pg_get_functiondef(function.oid) AS definition
      FROM pg_proc function JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
      WHERE namespace.nspname = 'applications' ORDER BY function.proname, function.oid`;
      const constraints = await tx`SELECT relation.relname, constraint_definition.conname,
      constraint_definition.convalidated, pg_get_constraintdef(constraint_definition.oid) AS definition
      FROM pg_constraint constraint_definition JOIN pg_class relation ON relation.oid = constraint_definition.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'applications' ORDER BY relation.relname, constraint_definition.conname`;
      const [boundary] =
        await tx`SELECT to_regnamespace('applications_restricted') AS private_schema,
      to_regprocedure('applications.valid_restricted_packet_fields(jsonb,boolean)') AS new_function,
      (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'applications'
        AND column_name IN ('restricted_value_id', 'restricted_metadata_sha256', 'restricted_ciphertext_sha256',
          'request_hash_scheme', 'request_key_arn')) AS new_columns`;
      return { rows, functions, constraints, boundary };
    }

    async function seed(tx: postgres.TransactionSql, kind: string) {
      const owner = uuidv7();
      await tx`INSERT INTO identity.users (id) VALUES (${owner}::uuid)`;
      for (const status of ["approved", "reconciliation_required"] as const) {
        const applicationId = uuidv7();
        const packetId = uuidv7();
        const approvalId = uuidv7();
        const restricted = kind === "false" || kind === "true";
        const packet = assemblePacket(
          {
            id: packetId,
            userId: owner,
            applicationId,
            canonicalJobId: uuidv7(),
            version: 1,
            jobRevision: hash,
            form: null,
            artifactHashes: {},
            createdAt: new Date(at),
            fields: [
              {
                fieldKey: restricted ? "authorization.us_authorized" : "contact.email",
                value: restricted ? kind === "true" : "synthetic@example.test",
                origin: "user_entered",
                sourceFactIds: [],
                sourceConfirmed: true,
                confidence: 1,
              },
            ],
          },
          defaultFieldDefinitions(),
        );
        const fields = structuredClone(packet.fields);
        const field = fields[0];
        if (!field) throw Error("MissingSyntheticLegacyField");
        if (kind === "restricted_reason") field.reasons = [...field.reasons, "restricted_answer"];
        if (kind === "vault") {
          field.origin = "answer_vault";
          field.vaultReference = {
            id: uuidv7(),
            version: 1,
            context: "us",
            questionHash: hash,
            meaningConfirmed: true,
            validUntilEpochMs: null,
          };
        }
        const packetHash = computePacketHash({ ...packet, fields });
        const storedFields = kind === "scalar" ? ["vaultReference", "protectedValue"] : fields;
        await tx`INSERT INTO applications.applications
        (id, owner_user_id, canonical_job_id, status, revision, current_packet_id, created_at, updated_at)
        VALUES (${applicationId}, ${owner}, ${packet.canonicalJobId}, ${status}, 5, ${packetId}, ${at}, ${at})`;
        await tx`INSERT INTO applications.packets
        (id, application_id, owner_user_id, version, packet_hash, job_revision, fields, created_at)
        VALUES (${packetId}, ${applicationId}, ${owner}, 1, ${packetHash}, ${hash}, ${tx.json(storedFields as unknown as postgres.JSONValue)}, ${at})`;
        await tx`INSERT INTO applications.approvals
        (id, packet_id, application_id, owner_user_id, packet_hash, consent_id, acknowledged_field_keys, approved_at, expires_at)
        VALUES (${approvalId}, ${packetId}, ${applicationId}, ${owner}, ${packetHash}, ${uuidv7()},
          ${tx.array([field.fieldKey])}, ${at}, '2026-10-06T12:00:00.000Z')`;
        if (status === "reconciliation_required")
          await tx`INSERT INTO applications.attempts
          (id, application_id, owner_user_id, packet_id, packet_hash, approval_id, sequence, scope_key,
            status, adapter_id, adapter_version, started_at, dispatched_at, resolved_at)
          VALUES (${uuidv7()}, ${applicationId}, ${owner}, ${packetId}, ${packetHash}, ${approvalId}, 1,
            ${createHash("sha256").update(applicationId).digest("hex")}, 'ambiguous', 'synthetic', 'v1',
            ${at}, ${at}, ${at})`;
        await tx`INSERT INTO applications.command_receipts
        (owner_user_id, idempotency_key, operation, request_hash, application_id, response_revision, created_at)
        VALUES (${owner}, ${uuidv7()}, ${kind === "create_packet" || kind === "queue_preparation" ? kind : "approve"},
          ${hash}, ${applicationId}, 5, ${at})`;
      }
    }

    it.each(["false", "true", "vault", "restricted_reason", "create_packet", "queue_preparation"])(
      "refuses legacy %s and preserves all approval/ambiguous/replay evidence",
      async (kind) => {
        const rollback = Error("RollbackSyntheticLegacyProbe");
        await expect(
          sql.begin(async (tx) => {
            await seed(tx, kind);
            const before = await snapshot(tx);
            expect((before.rows.schema_migrations as unknown[]).length).toBe(8);
            await expect(
              tx.savepoint(async (savepoint) => {
                await savepoint.unsafe(migration);
              }),
            ).rejects.toMatchObject({
              code: "55000",
              message:
                "restricted packet migration requires an explicit legacy evidence transition",
            });
            expect(await snapshot(tx)).toEqual(before);
            throw rollback;
          }),
        ).rejects.toBe(rollback);
      },
    );

    it("permits compatible ordinary packet.v1 evidence without rewriting original approvals or hashes", async () => {
      const rollback = Error("RollbackCompatibleLegacyProbe");
      await expect(
        sql.begin(async (tx) => {
          await seed(tx, "ordinary");
          const before = await snapshot(tx);
          await tx.unsafe(migration);
          for (const relation of ["packets", "approvals", "attempts", "command_receipts"]) {
            const [row] =
              await tx.unsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(record) ORDER BY to_jsonb(record)::text), '[]'::jsonb) AS rows
          FROM applications.${relation} AS record`);
            // New private bindings stay null; ordinary receipts retain explicit legacy authority.
            if (!row || !Array.isArray(row.rows)) throw Error("MissingSyntheticMigratedRows");
            const restored = (row.rows as Array<Record<string, unknown>>).map((entry) => {
              const copy = { ...entry };
              for (const key of [
                "restricted_value_id",
                "restricted_metadata_sha256",
                "restricted_ciphertext_sha256",
                "request_hash_scheme",
                "request_key_arn",
              ])
                if (key in copy) {
                  expect(copy[key]).toBe(key === "request_hash_scheme" ? "sha256.v1" : null);
                  delete copy[key];
                }
              return copy;
            });
            expect(restored).toEqual(before.rows[relation]);
          }
          const [privateRows] =
            await tx`SELECT (SELECT count(*)::int FROM applications_restricted.packet_values) AS values,
        (SELECT count(*)::int FROM applications_restricted.packet_read_audit) AS audits`;
          expect(privateRows).toEqual({ values: 0, audits: 0 });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    });

    it("the actual current driver refuses a committed legacy database and rolls its whole transaction back", async () => {
      await sql.begin(async (tx) => {
        for (const kind of [
          "false",
          "true",
          "vault",
          "restricted_reason",
          "create_packet",
          "queue_preparation",
          "scalar",
        ]) {
          await seed(tx, kind);
        }
      });
      const before = await snapshot(sql);
      const expectedInventory = {
        kind: "applications_restricted_legacy_inventory",
        schemaVersion: 1,
        counts: {
          appliedMigrationCount: 8,
          restrictedMigrationRecorded: 0,
          packetCount: 14,
          packetsWithRestrictedValues: 8,
          packetsWithProtectedMarkers: 0,
          packetsWithInvalidContainers: 0,
          createPacketReceipts: 2,
          queuePreparationReceipts: 2,
          packetsWithApprovals: 14,
          ambiguousAttempts: 7,
        },
      };
      expect(await readRestrictedPacketLegacyDiagnostics(sql)).toEqual(expectedInventory);
      const failedRun = execute(
        process.execPath,
        [fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url))],
        {
          env: { ...inherited, NODE_ENV: "test", DATABASE_URL: url },
        },
      );
      await expect(failedRun).rejects.toThrow(
        "restricted packet migration requires an explicit legacy evidence transition",
      );
      const error = await failedRun.catch((failure: { stderr: string }) => failure);
      const inventoryLines = error.stderr
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('{"kind":"applications_restricted_legacy_inventory"'));
      expect(inventoryLines).toHaveLength(1);
      expect(JSON.parse(inventoryLines[0] ?? "null")).toEqual(expectedInventory);
      expect(error.stderr).not.toContain("synthetic@example.test");
      expect(await snapshot(sql)).toEqual(before);
      expect(before.boundary).toEqual({ private_schema: null, new_function: null, new_columns: 0 });

      const readerRole = `legacy_inventory_${uuidv7().replaceAll("-", "")}`;
      await sql`CREATE ROLE ${sql(readerRole)} LOGIN PASSWORD 'local_only'`;
      await sql`GRANT USAGE ON SCHEMA applications TO ${sql(readerRole)}`;
      await sql`GRANT SELECT ON ALL TABLES IN SCHEMA applications TO ${sql(readerRole)}`;
      const readerUrl = new URL(url);
      readerUrl.username = readerRole;
      readerUrl.password = "local_only";
      const reader = postgres(readerUrl.toString(), { max: 1, onnotice: () => undefined });
      try {
        expect(await readRestrictedPacketLegacyDiagnostics(reader)).toEqual(expectedInventory);
        await expect(reader`DELETE FROM applications.packets`).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await reader.end();
        await sql`REVOKE SELECT ON ALL TABLES IN SCHEMA applications FROM ${sql(readerRole)}`;
        await sql`REVOKE USAGE ON SCHEMA applications FROM ${sql(readerRole)}`;
        await sql`DROP ROLE ${sql(readerRole)}`;
      }
      expect(await snapshot(sql)).toEqual(before);
    });
  },
);
