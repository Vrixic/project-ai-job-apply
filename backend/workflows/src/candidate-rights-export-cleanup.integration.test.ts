import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDatabase, type DatabaseHandle } from "@ai-job-apply/profile-service";
import type { CandidateRightsPolicy } from "@ai-job-apply/profile-service/candidate-rights";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCandidateRightsActivityStore } from "./candidate-rights-activities.js";
import type { CandidateRightsActivityInputV1 } from "./candidate-rights-durable.js";

const requested = process.env.CANDIDATE_EXPORT_CLEANUP_INTEGRATION === "1";
const databaseUrl = process.env.CANDIDATE_EXPORT_CLEANUP_TEST_DATABASE_URL;
if (requested) {
  const url = new URL(databaseUrl ?? "invalid:");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    !/^\/d3_export_cleanup_[a-z0-9_]{1,30}$/u.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("CandidateExportCleanupIntegrationTargetRejected");
  }
}
const policy: CandidateRightsPolicy = {
  version: "synthetic-export-cleanup-v1",
  accountablePolicySha256: "a".repeat(64),
  exportArtifactLifetimeSeconds: 3600,
  downloadGrantLifetimeSeconds: 300,
  backupRetentionDays: 35,
  recentAuthenticationMaxAgeSeconds: 900,
  ownerInventory: ["identity", "profile", "documents", "jobs", "matching", "billing", "trust"],
  subprocessorInventory: [],
};

