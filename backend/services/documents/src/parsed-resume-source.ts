import type postgres from "postgres";
import type { DocumentProcessingJob } from "./processor.js";

export interface ParsedResumeRecord {
  id: string;
  version: number;
  fileName: string;
  mediaType: DocumentProcessingJob["mediaType"];
  sizeBytes: number;
  sha256: string;
  sourceObjectKey: string;
  sourceObjectVersion: string | null;
  parserVersion: string;
  normalizedObjectKey: string;
  normalizedObjectVersion: string;
  normalizedSha256: string;
  pageCount: number;
  characterCount: number;
  createdAt: Date | string;
}

/** Owner-scoped lookup of a resume that finished parsing and is not under a security hold. */
export interface ParsedResumeSource {
  findParsedResume(ownerUserId: string, documentId?: string): Promise<ParsedResumeRecord | null>;
}

export class PostgresParsedResumeSource implements ParsedResumeSource {
  constructor(private readonly client: postgres.Sql) {}

  async findParsedResume(
    ownerUserId: string,
    documentId?: string,
  ): Promise<ParsedResumeRecord | null> {
    const rows = await this.client<ParsedResumeRecord[]>`
      SELECT id, version, file_name AS "fileName", media_type AS "mediaType",
             size_bytes AS "sizeBytes", sha256, source_object_key AS "sourceObjectKey",
             source_object_version AS "sourceObjectVersion", parser_version AS "parserVersion",
             normalized_object_key AS "normalizedObjectKey",
             normalized_object_version AS "normalizedObjectVersion",
             normalized_sha256 AS "normalizedSha256", page_count AS "pageCount",
             character_count AS "characterCount", created_at AS "createdAt"
        FROM documents.resume_documents
       WHERE user_id = ${ownerUserId}
         AND status = 'parsed'
         AND deleted_at IS NULL
         AND security_hold = false
         AND normalized_object_key IS NOT NULL
         AND normalized_object_version IS NOT NULL
         AND normalized_sha256 IS NOT NULL
         AND parser_version IS NOT NULL
         ${documentId ? this.client`AND id = ${documentId}` : this.client``}
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`;
    return rows[0] ?? null;
  }
}
