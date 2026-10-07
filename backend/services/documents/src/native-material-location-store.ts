import type postgres from "postgres";
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
}
