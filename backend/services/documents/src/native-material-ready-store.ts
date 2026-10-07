import type postgres from "postgres";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import { type NativeMaterialReady, validateNativeMaterialReady } from "./native-material-ready.js";

/** Owner metadata only. Authentication/native admission belongs to the surrounding RPC.
 * A receipt is not process liveness, task death, new work authority or a content recovery port. */
export class PostgresNativeMaterialReadyStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}
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
