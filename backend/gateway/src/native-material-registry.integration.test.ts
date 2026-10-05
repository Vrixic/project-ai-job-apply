import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { lockNativeMaterialApplicationAdmission } from "@ai-job-apply/applications-service";
import {
  PostgresCoverLetterStore,
  PostgresCoverLetterWorkStore,
} from "@ai-job-apply/documents-service/cover-letter-runtime";
import { createNativeMaterialDisposal } from "@ai-job-apply/documents-service/native-material-disposal";
import {
  type NativeMaterialIntent,
  PostgresNativeMaterialRegistry,
} from "@ai-job-apply/documents-service/native-material-registry";
import type { NativeTaskAllocation } from "@ai-job-apply/documents-service/native-task-retirement";
import { createNativeTaskRetirement } from "@ai-job-apply/documents-service/native-task-retirement";

const requested = process.env.NATIVE_MATERIAL_REGISTRY_INTEGRATION === "1";
const databaseUrl = process.env.NATIVE_MATERIAL_REGISTRY_TEST_DATABASE_URL;
if (requested) {
  const target = new URL(databaseUrl ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.hostname !== "127.0.0.1" ||
    !/^\/work_ledger_native_registry$/u.test(target.pathname) ||
    target.search ||
    target.hash
  )
    throw Error("NativeRegistryIntegrationTargetRejected");
}
const execute = promisify(execFile);
const deployment = {
  clusterArn: "arn:aws:ecs:us-east-2:123456789012:cluster/synthetic-materials",
  taskDefinitionArn: "arn:aws:ecs:us-east-2:123456789012:task-definition/synthetic-materials:7",
  containerName: "materials",
};

