import type postgres from "postgres";

/** The exact original a generated resume was made from, as the generation's ledger row fixed it. */
export interface GenerationBase {
  documentId: string;
  version: number;
  sha256: string;
}

/**
 * Owner-scoped lookup of a generation's base document. The generation, not the caller, decides which
 * document is meant: a caller supplies only the application and generation it holds a reference to.
 */
export interface GenerationBaseSource {
  findGenerationBase(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
  ): Promise<GenerationBase | null>;
}

export class PostgresGenerationBaseSource implements GenerationBaseSource {
  constructor(private readonly client: postgres.Sql) {}

  async findGenerationBase(
    ownerUserId: string,
    applicationId: string,
    generationId: string,
  ): Promise<GenerationBase | null> {
    const rows = await this.client<GenerationBase[]>`
      SELECT base_document_id AS "documentId", base_version AS "version", base_sha256 AS "sha256"
        FROM documents.native_resume_generations
       WHERE id = ${generationId}
         AND user_id = ${ownerUserId}
         AND application_id = ${applicationId}
       LIMIT 1`;
    return rows[0] ?? null;
  }
}
