import type postgres from "postgres";
import type { CoverLetterPreparationIdentity } from "./cover-letter-generation.js";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import { type NativeMaterialReady, validateNativeMaterialReady } from "./native-material-ready.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

/** Owner metadata only. Authentication/native admission belongs to the surrounding RPC.
 * A receipt is not process liveness, task death, new work authority or a content recovery port. */
export class PostgresNativeMaterialReadyStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
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
  /** Read only the original admitted receipt. No launch, renewal, content or liveness authority. */
  async read(input: CoverLetterPreparationIdentity): Promise<NativeMaterialReady | null> {
    try {
      if (!this.enabled()) return null;
      const fixed = structuredClone(input);
      return await this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${fixed.ownerUserId}::uuid)`;
        const [row] = await tx<
          Array<{
            version: number;
            hash: string;
            completed: string;
            expires: string;
            facts: string[];
            confidence: number;
          }>
        >`SELECT d.version, d.material_sha256 AS hash,
          d.material_completed_at_ms AS completed, d.material_expires_at_ms AS expires,
          d.material_source_fact_ids AS facts, d.material_confidence AS confidence
          FROM documents.cover_letters d
          JOIN documents.cover_letter_work_authorizations w ON w.id=d.material_work_id
            AND w.document_id=d.id AND w.user_id=d.user_id
          JOIN documents.native_material_allocations a ON a.document_id=d.id AND a.user_id=d.user_id
            AND a.application_id=d.application_id AND a.work_id=w.id AND a.request_sha256=w.request_sha256
          JOIN documents.native_material_admission h ON h.user_id=a.user_id
            AND h.application_id=a.application_id AND h.epoch_id=a.epoch_id
          WHERE d.id=${fixed.id} AND d.user_id=${fixed.ownerUserId} AND d.application_id=${fixed.applicationId}
            AND d.job_revision=${fixed.jobContextHash} AND d.confirmed_facts_hash=${fixed.confirmedFactsHash}
            AND d.status='pending' AND d.material_source_fact_ids IS NOT NULL
            AND w.purpose='provider_dispatch' AND w.state='settled' AND w.provider_failure IS NULL
            AND w.consent_expires_at=${fixed.expiresAt}
            AND a.state='bound' AND a.task_arn IS NOT NULL AND a.launch_claimed_at IS NOT NULL
            AND a.launch_configuration_sha256 IS NOT NULL AND h.sealed_at IS NULL
            AND d.material_expires_at_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint`;
        if (!row || !this.enabled()) return null;
        const ready: NativeMaterialReady = {
          schemaVersion: 1,
          material: {
            schemaVersion: 1,
            kind: "cover_letter",
            ownerUserId: fixed.ownerUserId,
            applicationId: fixed.applicationId,
            generationId: fixed.id,
            version: row.version,
            contentSha256: row.hash,
            completedAtMs: Number(row.completed),
            expiresAtMs: Number(row.expires),
          },
          sourceFactIds: row.facts,
          confidence: row.confidence,
        };
        if (!validateNativeMaterialReady(ready)) return null;
        const [fresh] = await tx<Array<{ available: boolean }>>`
          SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint < ${ready.material.expiresAtMs} AS available`;
        return fresh?.available && this.enabled() ? structuredClone(ready) : null;
      });
    } catch {
      throw Error("NativeMaterialReadyUnavailable");
    }
  }
  async publish(original: CoverLetterWorkReference, raw: NativeMaterialReady): Promise<boolean> {
    try {
      if (
        !this.enabled() ||
        !validateProviderControlReference(original) ||
        !validateNativeMaterialReady(raw) ||
        original.documentId !== raw.material.generationId
      )
        return false;
      const work = structuredClone(original),
        ready = structuredClone(raw),
        ref = ready.material;
      return await this.sql.begin(async (tx) => {
        await tx`SELECT identity.require_active_candidate(${ref.ownerUserId}::uuid)`;
        const [row] = await tx<Array<{ facts: string[] | null; confidence: number | null }>>`
          SELECT material_source_fact_ids AS facts, material_confidence AS confidence
          FROM documents.cover_letters WHERE id=${work.documentId} AND user_id=${ref.ownerUserId}
            AND application_id=${ref.applicationId} AND version=${ref.version} AND status='pending'
            AND material_work_id=${work.id} AND material_sha256=${ref.contentSha256}
            AND material_completed_at_ms=${ref.completedAtMs} AND material_expires_at_ms=${ref.expiresAtMs}
            AND material_expires_at_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint FOR UPDATE`;
        if (!row || !this.enabled()) return false;
        const [grant] = await tx`SELECT id FROM documents.cover_letter_work_authorizations
          WHERE id=${work.id} AND document_id=${work.documentId} AND user_id=${ref.ownerUserId}
            AND purpose='provider_dispatch' AND request_sha256=${work.requestSha256}
            AND state='settled' AND provider_failure IS NULL FOR UPDATE`;
        if (!grant || !this.enabled()) return false;
        const [fresh] = await tx<Array<{ available: boolean }>>`
          SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint < ${ref.expiresAtMs} AS available`;
        if (!fresh?.available || !this.enabled()) return false;
        if (row.facts !== null)
          return (
            row.confidence === ready.confidence &&
            JSON.stringify(row.facts) === JSON.stringify(ready.sourceFactIds)
          );
        await tx`UPDATE documents.cover_letters SET material_source_fact_ids=${tx.array([...ready.sourceFactIds])}::uuid[],
          material_confidence=${ready.confidence} WHERE id=${work.documentId} AND user_id=${ref.ownerUserId}`;
        if (!this.enabled()) throw Error();
        return true;
      });
    } catch {
      return false;
    }
  }
}