describe.skipIf(!requested)(
  "native registry with real PostgreSQL and owning application admission",
  () => {
    const sql = postgres(databaseUrl ?? "postgres://invalid", {
      max: 8,
      onnotice: () => undefined,
    });
    const registry = new PostgresNativeMaterialRegistry(
      sql,
      () => true,
      lockNativeMaterialApplicationAdmission,
    );
    const work = new PostgresCoverLetterWorkStore(sql, () => true);
    const documents = new PostgresCoverLetterStore(sql, {
      putIfAbsent: async () => {
        throw Error("UnexpectedSyntheticObjectWrite");
      },
      read: async () => {
        throw Error("UnexpectedSyntheticObjectRead");
      },
    });
    beforeAll(async () => {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const path of [
        "../../services/profile/dist/src/migrate.js",
        "../../services/applications/dist/src/migrate.js",
        "../../services/documents/dist/src/migrate.js",
      ]) {
        const args = [fileURLToPath(new URL(path, import.meta.url))];
        const options = { env: { ...inherited, NODE_ENV: "test", DATABASE_URL: databaseUrl } };
        const first = await execute(process.execPath, args, options);
        const replay = await execute(process.execPath, args, options);
        expect(replay.stdout).toBe(first.stdout);
      }
    }, 90_000);
    afterAll(async () => {
      await sql.end();
    });

    async function fixture(owner = uuidv7(), application = uuidv7(), createIdentity = true) {
      if (createIdentity) {
        await sql`INSERT INTO identity.users (id) VALUES (${owner})`;
        await sql`INSERT INTO applications.applications (id, owner_user_id, canonical_job_id, status, created_at, updated_at)
        VALUES (${application}, ${owner}, ${uuidv7()}, 'preparing', clock_timestamp(), clock_timestamp())`;
      }
      const documentId = uuidv7();
      const document = await documents.reserve({
        id: documentId,
        ownerUserId: owner,
        applicationId: application,
        jobRevision: "a".repeat(64),
        confirmedFactsHash: "b".repeat(64),
      });
      const grant = (
        await work.issue({
          ownerUserId: owner,
          documentId,
          purpose: "provider_dispatch",
          requestSha256: "c".repeat(64),
          consentExpiresAt: new Date(Date.now() + 900_000),
        })
      ).authorization;
      const original = {
        id: grant.id,
        documentId,
        purpose: "provider_dispatch" as const,
        requestSha256: grant.requestSha256,
      };
      const input = {
        ownerUserId: owner,
        applicationId: application,
        original,
        previousEpochId: null,
        deployment,
      };
      return { owner, application, document, grant, original, input };
    }
    function allocation(value: NativeMaterialIntent): NativeTaskAllocation {
      return {
        ...deployment,
        allocationId: value.allocationId,
        ownerUserId: value.ownerUserId,
        applicationId: value.applicationId,
        generationId: value.generationId,
        taskArn: `arn:aws:ecs:us-east-2:123456789012:task/synthetic-materials/${value.allocationId.replaceAll("-", "")}`,
      };
    }
    async function observe(bound: NativeTaskAllocation) {
      const [clock] = await sql<
        Array<{ at: string }>
      >`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS at`;
      const send = vi.fn(async () => ({
        tasks: [
          {
            taskArn: bound.taskArn,
            clusterArn: bound.clusterArn,
            taskDefinitionArn: bound.taskDefinitionArn,
            startedBy: bound.allocationId,
            lastStatus: "STOPPED",
            desiredStatus: "STOPPED",
            stoppedAt: new Date(Number(clock?.at)),
            containers: [
              { name: bound.containerName, taskArn: bound.taskArn, lastStatus: "STOPPED" },
            ],
          },
        ],
        failures: [],
      }));
      return createNativeTaskRetirement({
        allocation: bound,
        enabled: () => true,
        testClient: { send },
      }).retire(bound);
    }
    function disposal() {
      return createNativeMaterialDisposal({ registry, enabled: () => true, testRetire: observe });
    }

    it("records one original intent under concurrency before a task binding exists", async () => {
      const f = await fixture();
      const intents = await Promise.all(Array.from({ length: 5 }, () => registry.admit(f.input)));
      expect(new Set(intents.map((x) => x.allocationId)).size).toBe(1);
      expect(intents[0]).toMatchObject({
        state: "pending",
        allocation: null,
        generationId: f.document.id,
      });
      const [count] =
        await sql`SELECT count(*)::int AS count FROM documents.native_material_allocations WHERE user_id = ${f.owner}`;
      expect(count?.count).toBe(1);
    });

    it("retains unknown launch intent through sealing and accepts a late original task capture", async () => {
      const f = await fixture();
      const pending = await registry.admit(f.input);
      const retire = vi.fn(observe);
      const owner = createNativeMaterialDisposal({
        registry,
        enabled: () => true,
        testRetire: retire,
      });
      await expect(owner.discardApplication(f.owner, f.application)).rejects.toThrow(
        "NativeMaterialDisposalUnavailable",
      );
      expect(retire).not.toHaveBeenCalled();
      await expect(registry.admit(f.input)).rejects.toThrow("NativeMaterialRegistryUnavailable");
      await expect(
        sql`DELETE FROM documents.cover_letters WHERE id = ${f.document.id}`,
      ).rejects.toMatchObject({ code: "55000" });
      await registry.bindTask(allocation(pending));
      await expect(work.claim(f.original)).rejects.toThrow("CoverLetterWorkUnavailable");
      expect(await owner.discardApplication(f.owner, f.application)).toBe("discarded");
      expect(retire).toHaveBeenCalledOnce();
      expect(await owner.discardApplication(f.owner, f.application)).toBe("discarded");
      expect(retire).toHaveBeenCalledOnce();
    });

    it("permits only bound open native startup and retirement never settles its original provider work", async () => {
      const f = await fixture();
      const pending = await registry.admit(f.input);
      await expect(work.claim(f.original)).rejects.toThrow("CoverLetterWorkUnavailable");
      await registry.bindTask(allocation(pending));
      expect(await work.claim(f.original)).toMatchObject({ kind: "claimed" });
      expect(await disposal().discardApplication(f.owner, f.application)).toBe("discarded");
      const [grant] =
        await sql`SELECT state, terminal_at FROM documents.cover_letter_work_authorizations WHERE id = ${f.original.id}`;
      expect(grant).toMatchObject({ state: "running", terminal_at: null });
      await expect(
        sql`DELETE FROM documents.cover_letters WHERE id = ${f.document.id}`,
      ).rejects.toMatchObject({ code: "55000" });
    });

    it.each(["owner", "application", "generation", "work", "deployment"] as const)(
      "refuses changed %s on admission/capture",
      async (change) => {
        const f = await fixture();
        const pending = await registry.admit(f.input);
        if (change === "owner")
          await expect(registry.admit({ ...f.input, ownerUserId: uuidv7() })).rejects.toThrow(
            "NativeMaterialRegistryUnavailable",
          );
        if (change === "application")
          await expect(registry.admit({ ...f.input, applicationId: uuidv7() })).rejects.toThrow(
            "NativeMaterialRegistryUnavailable",
          );
        if (change === "generation")
          await expect(
            registry.bindTask({ ...allocation(pending), generationId: uuidv7() }),
          ).rejects.toThrow("NativeMaterialRegistryUnavailable");
        if (change === "work")
          await expect(
            registry.admit({ ...f.input, original: { ...f.original, id: uuidv7() } }),
          ).rejects.toThrow("NativeMaterialRegistryUnavailable");
        if (change === "deployment")
          await expect(
            registry.bindTask({
              ...allocation(pending),
              taskDefinitionArn: deployment.taskDefinitionArn.replace(":7", ":8"),
            }),
          ).rejects.toThrow("NativeMaterialRegistryUnavailable");
        const [row] =
          await sql`SELECT state, task_arn FROM documents.native_material_allocations WHERE id = ${pending.allocationId}`;
        expect(row).toMatchObject({ state: "pending", task_arn: null });
      },
    );

    it("serializes admission with owning cancellation and creates no intent after terminal commit", async () => {
      const f = await fixture();
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const cancellation = sql.begin(async (tx) => {
        await tx`UPDATE applications.applications SET status = 'cancelled', revision = revision + 1, updated_at = clock_timestamp() WHERE id = ${f.application}`;
        enter();
        await released;
      });
      await entered;
      const admission = registry.admit(f.input);
      const rejected = expect(admission).rejects.toThrow("NativeMaterialRegistryUnavailable");
      release();
      await cancellation;
      await rejected;
      const [row] =
        await sql`SELECT count(*)::int AS count FROM documents.native_material_admission WHERE user_id = ${f.owner}`;
      expect(row?.count).toBe(0);
    });

    it("holds the actual owning application row through admission commit", async () => {
      const f = await fixture();
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const controlled = new PostgresNativeMaterialRegistry(
        sql,
        () => true,
        async (owner, app, query) => {
          await lockNativeMaterialApplicationAdmission(owner, app, query);
          enter();
          await released;
        },
      );
      const admission = controlled.admit(f.input);
      await entered;
      let cancelled = false;
      const cancel =
        sql`UPDATE applications.applications SET status = 'cancelled', revision = revision + 1, updated_at = clock_timestamp() WHERE id = ${f.application}`.then(
          () => {
            cancelled = true;
          },
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(cancelled).toBe(false);
      release();
      const original = await admission;
      await cancel;
      expect(original.state).toBe("pending");
      await expect(registry.admit(f.input)).rejects.toThrow("NativeMaterialRegistryUnavailable");
    });

    it("requires explicit fresh epoch and a grant issued after sealing; old confirmations refuse new scope", async () => {
      const f = await fixture();
      const oldGrant = await fixture(f.owner, f.application, false);
      const original = await registry.admit(f.input);
      await registry.bindTask(allocation(original));
      expect(await disposal().discardApplication(f.owner, f.application)).toBe("discarded");
      await expect(
        registry.admit({ ...oldGrant.input, previousEpochId: original.epochId }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      const fresh = await fixture(f.owner, f.application, false);
      await expect(registry.admit(fresh.input)).rejects.toThrow(
        "NativeMaterialRegistryUnavailable",
      );
      const next = await registry.admit({ ...fresh.input, previousEpochId: original.epochId });
      expect(next.epochId).not.toBe(original.epochId);
      expect(
        await registry.confirmApplicationDisposed(f.owner, f.application, original.epochId),
      ).toBe(false);
      await expect(registry.admit(f.input)).rejects.toThrow("NativeMaterialRegistryUnavailable");
    });

    it("refuses fresh epoch while original launch outcome remains unknown", async () => {
      const f = await fixture();
      const original = await registry.admit(f.input);
      await registry.sealApplication(f.owner, f.application);
      const fresh = await fixture(f.owner, f.application, false);
      await expect(
        registry.admit({ ...fresh.input, previousEpochId: original.epochId }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      expect(
        await registry.confirmApplicationDisposed(f.owner, f.application, original.epochId),
      ).toBe(false);
    });

    it("replays the same fulfilled task capture without replacing its binding", async () => {
      const f = await fixture();
      const original = await registry.admit(f.input);
      const first = await registry.bindTask(allocation(original));
      expect(await registry.bindTask(allocation(original))).toEqual(first);
      expect(first.state).toBe("bound");
    });

    it("freezes exact task binding and first terminal evidence in SQL", async () => {
      const f = await fixture();
      const original = await registry.admit(f.input);
      const bound = allocation(original);
      await registry.bindTask(bound);
      await expect(
        registry.bindTask({
          ...bound,
          taskArn: bound.taskArn.replace(/.$/u, bound.taskArn.endsWith("f") ? "e" : "f"),
        }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      await registry.sealApplication(f.owner, f.application);
      const receipt = await observe(bound);
      await registry.recordRetirement(receipt);
      await registry.recordRetirement({
        ...receipt,
        observedAtEpochMs: receipt.observedAtEpochMs + 1,
      });
      await expect(
        registry.recordRetirement({ ...receipt, stoppedAtEpochMs: receipt.stoppedAtEpochMs - 1 }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      await expect(
        sql`UPDATE documents.native_material_allocations SET observed_at_ms = observed_at_ms + 1 WHERE id = ${original.allocationId}`,
      ).rejects.toMatchObject({ code: "55000" });
    });

    it("refuses direct fake retirement and saved-slot/saved-document transitions", async () => {
      const f = await fixture();
      const original = await registry.admit(f.input);
      await expect(
        sql`UPDATE documents.native_material_allocations SET state = 'retired' WHERE id = ${original.allocationId}`,
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        work.issue({
          ownerUserId: f.owner,
          documentId: f.document.id,
          purpose: "private_slots",
          requestSha256: f.original.requestSha256,
          consentExpiresAt: f.grant.consentExpiresAt,
        }),
      ).rejects.toThrow("CoverLetterWorkUnavailable");
      await expect(
        sql`UPDATE documents.cover_letters SET status = 'ready', object_version = 'synthetic', object_sha256 = ${"d".repeat(64)}, content_sha256 = ${"e".repeat(64)}, size_bytes = 1, prompt_version = 'synthetic' WHERE id = ${f.document.id}`,
      ).rejects.toMatchObject({ code: "55000" });
    });

    it("exports technical metadata without deployment/grant/body fields", async () => {
      const f = await fixture();
      const original = await registry.admit(f.input);
      await registry.bindTask(allocation(original));
      await disposal().discardApplication(f.owner, f.application);
      const [row] = await sql`SELECT documents.export_candidate_data(${f.owner}::uuid) AS data`;
      expect(row?.data.documents.nativeMaterialAllocations).toEqual([
        expect.objectContaining({
          id: original.allocationId,
          generationId: f.document.id,
          state: "retired",
        }),
      ]);
      const body = JSON.stringify(row?.data);
      for (const forbidden of [
        "arn:aws",
        "requestSha256",
        "clusterArn",
        "paragraphs",
        "taskDefinitionArn",
        "providerDispatch",
      ])
        expect(body).not.toContain(forbidden);
      const exported = row?.data.documents.nativeMaterialAllocations[0];
      expect(Object.keys(exported).sort()).toEqual([
        "applicationId",
        "boundAt",
        "createdAt",
        "epochId",
        "generationId",
        "id",
        "observedAtEpochMs",
        "state",
        "stoppedAtEpochMs",
      ]);
    });

    it("requires owning metadata capability and refuses inactive identity and revoked grants", async () => {
      const f = await fixture();
      await expect(
        new PostgresNativeMaterialRegistry(sql, () => true).admit(f.input),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      await work.revokeUnclaimed(f.owner, f.document.id);
      await expect(registry.admit(f.input)).rejects.toThrow("NativeMaterialRegistryUnavailable");
      const closed = await fixture();
      await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp() WHERE id = ${closed.owner}`;
      await expect(registry.admit(closed.input)).rejects.toThrow(
        "NativeMaterialRegistryUnavailable",
      );
    });

    it("refuses an expired original grant without recording launch intent", async () => {
      const f = await fixture();
      const documentId = uuidv7();
      await documents.reserve({
        id: documentId,
        ownerUserId: f.owner,
        applicationId: f.application,
        jobRevision: "a".repeat(64),
        confirmedFactsHash: "b".repeat(64),
      });
      const id = uuidv7();
      await sql`INSERT INTO documents.cover_letter_work_authorizations
        (id, document_id, user_id, purpose, request_sha256, consent_expires_at, issued_at, expires_at)
        VALUES (${id}, ${documentId}, ${f.owner}, 'provider_dispatch', ${f.original.requestSha256},
          clock_timestamp() + interval '15 minutes', clock_timestamp() - interval '2 minutes',
          clock_timestamp() - interval '1 minute')`;
      await expect(
        registry.admit({ ...f.input, original: { ...f.original, id, documentId } }),
      ).rejects.toThrow("NativeMaterialRegistryUnavailable");
      expect(
        await sql`SELECT id FROM documents.native_material_allocations WHERE user_id = ${f.owner}`,
      ).toHaveLength(0);
    });

    it("retains unknown tasks during authorized deletion and purges metadata only after positive retirement", async () => {
      const f = await fixture();
      const original = await registry.admit(f.input);
      const operation = uuidv7();
      const request = uuidv7();
      await sql`INSERT INTO platform.operations (id, user_id, kind, state)
        VALUES (${operation}, ${f.owner}, 'account_deletion', 'queued')`;
      await sql`INSERT INTO profile.account_deletion_requests
        (id, user_id, operation_id, policy_version, state, version, confirmed_at, backup_expires_at)
        VALUES (${request}, ${f.owner}, ${operation}, 'synthetic-native-registry-v1', 'quarantined', 2,
          clock_timestamp(), clock_timestamp() + interval '35 days')`;
      await sql`INSERT INTO privacy.account_deletion_ledger
        (request_id, subject_digest, policy_version, policy_sha256, state, owner_inventory,
          subprocessor_inventory, confirmed_at, backup_expires_at)
        VALUES (${request}, ${"1".repeat(64)}, 'synthetic-native-registry-v1', ${"2".repeat(64)},
          'quarantined', '{"documents":"pending"}'::jsonb, '{}'::jsonb,
          clock_timestamp(), clock_timestamp() + interval '35 days')`;
      await sql`UPDATE identity.users SET account_state = 'quarantined', quarantined_at = clock_timestamp()
        WHERE id = ${f.owner}`;
      await expect(
        sql`SELECT documents.delete_candidate_data(${f.owner}::uuid, ${request}::uuid, true)`,
      ).rejects.toMatchObject({ code: "55000" });
      await work.revokeUnclaimed(f.owner, f.document.id);
      await expect(
        sql`SELECT documents.delete_candidate_data(${f.owner}::uuid, ${request}::uuid, true)`,
      ).rejects.toMatchObject({ code: "55000" });
      await registry.bindTask(allocation(original));
      expect(await disposal().discardApplication(f.owner, f.application)).toBe("discarded");
      const [deleted] =
        await sql`SELECT documents.delete_candidate_data(${f.owner}::uuid, ${request}::uuid, true) AS data`;
      expect(deleted?.data.coverLettersDeleted).toBe(1);
      expect(
        await sql`SELECT id FROM documents.native_material_allocations WHERE user_id = ${f.owner}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT user_id FROM documents.native_material_admission WHERE user_id = ${f.owner}`,
      ).toHaveLength(0);
    });
  },
);
