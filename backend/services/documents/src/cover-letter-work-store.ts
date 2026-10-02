import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

export const coverLetterWorkPurposes = Object.freeze([
  "private_slots",
  "provider_dispatch",
  "final_document",
] as const);
export type CoverLetterWorkPurpose = (typeof coverLetterWorkPurposes)[number];
export interface CoverLetterWorkReference {
  id: string;
  documentId: string;
  purpose: CoverLetterWorkPurpose;
  requestSha256: string;
}
export interface CoverLetterWorkAuthorization extends CoverLetterWorkReference {
  ownerUserId: string;
  consentExpiresAt: Date;
  issuedAt: Date;
  expiresAt: Date;
  state: "issued" | "running" | "settled" | "revoked";
  startedAt: Date | null;
  terminalAt: Date | null;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const validBinding = (input: Omit<CoverLetterWorkReference, "id">) =>
  UUID.test(input.documentId) &&
  coverLetterWorkPurposes.includes(input.purpose) &&
  HASH.test(input.requestSha256);
const referenceMatches = (row: CoverLetterWorkAuthorization, ref: CoverLetterWorkReference) =>
  row.id === ref.id &&
  row.documentId === ref.documentId &&
  row.purpose === ref.purpose &&
  row.requestSha256 === ref.requestSha256;

async function find(
  sql: postgres.Sql | postgres.TransactionSql,
  documentId: string,
  purpose: CoverLetterWorkPurpose,
  lock = false,
): Promise<CoverLetterWorkAuthorization | null> {
  const rows = await sql<CoverLetterWorkAuthorization[]>`
    SELECT id, document_id AS "documentId", user_id AS "ownerUserId", purpose,
      request_sha256 AS "requestSha256", consent_expires_at AS "consentExpiresAt",
      issued_at AS "issuedAt", expires_at AS "expiresAt", state,
      started_at AS "startedAt", terminal_at AS "terminalAt"
    FROM documents.cover_letter_work_authorizations
    WHERE document_id = ${documentId} AND purpose = ${purpose}
    ${lock ? sql`FOR UPDATE` : sql``}
  `;
  return rows[0] ?? null;
}

/**
 * Private, default-off control-plane primitive, not a production quiescence authority.
 * Every effect must claim once BEFORE dispatch. A successful settlement may be recorded only by
 * a trusted actor that positively proved ALL its original effects stopped/acknowledged. A local
 * deadline, rejected/aborted SDK promise, pending result or expired grant is NEVER that proof.
 * Runtime/IAM enforcement and all private/provider writers must be composed before activation.
 */
export class PostgresCoverLetterWorkStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly enabled: () => boolean = () => false,
  ) {}

  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      if (!this.enabled()) throw Error();
      return await run();
    } catch {
      throw Error("CoverLetterWorkUnavailable");
    }
  }

  async issue(
    input: Omit<CoverLetterWorkReference, "id"> & {
      ownerUserId: string;
      consentExpiresAt: Date;
    },
  ): Promise<{ kind: "issued" | "already_issued"; authorization: CoverLetterWorkAuthorization }> {
    return this.guarded(async () => {
      const binding = structuredClone(input);
      if (
        !validBinding(binding) ||
        !UUID.test(binding.ownerUserId) ||
        !Number.isFinite(binding.consentExpiresAt.getTime())
      )
        throw Error();
      return this.client.begin(async (sql) => {
        await sql`SELECT identity.require_active_candidate(${binding.ownerUserId}::uuid)`;
        const owned = await sql`SELECT id FROM documents.cover_letters
          WHERE id = ${binding.documentId} AND user_id = ${binding.ownerUserId} FOR UPDATE`;
        if (!owned[0] || !this.enabled()) throw Error();
        const prior = await find(sql, binding.documentId, binding.purpose);
        if (prior) {
          if (
            prior.ownerUserId !== binding.ownerUserId ||
            prior.requestSha256 !== binding.requestSha256 ||
            prior.consentExpiresAt.getTime() !== binding.consentExpiresAt.getTime()
          )
            throw Error();
          return { kind: "already_issued" as const, authorization: prior };
        }
        // Server time defines one non-renewable <=90-second admission window. Replays do not
        // update timestamps, revive terminal work or issue a different authorization identity.
        const inserted = await sql`
          WITH timing AS (SELECT clock_timestamp() AS at)
          INSERT INTO documents.cover_letter_work_authorizations
            (id, document_id, user_id, purpose, request_sha256, consent_expires_at, issued_at, expires_at)
          SELECT ${uuidv7()}, ${binding.documentId}, ${binding.ownerUserId}, ${binding.purpose},
            ${binding.requestSha256}, ${binding.consentExpiresAt.toISOString()}::timestamptz, at,
            CASE WHEN ${binding.purpose} = 'final_document' THEN at + interval '90 seconds'
              ELSE least(at + interval '90 seconds', ${binding.consentExpiresAt.toISOString()}::timestamptz) END
          FROM timing ON CONFLICT (document_id, purpose) DO NOTHING RETURNING id
        `;
        const row = await find(sql, binding.documentId, binding.purpose);
        if (
          !row ||
          row.ownerUserId !== binding.ownerUserId ||
          row.requestSha256 !== binding.requestSha256 ||
          row.consentExpiresAt.getTime() !== binding.consentExpiresAt.getTime()
        )
          throw Error();
        return {
          kind: inserted[0] ? ("issued" as const) : ("already_issued" as const),
          authorization: row,
        };
      });
    });
  }

  /** Only `claimed` grants one effect. Duplicate/running/expired/revoked work grants nothing. */
  async claim(reference: CoverLetterWorkReference): Promise<{ kind: "claimed" | "unavailable" }> {
    return this.guarded(async () => {
      const ref = structuredClone(reference);
      if (!UUID.test(ref.id) || !validBinding(ref)) throw Error();
      return this.client.begin(async (sql) => {
        const prior = await find(sql, ref.documentId, ref.purpose);
        if (!prior || !referenceMatches(prior, ref)) throw Error();
        // Same Identity-first lock order as reservation/deletion; no direct Identity table read.
        await sql`SELECT identity.require_active_candidate(${prior.ownerUserId}::uuid)`;
        const row = await find(sql, ref.documentId, ref.purpose, true);
        if (!row || !referenceMatches(row, ref) || !this.enabled()) throw Error();
        const changed = await sql`
          WITH timing AS (SELECT clock_timestamp() AS at)
          UPDATE documents.cover_letter_work_authorizations SET state = 'running', started_at = at
          FROM timing WHERE id = ${ref.id} AND state = 'issued' AND at < expires_at RETURNING id
        `;
        return { kind: changed[0] ? ("claimed" as const) : ("unavailable" as const) };
      });
    });
  }

  /** Trusted positive settlement ONLY. No catch/finally/timeout-based automatic settlement. */
  async recordSettled(reference: CoverLetterWorkReference): Promise<void> {
    return this.guarded(async () => {
      const ref = structuredClone(reference);
      if (!UUID.test(ref.id) || !validBinding(ref)) throw Error();
      await this.client.begin(async (sql) => {
        const row = await find(sql, ref.documentId, ref.purpose, true);
        if (!row || !referenceMatches(row, ref) || !this.enabled()) throw Error();
        if (row.state === "settled") return;
        if (row.state !== "running") throw Error();
        // Permitted after quarantine/expiry: draining old work does not create new authority.
        await sql`UPDATE documents.cover_letter_work_authorizations
          SET state = 'settled', terminal_at = clock_timestamp() WHERE id = ${ref.id}`;
      });
    });
  }

  /** Cancels ONLY unclaimed authority, including during quarantine. Never revokes running work. */
  async revokeUnclaimed(ownerUserId: string, documentId: string): Promise<number> {
    return this.guarded(async () => {
      if (!UUID.test(ownerUserId) || !UUID.test(documentId)) throw Error();
      return this.client.begin(async (sql) => {
        const owned = await sql`SELECT id FROM documents.cover_letters
          WHERE user_id = ${ownerUserId} AND id = ${documentId} FOR UPDATE`;
        if (!this.enabled()) throw Error();
        if (!owned[0]) return 0;
        const known = await sql<
          Array<{
            purpose: CoverLetterWorkPurpose;
            requestSha256: string;
            consentExpiresAt: Date;
            issuedAt: Date;
            expiresAt: Date;
          }>
        >`
          SELECT purpose, request_sha256 AS "requestSha256", consent_expires_at AS "consentExpiresAt",
            issued_at AS "issuedAt", expires_at AS "expiresAt"
          FROM documents.cover_letter_work_authorizations
          WHERE user_id = ${ownerUserId} AND document_id = ${documentId} ORDER BY issued_at, id`;
        // Absence of the entire protocol remains untracked, never retroactively certified.
        const first = known[0];
        if (!first) return 0;
        let cancelled = 0;
        // Persist no-authority tombstones for phases not yet issued. This is a permanent
        // document-wide admission fence, including when quarantine preceded later phases.
        for (const purpose of coverLetterWorkPurposes) {
          if (known.some((row) => row.purpose === purpose)) continue;
          await sql`INSERT INTO documents.cover_letter_work_authorizations
            (id, document_id, user_id, purpose, request_sha256, consent_expires_at,
              issued_at, expires_at, state, terminal_at)
            VALUES (${uuidv7()}, ${documentId}, ${ownerUserId}, ${purpose}, ${first.requestSha256},
              ${first.consentExpiresAt.toISOString()}::timestamptz,
              ${first.issuedAt.toISOString()}::timestamptz, ${first.expiresAt.toISOString()}::timestamptz,
              'revoked', clock_timestamp())`;
          cancelled++;
        }
        const rows = await sql`UPDATE documents.cover_letter_work_authorizations
          SET state = 'revoked', terminal_at = clock_timestamp()
          WHERE user_id = ${ownerUserId} AND document_id = ${documentId} AND state = 'issued'
          RETURNING id`;
        return cancelled + rows.length;
      });
    });
  }

  /** Ledger-only state. Missing phases or expired/running authority remain pending/untracked. */
  async readDrainState(
    ownerUserId: string,
    documentId: string,
  ): Promise<"untracked" | "pending" | "settled"> {
    return this.guarded(async () => {
      if (!UUID.test(ownerUserId) || !UUID.test(documentId)) throw Error();
      const rows = await this.client<Array<{ purpose: CoverLetterWorkPurpose; state: string }>>`
        SELECT purpose, state FROM documents.cover_letter_work_authorizations
        WHERE user_id = ${ownerUserId} AND document_id = ${documentId}
      `;
      if (
        rows.length !== coverLetterWorkPurposes.length ||
        !coverLetterWorkPurposes.every((purpose) => rows.some((row) => row.purpose === purpose))
      )
        return "untracked";
      return rows.every((row) => row.state === "revoked" || row.state === "settled")
        ? "settled"
        : "pending";
    });
  }
}
