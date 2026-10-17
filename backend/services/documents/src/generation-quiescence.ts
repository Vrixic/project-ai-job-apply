import postgres from "postgres";

/**
 * Candidate-rights proof that no original cover-letter writer or provider execution can still
 * create or alter generation state for a document (ADR-038 cleanup). It is a read-only Documents
 * owner facade: positive, writer-recorded evidence only. Elapsed time, local cancellation and
 * absent data never establish quiescence on their own.
 *
 * Evidence, from the original writers' own ledgers:
 *  - the owner is no longer an active candidate. The database refuses to start any `issued`
 *    work authorization or reserve any provider response for a non-active candidate, and refuses
 *    to claim work after its own expiry, so no new work can begin;
 *  - every work authorization is `issued` (unstartable now), `settled` or `revoked`, never
 *    `running` (a claimed original writer that has not settled);
 *  - every provider response reservation is `disposed` (remote copy disposal acknowledged).
 *
 * A missing cover-letter row means every dependent row was deleted, which the database only allows
 * once each work authorization is settled/revoked and each provider response is disposed, and no
 * new reservation can reference a missing document.
 */
export interface GenerationQuiescenceEvidence {
  /** `null` when the cover-letter row no longer exists. */
  readonly letter: { readonly ownerAccountState: string | null } | null;
  readonly workStates: readonly string[];
  readonly responseStates: readonly string[];
}

export function decideGenerationQuiescence(evidence: GenerationQuiescenceEvidence): boolean {
  // The owning row is gone; the database already required every dependent to be terminal/disposed.
  if (evidence.letter === null) {
    return evidence.workStates.length === 0 && evidence.responseStates.length === 0;
  }
  // Only a quarantined owner proves that no `issued` authorization can still be claimed.
  if (evidence.letter.ownerAccountState !== "quarantined") return false;
  const workTerminal = evidence.workStates.every(
    (state) => state === "issued" || state === "settled" || state === "revoked",
  );
  const responsesDisposed = evidence.responseStates.every((state) => state === "disposed");
  return workTerminal && responsesDisposed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface GenerationQuiescenceReader {
  read(documentId: string): Promise<GenerationQuiescenceEvidence>;
}

export class PostgresGenerationQuiescenceReader implements GenerationQuiescenceReader {
  constructor(private readonly sql: postgres.Sql) {}

  async read(documentId: string): Promise<GenerationQuiescenceEvidence> {
    // One consistent snapshot. Read-only: this facade cannot create, claim or settle work.
    return this.sql.begin("isolation level repeatable read read only", async (tx) => {
      const letters = await tx<{ ownerAccountState: string | null }[]>`
        SELECT candidate.account_state AS "ownerAccountState"
        FROM documents.cover_letters letter
        LEFT JOIN identity.users candidate ON candidate.id = letter.user_id
        WHERE letter.id = ${documentId}::uuid
      `;
      const work = await tx<{ state: string }[]>`
        SELECT state FROM documents.cover_letter_work_authorizations
        WHERE document_id = ${documentId}::uuid
      `;
      const responses = await tx<{ state: string }[]>`
        SELECT state FROM documents.cover_letter_provider_responses
        WHERE document_id = ${documentId}::uuid
      `;
      return {
        letter: letters[0] ? { ownerAccountState: letters[0].ownerAccountState } : null,
        workStates: work.map((row) => row.state),
        responseStates: responses.map((row) => row.state),
      };
    });
  }
}

/** Positive-evidence port. Any invalid input, abort or read failure is "not confirmed". */
export class GenerationQuiescenceProof {
  constructor(private readonly reader: GenerationQuiescenceReader) {}

  async confirm(documentId: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || typeof documentId !== "string" || !UUID.test(documentId)) return false;
    try {
      const evidence = await this.reader.read(documentId);
      return !signal.aborted && decideGenerationQuiescence(evidence);
    } catch {
      return false;
    }
  }
}

/** Production facade: one bounded read-only connection, no work ledger mutation surface. */
export function createNativeGenerationQuiescenceProof(url: string) {
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  return {
    proof: new GenerationQuiescenceProof(new PostgresGenerationQuiescenceReader(sql)),
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