describe.skipIf(!requested)("portable export deletion PostgreSQL boundary", () => {
  let database: DatabaseHandle;
  let concurrent: DatabaseHandle;
  beforeAll(async () => {
    const execute = promisify(execFile);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
      ),
    );
    for (const owner of ["profile", "documents", "jobs", "matching", "billing", "trust"]) {
      await execute(
        process.execPath,
        [fileURLToPath(new URL(`../../services/${owner}/dist/src/migrate.js`, import.meta.url))],
        {
          env: { ...environment, NODE_ENV: "test", DATABASE_URL: databaseUrl },
        },
      );
    }
    database = createDatabase(databaseUrl as string, { maxConnections: 10 });
    concurrent = createDatabase(databaseUrl as string, { maxConnections: 2 });
  }, 90_000);
  afterAll(async () => {
    await concurrent?.client.end();
    await database?.client.end();
  });

  async function fixture() {
    const owner = uuidv7();
    const exportId = uuidv7();
    const exportOperation = uuidv7();
    const request = uuidv7();
    const deletionOperation = uuidv7();
    await database.client`INSERT INTO identity.users (id) VALUES (${owner})`;
    await database.client`INSERT INTO identity.external_identities (issuer,subject,user_id,email)
      VALUES ('https://synthetic-export.invalid/', ${owner}, ${owner}, 'synthetic@example.test')`;
    await database.client`INSERT INTO platform.operations (id,user_id,kind,state) VALUES
      (${exportOperation},${owner},'candidate_data_export','running'),
      (${deletionOperation},${owner},'account_deletion','queued')`;
    await database.client`INSERT INTO profile.candidate_data_exports (id,user_id,operation_id,format,policy_version,state)
      VALUES (${exportId},${owner},${exportOperation},'candidate-data-export-v1',${policy.version},'building')`;
    const remote = new Map<string, string>();
    let afterPut = async () => {};
    let failDelete = false;
    const store = new PostgresCandidateRightsActivityStore({
      database,
      policy,
      subprocessors: [],
      artifactStore: {
        putIfAbsent: async ({ objectKey }) => {
          remote.set(objectKey, "synthetic-remote-version");
          await afterPut();
          return { objectVersion: "synthetic-remote-version" };
        },
        inventoryExactKey: async (key) =>
          remote.has(key)
            ? [{ objectVersion: remote.get(key) as string, deleteMarker: false }]
            : [],
        deleteExactVersion: async (key, version) => {
          if (failDelete) throw new Error("SyntheticS3Failure");
          if (remote.get(key) === version) remote.delete(key);
          return true;
        },
      },
      documentObjectStore: {
        deleteAllVersionsAndMarkers: async () => ({ exactInventoryEmpty: true }),
      },
      identityProvider: { revokeAndDelete: async () => {} },
      recoveryLedger: { recordConfirmed: async (entry) => entry, markCompleted: async () => {} },
    });
    const activity = (deletion = false): CandidateRightsActivityInputV1 => ({
      schemaVersion: 1,
      workflowDefinitionVersion: 1,
      action: deletion ? "deletion_delete_active_systems" : "export_assemble",
      eventId: uuidv7(),
      resourceId: deletion ? request : exportId,
      operationId: deletion ? deletionOperation : exportOperation,
      policyVersion: policy.version,
    });
    async function quarantine() {
      await concurrent.client`/* synthetic-export-quarantine */ UPDATE identity.users
        SET account_state='quarantined', quarantined_at=clock_timestamp() WHERE id=${owner}`;
      await concurrent.client`INSERT INTO profile.account_deletion_requests
        (id,user_id,operation_id,policy_version,state,version,confirmed_at,backup_expires_at)
        VALUES (${request},${owner},${deletionOperation},${policy.version},'quarantined',2,now(),now()+interval '35 days')`;
      await concurrent.client`INSERT INTO privacy.account_deletion_ledger
        (request_id,subject_digest,policy_version,policy_sha256,state,owner_inventory,subprocessor_inventory,confirmed_at,backup_expires_at)
        VALUES (${request},${"b".repeat(64)},${policy.version},${policy.accountablePolicySha256},'quarantined',
          ${JSON.stringify(Object.fromEntries(policy.ownerInventory.map((name) => [name, "pending"])))}::jsonb,
          '{}'::jsonb,now(),now()+interval '35 days')`;
    }
    return {
      owner,
      exportId,
      exportOperation,
      request,
      remote,
      store,
      activity,
      quarantine,
      afterPut: (run: () => Promise<void>) => {
        afterPut = run;
      },
      failDelete: (value: boolean) => {
        failDelete = value;
      },
    };
  }

  it("serializes quarantine behind in-flight put and cleans its committed exact version before completion", async () => {
    const run = await fixture();
    let release = () => {};
    let reached = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    run.afterPut(async () => {
      reached();
      await paused;
    });
    const assembling = run.store.assembleExport(run.activity());
    await entered;
    const quarantining = run.quarantine();
    try {
      const deadline = Date.now() + 2000;
      let locked = false;
      while (Date.now() < deadline) {
        const rows = await concurrent.client<Array<{ waiting: boolean }>>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE query LIKE '/* synthetic-export-quarantine */%'
            AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid)) > 0
        ) AS waiting`;
        if (rows[0]?.waiting) {
          locked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(locked).toBe(true);
    } finally {
      release();
    }
    await assembling;
    await quarantining;
    await run.store.deleteActiveSystems(run.activity(true));
    expect(run.remote.size).toBe(0);
    const rows = await database.client<Array<{ state: string; artifact: string | null }>>`
      SELECT state,artifact_object_version AS artifact FROM profile.candidate_data_exports WHERE id=${run.exportId}`;
    expect(rows).toMatchObject([{ state: "expired", artifact: null }]);
    await expect(run.store.assembleExport(run.activity())).rejects.toThrow(
      "CandidateExportStateConflict",
    );
    await run.store.deleteActiveSystems(run.activity(true));
    expect(run.remote.size).toBe(0);
  });

  it("recovers a put followed by SQL rollback and keeps quarantine/metadata until retry cleanup succeeds", async () => {
    const run = await fixture();
    await database.client`CREATE FUNCTION profile.synthetic_export_reject_ready() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.state='ready' THEN RAISE EXCEPTION 'SyntheticExportPersistenceFailure'; END IF;
        RETURN NEW;
      END $$`;
    await database.client`CREATE TRIGGER synthetic_export_reject_ready BEFORE UPDATE ON profile.candidate_data_exports
      FOR EACH ROW EXECUTE FUNCTION profile.synthetic_export_reject_ready()`;
    try {
      await expect(run.store.assembleExport(run.activity())).rejects.toThrow(
        "SyntheticExportPersistenceFailure",
      );
    } finally {
      await database.client`DROP TRIGGER synthetic_export_reject_ready ON profile.candidate_data_exports`;
      await database.client`DROP FUNCTION profile.synthetic_export_reject_ready()`;
    }
    expect(run.remote.size).toBe(1);
    const before = await database.client<Array<{ state: string; artifact: string | null }>>`
      SELECT state,artifact_object_version AS artifact FROM profile.candidate_data_exports WHERE id=${run.exportId}`;
    expect(before).toMatchObject([{ state: "building", artifact: null }]);
    await run.quarantine();
    run.failDelete(true);
    await expect(run.store.deleteActiveSystems(run.activity(true))).rejects.toThrow(
      "SyntheticS3Failure",
    );
    const failed = await database.client<
      Array<{ state: string }>
    >`SELECT state FROM profile.account_deletion_requests WHERE id=${run.request}`;
    expect(failed[0]?.state).toBe("quarantined");
    run.failDelete(false);
    await run.store.deleteActiveSystems(run.activity(true));
    expect(run.remote.size).toBe(0);
    const after = await database.client<
      Array<{ state: string }>
    >`SELECT state FROM profile.candidate_data_exports WHERE id=${run.exportId}`;
    expect(after[0]?.state).toBe("failed");
    await expect(run.store.beginExport(run.activity())).rejects.toThrow();
  });
});
