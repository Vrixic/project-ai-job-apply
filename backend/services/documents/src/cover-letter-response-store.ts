import {
  type OpenAiBackgroundResponseReference,
  type OpenAiResponseCleanup,
  validateOpenAiBackgroundResponseReference,
} from "@ai-job-apply/ai-sdk";
import type postgres from "postgres";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

export interface CoverLetterResponseInventory {
  reference: CoverLetterWorkReference;
  state: "reserved" | "acknowledged" | "disposed";
  response: OpenAiBackgroundResponseReference | null;
}
interface ResponseRow {
  workId: string;
  documentId: string;
  requestSha256: string;
  state: CoverLetterResponseInventory["state"];
  responseId: string | null;
  responseCreatedAt: string | null;
  terminalStatus: string | null;
}

/** Private original-actor/maintenance persistence only. No generation, renewal, settlement,
 * content or purge port. A reserved row with no response identity is unresolved indefinitely.
 * IAM and original-ACK provenance must be enforced before runtime composition.
 */
export class PostgresCoverLetterResponseStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}

  private async guarded<T>(raw: unknown, run: (ref: CoverLetterWorkReference) => Promise<T>) {
    try {
      if (!this.enabled() || !validateProviderControlReference(raw)) throw Error();
      return await run(structuredClone(raw));
    } catch {
      throw Error("CoverLetterResponseUnavailable");
    }
  }

  /** Only the committed first winner may continue its ORIGINAL dispatch. Replay grants nothing. */
  async reserve(
    reference: CoverLetterWorkReference,
  ): Promise<{ kind: "reserved" | "already_reserved" }> {
    return this.guarded(reference, async (ref) => {
      return this.client.begin(async (sql) => {
        const [original] = await sql<Array<{ ownerUserId: string }>>`
          SELECT user_id AS "ownerUserId" FROM documents.cover_letter_work_authorizations
          WHERE id = ${ref.id} AND document_id = ${ref.documentId}
            AND purpose = 'provider_dispatch' AND request_sha256 = ${ref.requestSha256}`;
        if (!original) throw Error();
        await sql`SELECT identity.require_active_candidate(${original.ownerUserId}::uuid)`;
        // Serialize on the same original grant used by ACK capture and phase settlement.
        await sql`SELECT id FROM documents.cover_letter_work_authorizations WHERE id = ${ref.id} FOR UPDATE`;
        const [prior] = await sql`
          SELECT work_id FROM documents.cover_letter_provider_responses WHERE work_id = ${ref.id}`;
        if (prior) return { kind: "already_reserved" as const };
        if (!this.enabled()) throw Error();
        await sql`INSERT INTO documents.cover_letter_provider_responses
          (work_id, document_id, user_id, request_sha256)
          VALUES (${ref.id}, ${ref.documentId}, ${original.ownerUserId}, ${ref.requestSha256})`;
        return { kind: "reserved" as const };
      });
    });
  }

  /** Original creation ACK only; never accept a candidate-supplied or redispatched identity. */
  async recordCreation(
    reference: CoverLetterWorkReference,
    response: OpenAiBackgroundResponseReference,
  ): Promise<void> {
    return this.guarded(reference, async (ref) => {
      if (!validateOpenAiBackgroundResponseReference(response)) throw Error();
      const original = structuredClone(response);
      await this.mutate(ref, async (sql, row) => {
        if (row.state !== "reserved") {
          if (
            row.responseId !== original.responseId ||
            Number(row.responseCreatedAt) !== original.createdAt
          )
            throw Error();
          return;
        }
        await sql`UPDATE documents.cover_letter_provider_responses
          SET state = 'acknowledged', response_id = ${original.responseId},
            response_created_at = ${original.createdAt}, acknowledged_at = clock_timestamp()
          WHERE work_id = ${ref.id}`;
      });
    });
  }

  /** Exact positively acknowledged cleanup only; this does NOT settle any private actor. */
  async recordDisposal(
    reference: CoverLetterWorkReference,
    cleanup: OpenAiResponseCleanup,
  ): Promise<void> {
    return this.guarded(reference, async (ref) => {
      if (!cleanup || typeof cleanup !== "object" || Array.isArray(cleanup)) throw Error();
      const descriptors = Object.getOwnPropertyDescriptors(cleanup);
      const keys = Reflect.ownKeys(cleanup);
      if (
        ![Object.prototype, null].includes(Object.getPrototypeOf(cleanup)) ||
        keys.length !== 3 ||
        !keys.every(
          (key) =>
            typeof key === "string" &&
            ["kind", "reference", "terminalStatus"].includes(key) &&
            descriptors[key]?.enumerable === true &&
            Object.hasOwn(descriptors[key] ?? {}, "value"),
        )
      )
        throw Error();
      if (
        cleanup.kind !== "response_deleted" ||
        !validateOpenAiBackgroundResponseReference(cleanup.reference) ||
        !["completed", "cancelled", "failed", "incomplete"].includes(cleanup.terminalStatus)
      )
        throw Error();
      const receipt = structuredClone(cleanup);
      await this.mutate(ref, async (sql, row) => {
        if (
          row.state === "reserved" ||
          row.responseId !== receipt.reference.responseId ||
          Number(row.responseCreatedAt) !== receipt.reference.createdAt
        )
          throw Error();
        if (row.state === "disposed") {
          if (row.terminalStatus !== receipt.terminalStatus) throw Error();
          return;
        }
        await sql`UPDATE documents.cover_letter_provider_responses
          SET state = 'disposed', disposed_at = clock_timestamp(), terminal_status = ${receipt.terminalStatus}
          WHERE work_id = ${ref.id}`;
      });
    });
  }

  private async rows(sql: postgres.Sql | postgres.TransactionSql, ref: CoverLetterWorkReference) {
    return sql<ResponseRow[]>`SELECT work_id AS "workId", document_id AS "documentId",
      request_sha256 AS "requestSha256", state, response_id AS "responseId",
      response_created_at::text AS "responseCreatedAt", terminal_status AS "terminalStatus"
      FROM documents.cover_letter_provider_responses
      WHERE work_id = ${ref.id} AND document_id = ${ref.documentId} AND request_sha256 = ${ref.requestSha256}`;
  }

  private async mutate(
    ref: CoverLetterWorkReference,
    run: (sql: postgres.TransactionSql, row: ResponseRow) => Promise<void>,
  ) {
    await this.client.begin(async (sql) => {
      const [original] = await sql`SELECT id FROM documents.cover_letter_work_authorizations
        WHERE id = ${ref.id} AND document_id = ${ref.documentId} AND purpose = 'provider_dispatch'
          AND request_sha256 = ${ref.requestSha256} AND state IN ('running', 'settled') FOR UPDATE`;
      if (!original || !this.enabled()) throw Error();
      const [row] = await this.rows(sql, ref);
      if (!row) throw Error();
      // Drain original work even after quarantine or expiry, without renewing dispatch authority.
      await run(sql, row);
    });
  }

  /** Exact original-reference maintenance read; absent identity never becomes completion evidence. */
  async read(reference: CoverLetterWorkReference): Promise<CoverLetterResponseInventory | null> {
    return this.guarded(reference, async (ref) => {
      const [row] = await this.rows(this.client, ref);
      if (!row) return null;
      const response =
        row.responseId === null
          ? null
          : {
              schemaVersion: 1 as const,
              responseId: row.responseId,
              createdAt: Number(row.responseCreatedAt),
            };
      if (response && !validateOpenAiBackgroundResponseReference(response)) throw Error();
      return { reference: ref, state: row.state, response };
    });
  }
}
