import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import {
  type NativeMaterialIntent,
  PostgresNativeMaterialRegistry,
} from "./native-material-registry.js";
import { PostgresNativeResumeGenerationStore } from "./native-resume-generation-store.js";
import type { NativeTaskRetirementReceipt } from "./native-task-allocation.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeApplicationDisposalUnavailable");

/** Both Documents-owned material kinds share one sealed application epoch. No generation,
 * body access, task discovery or inferred retirement. Caller must prove application ownership.
 */
export class PostgresNativeApplicationDisposalStore {
  private readonly letters: PostgresNativeMaterialRegistry;
  private readonly resumes: PostgresNativeResumeGenerationStore;
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {
    this.letters = new PostgresNativeMaterialRegistry(sql, enabled);
    // This instance exposes retirement only; it cannot admit preparation or read candidate content.
    const refuse = async () => {
      throw unavailable();
    };
    this.resumes = new PostgresNativeResumeGenerationStore(
      sql,
      { application: refuse, job: refuse },
      enabled,
    );
  }
  private check(owner: string, application: string) {
    if (!this.enabled() || !uuid.test(owner) || !uuid.test(application)) throw unavailable();
  }
  /** Bounded outstanding inventory only; the Applications withdrawal barrier must commit first. */
  async pendingOwnerApplications(
    owner: string,
    throughMicros: string,
    limit = 5,
    afterApplicationId: string | null = null,
  ): Promise<string[]> {
    if (
      !this.enabled() ||
      !uuid.test(owner) ||
      !/^\d{16,17}$/u.test(throughMicros) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 5 ||
      (afterApplicationId !== null && !uuid.test(afterApplicationId))
    )
      throw unavailable();
    const rows = await this.sql<Array<{ application_id: string }>>`
      SELECT application_id FROM (
        SELECT application_id FROM documents.native_material_allocations
        WHERE user_id=${owner} AND state NOT IN ('retired','abandoned')
          AND (extract(epoch FROM created_at)*1000000)::bigint <= ${throughMicros}::bigint
        UNION
        SELECT application_id FROM documents.native_resume_generations
        WHERE user_id=${owner} AND state NOT IN ('retired','abandoned','launch_rejected')
          AND (extract(epoch FROM created_at)*1000000)::bigint <= ${throughMicros}::bigint
      ) pending WHERE (${afterApplicationId}::uuid IS NULL OR application_id > ${afterApplicationId}::uuid) ORDER BY application_id LIMIT ${limit}`;
    if (!this.enabled()) throw unavailable();
    return rows.map((row) => row.application_id);
  }
  async sealApplicationThrough(owner: string, application: string, throughMicros: string) {
    if (!/^\d{16,17}$/u.test(throughMicros)) throw unavailable();
    return this.seal(owner, application, throughMicros);
  }
  async sealApplication(
    owner: string,
    application: string,
  ): Promise<{ epochId: string; intents: NativeMaterialIntent[] }> {
    const plan = await this.seal(owner, application);
    if (!plan) throw unavailable();
    return plan;
  }
  private async seal(
    owner: string,
    application: string,
    throughMicros?: string,
  ): Promise<{ epochId: string; intents: NativeMaterialIntent[] } | null> {
    this.check(owner, application);
    try {
      return await this.sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`native-material:${owner}:${application}`},0))`;
        // Recheck under the same admission lock: a later explicit epoch must survive old logout replay.
        if (throughMicros !== undefined) {
          const [pending] = await tx`
            SELECT epoch_id FROM documents.native_material_allocations
            WHERE user_id=${owner} AND application_id=${application} AND state NOT IN ('retired','abandoned')
              AND (extract(epoch FROM created_at)*1000000)::bigint <= ${throughMicros}::bigint
            UNION ALL
            SELECT epoch_id FROM documents.native_resume_generations
            WHERE user_id=${owner} AND application_id=${application} AND state NOT IN ('retired','abandoned','launch_rejected')
              AND (extract(epoch FROM created_at)*1000000)::bigint <= ${throughMicros}::bigint`;
          if (!pending) return null;
        }
        // An application with no allocation still needs a durable seal against a delayed admission.
        await tx`WITH at AS (SELECT clock_timestamp() AS now)
          INSERT INTO documents.native_material_admission(user_id,application_id,epoch_id,sealed_at,minimum_work_issued_at,created_at)
          SELECT ${owner},${application},${uuidv7()},at.now,at.now,at.now FROM at
          ON CONFLICT(user_id,application_id) DO NOTHING`;
        const [head] = await tx<
          Array<{ epoch_id: string }>
        >`WITH at AS (SELECT clock_timestamp() AS now)
          UPDATE documents.native_material_admission SET sealed_at=COALESCE(sealed_at,at.now),minimum_work_issued_at=COALESCE(sealed_at,at.now)
          FROM at WHERE user_id=${owner} AND application_id=${application} RETURNING epoch_id`;
        if (!head) throw unavailable();
        // Only absence of the ORIGINAL launch claim proves no dispatch. Claimed/unknown tasks stay unresolved.
        await tx`UPDATE documents.native_material_allocations SET state='abandoned'
          WHERE user_id=${owner} AND application_id=${application} AND state='pending' AND launch_claimed_at IS NULL`;
        await tx`UPDATE documents.native_resume_generations SET state='abandoned'
          WHERE user_id=${owner} AND application_id=${application} AND state='pending' AND launch_claimed_at IS NULL`;
        const rows = await tx<
          Array<{
            allocation_id: string;
            generation_id: string;
            epoch_id: string;
            state: NativeMaterialIntent["state"];
            task_arn: string | null;
            cluster_arn: string;
            task_definition_arn: string;
            container_name: string;
          }>
        >`SELECT id AS allocation_id,document_id AS generation_id,epoch_id,state,task_arn,cluster_arn,task_definition_arn,container_name
          FROM documents.native_material_allocations WHERE user_id=${owner} AND application_id=${application} AND state NOT IN ('retired','abandoned')
          UNION ALL
          SELECT allocation_id,id AS generation_id,epoch_id,state,task_arn,cluster_arn,task_definition_arn,container_name
          FROM documents.native_resume_generations WHERE user_id=${owner} AND application_id=${application} AND state NOT IN ('retired','abandoned','launch_rejected')`;
        this.check(owner, application);
        return {
          epochId: head.epoch_id,
          intents: rows.map((row) => ({
            allocationId: row.allocation_id,
            generationId: row.generation_id,
            ownerUserId: owner,
            applicationId: application,
            epochId: row.epoch_id,
            state: row.state,
            allocation:
              row.task_arn === null
                ? null
                : {
                    allocationId: row.allocation_id,
                    generationId: row.generation_id,
                    ownerUserId: owner,
                    applicationId: application,
                    taskArn: row.task_arn,
                    clusterArn: row.cluster_arn,
                    taskDefinitionArn: row.task_definition_arn,
                    containerName: row.container_name,
                  },
          })),
        };
      });
    } catch {
      throw unavailable();
    }
  }
  async recordRetirement(receipt: NativeTaskRetirementReceipt): Promise<void> {
    this.check(receipt.ownerUserId, receipt.applicationId);
    const fixed = structuredClone(receipt);
    try {
      const rows = await this.sql<Array<{ kind: string }>>`
        SELECT 'cover_letter' AS kind FROM documents.native_material_allocations
          WHERE id=${fixed.allocationId} AND document_id=${fixed.generationId} AND user_id=${fixed.ownerUserId} AND application_id=${fixed.applicationId}
        UNION ALL
        SELECT 'tailored_resume' AS kind FROM documents.native_resume_generations
          WHERE allocation_id=${fixed.allocationId} AND id=${fixed.generationId} AND user_id=${fixed.ownerUserId} AND application_id=${fixed.applicationId}`;
      if (rows.length !== 1) throw unavailable();
      if (rows[0]?.kind === "cover_letter") await this.letters.recordRetirement(fixed);
      else if (rows[0]?.kind === "tailored_resume") await this.resumes.recordRetirement(fixed);
      else throw unavailable();
      this.check(fixed.ownerUserId, fixed.applicationId);
    } catch {
      throw unavailable();
    }
  }
  async confirmApplicationDisposed(
    owner: string,
    application: string,
    epochId: string,
  ): Promise<boolean> {
    this.check(owner, application);
    return this.letters.confirmApplicationDisposed(owner, application, epochId);
  }
}
