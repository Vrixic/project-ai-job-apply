import type postgres from "postgres";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";
import type { TemporaryMaterialCompletionAuthority } from "./temporary-materials.js";

type Outcome = Awaited<ReturnType<TemporaryMaterialCompletionAuthority["claimOriginalCompletion"]>>;

/** Documents-owned scalar metadata only. No content, grant issue, writer settlement or recovery. */
export class PostgresTemporaryMaterialCompletionStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}

  async claimOriginalCompletion(
    original: CoverLetterWorkReference,
    material: TemporaryMaterialReference,
  ): Promise<Outcome> {
    try {
      if (
        !this.enabled() ||
        !validateProviderControlReference(original) ||
        !validateTemporaryMaterialReference(material) ||
        material.kind !== "cover_letter" ||
        material.generationId !== original.documentId
      )
        return "unavailable";
      const work = structuredClone(original);
      const ref = structuredClone(material);
      return await this.sql.begin(async (transaction) => {
        // Identity -> owning document -> original work: same order as fencing and settlement.
        await transaction`SELECT identity.require_active_candidate(${ref.ownerUserId}::uuid)`;
        const [document] = await transaction<
          Array<{
            applicationId: string;
            version: number;
            status: string;
            workId: string | null;
            contentSha256: string | null;
            completedAtMs: number | null;
            expiresAtMs: number | null;
            available: boolean;
          }>
        >`SELECT application_id AS "applicationId", version, status,
          material_work_id AS "workId", material_sha256 AS "contentSha256",
          material_completed_at_ms::double precision AS "completedAtMs",
          material_expires_at_ms::double precision AS "expiresAtMs",
          COALESCE(material_expires_at_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, false) AS available
          FROM documents.cover_letters WHERE id = ${work.documentId} AND user_id = ${ref.ownerUserId} FOR UPDATE`;
        if (
          !document ||
          document.applicationId !== ref.applicationId ||
          document.version !== ref.version ||
          document.status !== "pending" ||
          !this.enabled()
        )
          return "unavailable" as const;
        const [grant] = await transaction<Array<{ state: string; failure: string | null }>>`
          SELECT state, provider_failure AS failure FROM documents.cover_letter_work_authorizations
          WHERE id = ${work.id} AND document_id = ${work.documentId} AND user_id = ${ref.ownerUserId}
            AND purpose = 'provider_dispatch' AND request_sha256 = ${work.requestSha256} FOR UPDATE`;
        if (
          !grant ||
          !["running", "settled"].includes(grant.state) ||
          grant.failure !== null ||
          !this.enabled()
        )
          return "unavailable" as const;
        if (document.workId !== null)
          return document.available &&
            document.workId === work.id &&
            document.contentSha256 === ref.contentSha256 &&
            document.completedAtMs === ref.completedAtMs &&
            document.expiresAtMs === ref.expiresAtMs
            ? ("already_completed" as const)
            : ("unavailable" as const);
        await transaction`UPDATE documents.cover_letters SET material_work_id = ${work.id},
          material_sha256 = ${ref.contentSha256}, material_completed_at_ms = ${ref.completedAtMs},
          material_expires_at_ms = ${ref.expiresAtMs} WHERE id = ${work.documentId} AND user_id = ${ref.ownerUserId}`;
        if (!this.enabled()) throw Error();
        return "claimed" as const;
      });
    } catch {
      // Unknown/lost acknowledgement is never a new claim or a quiescence certificate.
      return "unavailable";
    }
  }
}
