import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NativeMaterialAdmissionQuery } from "./native-material-admission.js";
import { PostgresNativeMaterialWithdrawalStore } from "./native-material-withdrawal.js";
import {
  lockNativeResumePreparationAdmission,
  type NativeResumePreparationScope,
} from "./native-resume-admission.js";
import { PostgresNativeResumeRequestStore } from "./native-resume-request-store.js";

const requested = process.env.NATIVE_RESUME_ADMISSION_INTEGRATION === "1";
const url = process.env.NATIVE_RESUME_ADMISSION_TEST_DATABASE_URL;
if (requested) {
  const parsed = new URL(url ?? "postgres://invalid");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/native_resume_admission" ||
    parsed.search ||
    parsed.hash
  )
    throw Error("SyntheticResumeAdmissionDatabaseRejected");
}
describe.runIf(requested)(
  "native resume original Applications admission with real PostgreSQL",
  () => {
    const sql = postgres(url ?? "postgres://invalid", { max: 4, onnotice: () => undefined });
    let scope: NativeResumePreparationScope;
    beforeAll(async () => {
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:path|systemroot|windir|temp|tmp|pathext|comspec|userprofile)$/iu.test(key),
        ),
      );
      for (const path of ["../../profile/dist/src/migrate.js", "../dist/src/migrate.js"])
        for (let replay = 0; replay < 2; replay++)
          await promisify(execFile)(
            process.execPath,
            [fileURLToPath(new URL(path, import.meta.url))],
            { env: { ...inherited, DATABASE_URL: url } },
          );
    }, 60_000);
    beforeEach(async () => {
      scope = {
        ownerUserId: uuidv7(),
        applicationId: uuidv7(),
        canonicalJobId: uuidv7(),
        expectedRevision: 2,
        packetId: uuidv7(),
        packetHash: "a".repeat(64),
        jobRevision: "b".repeat(64),
      };
      await sql.begin(async (tx) => {
        await tx`INSERT INTO identity.users(id) VALUES (${scope.ownerUserId})`;
        await tx`INSERT INTO applications.applications(id,owner_user_id,canonical_job_id,status,revision,created_at,updated_at)
        VALUES (${scope.applicationId},${scope.ownerUserId},${scope.canonicalJobId},'review_required',1,clock_timestamp(),clock_timestamp())`;
        await tx`INSERT INTO applications.packets(id,application_id,owner_user_id,version,packet_hash,job_revision,fields,created_at)
        VALUES (${scope.packetId},${scope.applicationId},${scope.ownerUserId},1,${scope.packetHash},${scope.jobRevision},'[]'::jsonb,clock_timestamp())`;
        await tx`UPDATE applications.applications SET current_packet_id=${scope.packetId},revision=2 WHERE id=${scope.applicationId}`;
      });
    });
    afterAll(async () => {
      await sql.end();
    });
    const admit = (input = scope, enabled = () => true) =>
      sql.begin((tx) =>
        lockNativeResumePreparationAdmission(
          input,
          tx as unknown as NativeMaterialAdmissionQuery,
          enabled,
        ),
      );
    it("admits the exact active owner/current review packet and changes no product state", async () => {
      await admit();
      const [row] =
        await sql`SELECT status,revision::integer, current_packet_id FROM applications.applications WHERE id=${scope.applicationId}`;
      expect(row).toEqual({
        status: "review_required",
        revision: 2,
        current_packet_id: scope.packetId,
      });
      expect(
        await sql`SELECT id FROM applications.approvals WHERE application_id=${scope.applicationId}`,
      ).toHaveLength(0);
    });
    it("withdraws the original resume packet without mutating its application revision or status", async () => {
      await admit();
      await new PostgresNativeMaterialWithdrawalStore(sql, () => true).withdraw(
        scope.ownerUserId,
        uuidv7(),
      );
      await expect(admit()).rejects.toThrow("NativeResumeAdmissionUnavailable");
      const [row] =
        await sql`SELECT status,revision::integer FROM applications.applications WHERE id=${scope.applicationId}`;
      expect(row).toEqual({ status: "review_required", revision: 2 });
    });
    it("withholds a withdrawn resume from both pending discovery and direct delivery claim", async () => {
      const eventId = uuidv7();
      await sql`INSERT INTO applications.outbox
        (id,application_id,owner_user_id,application_revision,event_type,subject,payload,occurred_at,available_at,resume_packet_id)
        VALUES (${eventId},${scope.applicationId},${scope.ownerUserId},2,
          'application.resume-preparation.requested.v1',${`application/${scope.applicationId}`},
          ${sql.json({ applicationId: scope.applicationId, userId: scope.ownerUserId, revision: 2, status: "review_required" })},
          clock_timestamp(),clock_timestamp(),${scope.packetId})`;
      const requests = new PostgresNativeResumeRequestStore(sql, () => true);
      expect(await requests.pending()).toContain(eventId);
      await new PostgresNativeMaterialWithdrawalStore(sql, () => true).withdraw(
        scope.ownerUserId,
        uuidv7(),
      );
      expect(await requests.pending()).not.toContain(eventId);
      expect(
        await requests.claim(
          eventId,
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-durable:9",
        ),
      ).toBeNull();
      const [event] =
        await sql`SELECT status,attempt_count,resume_workflow_arn FROM applications.outbox WHERE id=${eventId}`;
      expect(event).toEqual({ status: "pending", attempt_count: 0, resume_workflow_arn: null });
    });
    it("refuses neighboring owner/job/packet/hash/revision without substituting current metadata", async () => {
      for (const input of [
        { ...scope, ownerUserId: uuidv7() },
        { ...scope, canonicalJobId: uuidv7() },
        { ...scope, packetId: uuidv7() },
        { ...scope, packetHash: "c".repeat(64) },
        { ...scope, jobRevision: "d".repeat(64) },
        { ...scope, expectedRevision: 3 },
      ])
        await expect(admit(input)).rejects.toThrow("NativeResumeAdmissionUnavailable");
    });
    it("holds both owning application and current packet locks until the caller transaction ends", async () => {
      await sql.begin(async (tx) => {
        await lockNativeResumePreparationAdmission(
          scope,
          tx as unknown as NativeMaterialAdmissionQuery,
          () => true,
        );
        await sql.begin(async (other) => {
          const [lock] =
            await other`SELECT pg_try_advisory_xact_lock(hashtextextended(${`native-material-withdrawal:${scope.ownerUserId}`},0)) AS acquired`;
          expect(lock?.acquired).toBe(false);
        });
        await expect(
          sql.begin(async (other) => {
            await other`SELECT id FROM applications.applications WHERE id=${scope.applicationId} FOR UPDATE NOWAIT`;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
        await expect(
          sql.begin(async (other) => {
            await other`SELECT id FROM applications.packets WHERE id=${scope.packetId} FOR UPDATE NOWAIT`;
          }),
        ).rejects.toMatchObject({ code: "55P03" });
      });
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM applications.applications WHERE id=${scope.applicationId} FOR UPDATE NOWAIT`;
        await tx`SELECT id FROM applications.packets WHERE id=${scope.packetId} FOR UPDATE NOWAIT`;
      });
    });
    it("refuses after the original application revision changes", async () => {
      await sql`UPDATE applications.applications SET revision=3 WHERE id=${scope.applicationId}`;
      await expect(admit()).rejects.toThrow("NativeResumeAdmissionUnavailable");
    });
    it("refuses approved, submitting, ambiguous and applied states", async () => {
      for (const status of ["approved", "submitting", "reconciliation_required", "applied"]) {
        await sql`UPDATE applications.applications SET status=${status},revision=revision+1 WHERE id=${scope.applicationId}`;
        scope.expectedRevision++;
        await expect(admit()).rejects.toThrow("NativeResumeAdmissionUnavailable");
      }
    });
    it("refuses cancelled state at the current revision", async () => {
      await sql`UPDATE applications.applications SET status='cancelled',revision=revision+1 WHERE id=${scope.applicationId}`;
      scope.expectedRevision++;
      await expect(admit()).rejects.toThrow("NativeResumeAdmissionUnavailable");
    });
    it("refuses quarantined identity and default-off or withdrawn admission", async () => {
      await expect(admit(scope, () => false)).rejects.toThrow();
      let checks = 0;
      await expect(admit(scope, () => ++checks < 3)).rejects.toThrow();
      await sql`UPDATE identity.users SET account_state='quarantined',quarantined_at=clock_timestamp() WHERE id=${scope.ownerUserId}`;
      await expect(admit()).rejects.toThrow("NativeResumeAdmissionUnavailable");
    });
  },
);
