import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import {
  type NativeTaskAllocation,
  type NativeTaskRetirementReceipt,
  nativeTaskAllocationRegion,
  nativeTaskDeploymentRegion,
} from "./native-task-allocation.js";

export interface NativeMaterialIntent {
  allocationId: string;
  ownerUserId: string;
  applicationId: string;
  generationId: string;
  epochId: string;
  state: "pending" | "bound" | "retired";
  allocation: NativeTaskAllocation | null;
}
export type NativeRegistryAdmissionQuery = <Rows extends Record<string, unknown>[]>(
  parts: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Rows>;
export type NativeRegistryApplicationAdmission = (
  owner: string,
  application: string,
  query: NativeRegistryAdmissionQuery,
) => Promise<void>;

interface Row {
  id: string;
  user_id: string;
  application_id: string;
  document_id: string;
  epoch_id: string;
  work_id: string;
  request_sha256: string;
  cluster_arn: string;
  task_definition_arn: string;
  container_name: string;
  task_arn: string | null;
  state: NativeMaterialIntent["state"];
  stopped_at_ms: string | null;
  observed_at_ms: string | null;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const unavailable = () => Error("NativeMaterialRegistryUnavailable");
const validScope = (owner: string, app: string) => uuid.test(owner) && uuid.test(app);

function intent(row: Row): NativeMaterialIntent {
  const allocation =
    row.task_arn === null
      ? null
      : {
          allocationId: row.id,
          ownerUserId: row.user_id,
          applicationId: row.application_id,
          generationId: row.document_id,
          clusterArn: row.cluster_arn,
          taskArn: row.task_arn,
          taskDefinitionArn: row.task_definition_arn,
          containerName: row.container_name,
        };
  if (allocation) nativeTaskAllocationRegion(allocation);
  return Object.freeze({
    allocationId: row.id,
    ownerUserId: row.user_id,
    applicationId: row.application_id,
    generationId: row.document_id,
    epochId: row.epoch_id,
    state: row.state,
    allocation: allocation ? Object.freeze(allocation) : null,
  });
}

/** Documents-owned launch ledger. Pending launch intent is durable BEFORE RunTask; an unknown
 * launch ACK cannot become absence. This store has no RunTask, model, body or settlement port.
 * Private authenticated launcher/observer composition and IAM are still required before use. */
export class PostgresNativeMaterialRegistry {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
    private readonly applicationAdmission?: NativeRegistryApplicationAdmission,
  ) {}

  private check() {
    if (!this.enabled()) throw unavailable();
  }
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      this.check();
      return await run();
    } catch {
      throw unavailable();
    }
  }
  private async lock(tx: postgres.TransactionSql, owner: string, app: string) {
    // All admission/seal/bind/receipt operations share this exact lock; never hold it over AWS.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`native-material:${owner}:${app}`}, 0))`;
    this.check();
  }

  async admit(input: {
    ownerUserId: string;
    applicationId: string;
    original: CoverLetterWorkReference;
    previousEpochId: string | null;
    deployment: Pick<NativeTaskAllocation, "clusterArn" | "taskDefinitionArn" | "containerName">;
  }): Promise<NativeMaterialIntent> {
    return this.guarded(async () => {
      if (!this.applicationAdmission) throw unavailable();
      if (
        Object.keys(input).some(
          (key) =>
            !["ownerUserId", "applicationId", "original", "previousEpochId", "deployment"].includes(
              key,
            ),
        ) ||
        Object.keys(input.original).some(
          (key) => !["id", "documentId", "purpose", "requestSha256"].includes(key),
        ) ||
        Object.keys(input.deployment).some(
          (key) => !["clusterArn", "taskDefinitionArn", "containerName"].includes(key),
        )
      )
        throw unavailable();
      const fixed = structuredClone(input);
      if (
        !validScope(fixed.ownerUserId, fixed.applicationId) ||
        !uuid.test(fixed.original.documentId) ||
        !uuid.test(fixed.original.id) ||
        fixed.original.purpose !== "provider_dispatch" ||
        !/^[a-f0-9]{64}$/u.test(fixed.original.requestSha256) ||
        (fixed.previousEpochId !== null && !uuid.test(fixed.previousEpochId))
      )
        throw unavailable();
      return this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${fixed.ownerUserId}::uuid)`;
        await this.applicationAdmission?.(
          fixed.ownerUserId,
          fixed.applicationId,
          async <Rows extends Record<string, unknown>[]>(
            parts: TemplateStringsArray,
            ...values: unknown[]
          ) => await tx<Rows>(parts, ...(values as postgres.ParameterOrFragment<never>[])),
        );
        this.check();
        await this.lock(tx, fixed.ownerUserId, fixed.applicationId);
        const [head] = await tx<Array<{ epoch_id: string; sealed_at: Date | null }>>`
          SELECT epoch_id, sealed_at FROM documents.native_material_admission
          WHERE user_id = ${fixed.ownerUserId} AND application_id = ${fixed.applicationId} FOR UPDATE`;
        const [existing] = await tx<Row[]>`SELECT * FROM documents.native_material_allocations
          WHERE document_id = ${fixed.original.documentId} AND user_id = ${fixed.ownerUserId}`;
        if (existing) {
          if (
            !head ||
            head.sealed_at ||
            head.epoch_id !== existing.epoch_id ||
            existing.state === "retired" ||
            existing.application_id !== fixed.applicationId ||
            existing.work_id !== fixed.original.id ||
            existing.request_sha256 !== fixed.original.requestSha256 ||
            existing.cluster_arn !== fixed.deployment.clusterArn ||
            existing.task_definition_arn !== fixed.deployment.taskDefinitionArn ||
            existing.container_name !== fixed.deployment.containerName
          )
            throw unavailable();
          if (existing.state === "pending") {
            const [fresh] = await tx<
              Array<{ id: string }>
            >`SELECT w.id FROM documents.cover_letter_work_authorizations w
              JOIN documents.cover_letters d ON d.id = w.document_id AND d.user_id = w.user_id
              WHERE w.id = ${existing.work_id} AND w.state = 'issued' AND w.document_id = ${existing.document_id}
                AND w.request_sha256 = ${existing.request_sha256} AND w.user_id = ${existing.user_id}
                AND d.status = 'pending' AND d.material_work_id IS NULL
                AND clock_timestamp() < w.expires_at AND clock_timestamp() < w.consent_expires_at FOR UPDATE OF d, w`;
            if (!fresh) throw unavailable();
          }
          this.check();
          return intent(existing);
        }
        const [grant] = await tx<Array<{ fresh: boolean }>>`SELECT
          (h.minimum_work_issued_at IS NULL OR w.issued_at > h.minimum_work_issued_at) AS fresh
          FROM documents.cover_letters d JOIN documents.cover_letter_work_authorizations w ON w.document_id = d.id
          LEFT JOIN documents.native_material_admission h ON h.user_id = d.user_id AND h.application_id = d.application_id
          WHERE d.id = ${fixed.original.documentId} AND d.user_id = ${fixed.ownerUserId}
            AND d.application_id = ${fixed.applicationId} AND d.status = 'pending' AND d.material_work_id IS NULL
            AND w.id = ${fixed.original.id} AND w.user_id = d.user_id AND w.purpose = 'provider_dispatch'
            AND w.request_sha256 = ${fixed.original.requestSha256} AND w.state = 'issued'
            AND clock_timestamp() < w.expires_at AND clock_timestamp() < w.consent_expires_at
            AND NOT EXISTS (SELECT 1 FROM documents.cover_letter_work_authorizations old
              WHERE old.document_id = d.id AND old.purpose IN ('private_slots', 'final_document'))
          FOR UPDATE OF d, w`;
        if (!grant?.fresh) throw unavailable();
        const epoch = uuidv7();
        if (head) {
          if (!head.sealed_at || fixed.previousEpochId !== head.epoch_id) throw unavailable();
          await tx`UPDATE documents.native_material_admission SET epoch_id = ${epoch}, sealed_at = NULL
            WHERE user_id = ${fixed.ownerUserId} AND application_id = ${fixed.applicationId}`;
        } else {
          if (fixed.previousEpochId !== null) throw unavailable();
          await tx`INSERT INTO documents.native_material_admission (user_id, application_id, epoch_id)
            VALUES (${fixed.ownerUserId}, ${fixed.applicationId}, ${epoch})`;
        }
        const id = uuidv7();
        nativeTaskDeploymentRegion(fixed.deployment);
        const [row] = await tx<Row[]>`INSERT INTO documents.native_material_allocations
          (id, user_id, application_id, epoch_id, document_id, work_id, request_sha256,
            cluster_arn, task_definition_arn, container_name)
          VALUES (${id}, ${fixed.ownerUserId}, ${fixed.applicationId}, ${epoch}, ${fixed.original.documentId},
            ${fixed.original.id}, ${fixed.original.requestSha256}, ${fixed.deployment.clusterArn},
            ${fixed.deployment.taskDefinitionArn}, ${fixed.deployment.containerName}) RETURNING *`;
        this.check();
        if (!row) throw unavailable();
        return intent(row);
      });
    });
  }

  /** Capture ONLY an actually fulfilled exact launch result. Allowed after seal, so a late
   * original ACK cannot orphan a task. A missing ACK remains pending, never retired/abandoned. */
  async bindTask(allocation: NativeTaskAllocation): Promise<NativeMaterialIntent> {
    return this.guarded(async () => {
      const fixed = structuredClone(allocation);
      nativeTaskAllocationRegion(fixed);
      return this.sql.begin(async (tx) => {
        await this.lock(tx, fixed.ownerUserId, fixed.applicationId);
        const [row] = await tx<Row[]>`SELECT * FROM documents.native_material_allocations
          WHERE id = ${fixed.allocationId} AND user_id = ${fixed.ownerUserId}
            AND application_id = ${fixed.applicationId} FOR UPDATE`;
        if (
          !row ||
          row.document_id !== fixed.generationId ||
          row.cluster_arn !== fixed.clusterArn ||
          row.task_definition_arn !== fixed.taskDefinitionArn ||
          row.container_name !== fixed.containerName ||
          (row.task_arn !== null && row.task_arn !== fixed.taskArn)
        )
          throw unavailable();
        if (row.state === "pending") {
          const [bound] = await tx<
            Row[]
          >`UPDATE documents.native_material_allocations SET task_arn = ${fixed.taskArn},
            state = 'bound', bound_at = clock_timestamp() WHERE id = ${row.id} RETURNING *`;
          if (!bound) throw unavailable();
          this.check();
          return intent(bound);
        }
        this.check();
        return intent(row);
      });
    });
  }

  async sealApplication(
    owner: string,
    app: string,
  ): Promise<{ epochId: string; intents: NativeMaterialIntent[] }> {
    return this.guarded(async () => {
      if (!validScope(owner, app)) throw unavailable();
      return this.sql.begin(async (tx) => {
        await this.lock(tx, owner, app);
        const [head] = await tx<
          Array<{ epoch_id: string }>
        >`WITH at AS (SELECT clock_timestamp() AS now)
          UPDATE documents.native_material_admission SET sealed_at = COALESCE(sealed_at, at.now),
            minimum_work_issued_at = COALESCE(sealed_at, at.now) FROM at
          WHERE user_id = ${owner} AND application_id = ${app} RETURNING epoch_id`;
        if (!head) throw unavailable();
        const rows = await tx<Row[]>`SELECT * FROM documents.native_material_allocations
          WHERE user_id = ${owner} AND application_id = ${app} AND state <> 'retired' ORDER BY id`;
        this.check();
        return { epochId: head.epoch_id, intents: rows.map(intent) };
      });
    });
  }

  async recordRetirement(receipt: NativeTaskRetirementReceipt): Promise<void> {
    return this.guarded(async () => {
      const keys = [
        "schemaVersion",
        "kind",
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "clusterArn",
        "taskArn",
        "taskDefinitionArn",
        "stoppedAtEpochMs",
        "observedAtEpochMs",
      ];
      if (
        Object.keys(receipt).length !== keys.length ||
        Object.keys(receipt).some((key) => !keys.includes(key))
      )
        throw unavailable();
      const fixed = structuredClone(receipt);
      if (
        fixed.schemaVersion !== 1 ||
        fixed.kind !== "native_task_stopped" ||
        !validScope(fixed.ownerUserId, fixed.applicationId) ||
        !uuid.test(fixed.allocationId) ||
        !uuid.test(fixed.generationId) ||
        !Number.isSafeInteger(fixed.stoppedAtEpochMs) ||
        !Number.isSafeInteger(fixed.observedAtEpochMs) ||
        fixed.stoppedAtEpochMs <= 0 ||
        fixed.observedAtEpochMs < fixed.stoppedAtEpochMs
      )
        throw unavailable();
      await this.sql.begin(async (tx) => {
        await this.lock(tx, fixed.ownerUserId, fixed.applicationId);
        const [row] = await tx<Row[]>`SELECT * FROM documents.native_material_allocations
          WHERE id = ${fixed.allocationId} AND user_id = ${fixed.ownerUserId} AND application_id = ${fixed.applicationId} FOR UPDATE`;
        if (
          !row ||
          row.state === "pending" ||
          row.document_id !== fixed.generationId ||
          row.task_arn !== fixed.taskArn ||
          row.cluster_arn !== fixed.clusterArn ||
          row.task_definition_arn !== fixed.taskDefinitionArn ||
          (row.state === "retired" && Number(row.stopped_at_ms) !== fixed.stoppedAtEpochMs)
        )
          throw unavailable();
        if (row.state === "bound")
          await tx`UPDATE documents.native_material_allocations SET state = 'retired',
          stopped_at_ms = ${fixed.stoppedAtEpochMs}, observed_at_ms = ${fixed.observedAtEpochMs}
          WHERE id = ${row.id} AND ${fixed.observedAtEpochMs} <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint`;
        const [stored] = await tx<
          Row[]
        >`SELECT * FROM documents.native_material_allocations WHERE id = ${row.id}`;
        if (stored?.state !== "retired") throw unavailable();
        this.check();
      });
    });
  }

  async confirmApplicationDisposed(owner: string, app: string, epochId: string): Promise<boolean> {
    return this.guarded(async () => {
      if (!validScope(owner, app) || !uuid.test(epochId)) throw unavailable();
      return this.sql.begin(async (tx) => {
        await this.lock(tx, owner, app);
        const [result] = await tx<
          Array<{ complete: boolean }>
        >`SELECT (sealed_at IS NOT NULL AND epoch_id = ${epochId}
          AND NOT EXISTS (SELECT 1 FROM documents.native_material_allocations a
            WHERE a.user_id = h.user_id AND a.application_id = h.application_id AND a.state <> 'retired')) AS complete
          FROM documents.native_material_admission h WHERE user_id = ${owner} AND application_id = ${app} FOR UPDATE`;
        this.check();
        return result?.complete === true;
      });
    });
  }
}
