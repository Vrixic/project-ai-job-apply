import type postgres from "postgres";
import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

/** Read-only original allocation lookup. No publishing, provider work, rendering or content. */
export class PostgresNativeMaterialLocationStore {
  constructor(
    protected readonly sql: postgres.Sql,
    protected readonly enabled: () => boolean = () => false,
  ) {}
  /** Point-in-time endpoint discovery metadata for an already authorized packet reference.
   * The caller must authenticate ownership/current packet before this lookup. An allocation ID
   * grants no read, launch, renewal or liveness authority; native HTTPS rechecks admission. */
  async readAllocation(reference: TemporaryMaterialReference): Promise<string | null> {
    try {
      if (
        !this.enabled() ||
        !validateTemporaryMaterialReference(reference) ||
        reference.kind !== "cover_letter"
      )
        return null;
      const fixed = Object.freeze({ ...reference });
      return await this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${fixed.ownerUserId}::uuid)`;
        const [row] = await tx<Array<{ id: string }>>`
          SELECT a.id FROM documents.cover_letters d
          JOIN documents.cover_letter_work_authorizations w ON w.id=d.material_work_id
            AND w.document_id=d.id AND w.user_id=d.user_id
          JOIN documents.native_material_allocations a ON a.document_id=d.id AND a.user_id=d.user_id
            AND a.application_id=d.application_id AND a.work_id=w.id AND a.request_sha256=w.request_sha256
          JOIN documents.native_material_admission h ON h.user_id=a.user_id
            AND h.application_id=a.application_id AND h.epoch_id=a.epoch_id
          WHERE d.id=${fixed.generationId} AND d.user_id=${fixed.ownerUserId}
            AND d.application_id=${fixed.applicationId} AND d.version=${fixed.version}
            AND d.material_sha256=${fixed.contentSha256}
            AND d.material_completed_at_ms=${fixed.completedAtMs}
            AND d.material_expires_at_ms=${fixed.expiresAtMs}
            AND d.status='pending' AND d.material_source_fact_ids IS NOT NULL
            AND w.purpose='provider_dispatch' AND w.state='settled' AND w.provider_failure IS NULL
            AND a.state='bound' AND a.task_arn IS NOT NULL AND a.launch_claimed_at IS NOT NULL
            AND a.launch_configuration_sha256 IS NOT NULL AND h.sealed_at IS NULL
            AND d.material_expires_at_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint`;
        if (
          !row ||
          !this.enabled() ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(row.id)
        )
          return null;
        const [fresh] = await tx<Array<{ available: boolean }>>`
          SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint < ${fixed.expiresAtMs} AS available`;
        return fresh?.available && this.enabled() ? row.id : null;
      });
    } catch {
      throw Error("NativeMaterialReadyUnavailable");
    }
  }
  /** Scalar original binding for a current ready reference. No grant, claim or content read. */
  async readBinding(reference: TemporaryMaterialReference): Promise<NativeEvidenceBinding | null> {
    try {
      const fixed = structuredClone(reference);
      const allocationId = await this.readAllocation(fixed);
      if (!allocationId || !this.enabled()) return null;
      const [row] = await this.sql<
        Array<{
          epoch_id: string;
          work_id: string;
          request_sha256: string;
          cluster_arn: string;
          task_arn: string;
          task_definition_arn: string;
          container_name: string;
        }>
      >`SELECT epoch_id, work_id, request_sha256, cluster_arn, task_arn, task_definition_arn, container_name
        FROM documents.native_material_allocations WHERE id=${allocationId}
          AND user_id=${fixed.ownerUserId} AND application_id=${fixed.applicationId}
          AND document_id=${fixed.generationId} AND state='bound' AND task_arn IS NOT NULL`;
      if (!row || !this.enabled() || (await this.readAllocation(fixed)) !== allocationId)
        return null;
      return nativeEvidenceBinding({
        scope: {
          allocationId,
          ownerUserId: fixed.ownerUserId,
          applicationId: fixed.applicationId,
          generationId: fixed.generationId,
          epochId: row.epoch_id,
        },
        allocation: {
          allocationId,
          ownerUserId: fixed.ownerUserId,
          applicationId: fixed.applicationId,
          generationId: fixed.generationId,
          clusterArn: row.cluster_arn,
          taskArn: row.task_arn,
          taskDefinitionArn: row.task_definition_arn,
          containerName: row.container_name,
        },
        original: {
          id: row.work_id,
          documentId: fixed.generationId,
          purpose: "provider_dispatch",
          requestSha256: row.request_sha256,
        },
      });
    } catch {
      throw Error("NativeMaterialReadyUnavailable");
    }
  }
}
