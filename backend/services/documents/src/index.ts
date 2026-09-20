import { createHash } from "node:crypto";
import type {
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  ResumeDocument,
  ResumeDocumentCollection,
} from "@ai-job-apply/api-contracts";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type { ResumeUploadSigner } from "./upload-signer.js";

export * from "./resume-tailoring-contract.js";
export type {
  ResumeUploadGrantInput,
  ResumeUploadSigner,
  S3ResumeUploadSignerOptions,
} from "./upload-signer.js";
export { MAXIMUM_RESUME_BYTES, S3ResumeUploadSigner } from "./upload-signer.js";

export class DocumentIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used for a different resume upload");
    this.name = "DocumentIdempotencyConflictError";
  }
}

/**
 * The candidate's plan does not allow another stored resume (ADR-032). The limit comes from Billing through
 * {@link ResumeLimits}; this module only enforces it.
 */
export class ResumeDocumentLimitError extends Error {
  constructor(readonly limit?: number) {
    super("The candidate's plan does not allow another stored resume");
    this.name = "ResumeDocumentLimitError";
  }
}

/** A resume is still uploading, scanning, or parsing, so a new upload is refused whatever the plan. */
export class ResumeUploadInProgressError extends Error {
  constructor() {
    super("A resume is still being processed; upload another when it finishes");
    this.name = "ResumeUploadInProgressError";
  }
}

/**
 * How long an unfinished registration keeps its slot: the upload grant lifetime plus a scan margin. After that the
 * registration is abandoned and the next one marks it failed, instead of the candidate waiting for the 30 minutes
 * the processing reconciler allows. Keep in step with the web app's recoverable-upload window.
 */
export const RESUME_UPLOAD_HOLD_SECONDS = 15 * 60;

/** Plan limits, supplied by the composition root from Billing so Documents never imports Billing (ADR-032). */
export interface ResumeLimits {
  /** The most resumes this candidate may keep at once. Must reject, never guess, when it cannot be determined. */
  maxStoredResumes(userId: string): Promise<number>;
}

export class DocumentIntakeUnavailableError extends Error {
  constructor() {
    super("Resume intake is not configured");
    this.name = "DocumentIntakeUnavailableError";
  }
}

type ResumeUploadRegistrationStage =
  | "TRANSACTION_START"
  | "LOCK"
  | "IDEMPOTENCY_READ"
  | "SLOT_LOCK"
  | "SLOT_ABANDON"
  | "SLOT_READ"
  | "GRANT_SIGN"
  | "DOCUMENT_INSERT"
  | "IDEMPOTENCY_INSERT"
  | "AUDIT_INSERT"
  | "TRANSACTION_COMMIT";

export class ResumeUploadRegistrationError extends Error {
  readonly code: `DOCUMENT_${ResumeUploadRegistrationStage}`;

  constructor(stage: ResumeUploadRegistrationStage, cause: unknown) {
    super("Resume upload registration failed", { cause });
    this.name = "ResumeUploadRegistrationError";
    this.code = `DOCUMENT_${stage}`;
  }
}

export interface DocumentStore {
  listResumeDocuments(userId: string): Promise<ResumeDocumentCollection>;
  createResumeUpload(
    userId: string,
    input: CreateResumeUploadRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<CreateResumeUploadResponse>;
  close(): Promise<void>;
}

export class UnavailableDocumentStore implements DocumentStore {
  async listResumeDocuments(): Promise<ResumeDocumentCollection> {
    throw new DocumentIntakeUnavailableError();
  }

  async createResumeUpload(): Promise<CreateResumeUploadResponse> {
    throw new DocumentIntakeUnavailableError();
  }

  async close(): Promise<void> {}
}

interface ResumeDocumentRow {
  id: string;
  fileName: string;
  mediaType: ResumeDocument["mediaType"];
  sizeBytes: number;
  sha256: string;
  status: ResumeDocument["status"];
  failureCode: ResumeDocument["failureCode"] | null;
  pageCount: number | null;
  characterCount: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function timestampIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapDocument(row: ResumeDocumentRow): ResumeDocument {
  return {
    id: row.id,
    fileName: row.fileName,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    status: row.status,
    createdAt: timestampIso(row.createdAt),
    updatedAt: timestampIso(row.updatedAt),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    ...(row.pageCount ? { pageCount: row.pageCount } : {}),
    ...(row.characterCount ? { characterCount: row.characterCount } : {}),
  };
}

function requestHash(input: CreateResumeUploadRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([input.fileName, input.mediaType, input.sizeBytes, input.sha256]))
    .digest("hex");
}

function storedUploadResponse(
  response: CreateResumeUploadResponse | string,
): CreateResumeUploadResponse {
  return typeof response === "string"
    ? (JSON.parse(response) as CreateResumeUploadResponse)
    : response;
}

export class PostgresDocumentStore implements DocumentStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly signer: ResumeUploadSigner,
    private readonly limits: ResumeLimits,
  ) {}

  async listResumeDocuments(userId: string): Promise<ResumeDocumentCollection> {
    const rows = await this.client<ResumeDocumentRow[]>`
      SELECT
        id,
        file_name AS "fileName",
        media_type AS "mediaType",
        size_bytes AS "sizeBytes",
        sha256,
        status,
        failure_code AS "failureCode",
        page_count AS "pageCount",
        character_count AS "characterCount",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM documents.resume_documents
      WHERE user_id = ${userId}
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `;
    return { documents: rows.map(mapDocument) };
  }

  async createResumeUpload(
    userId: string,
    input: CreateResumeUploadRequest,
    idempotencyKey: string,
    traceId: string,
  ): Promise<CreateResumeUploadResponse> {
    const hash = requestHash(input);
    const scope = "documents.resume-upload.create.v1";
    // Resolved before the transaction so no lock is held while Billing is consulted; it rejects (503 upstream) rather
    // than guess when the plan cannot be evaluated.
    const maxStoredResumes = await this.limits.maxStoredResumes(userId);
    if (!Number.isSafeInteger(maxStoredResumes) || maxStoredResumes < 0) {
      throw new ResumeDocumentLimitError(0);
    }
    let stage: ResumeUploadRegistrationStage = "TRANSACTION_START";
    try {
      return await this.client.begin(async (transaction) => {
        stage = "LOCK";
        await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${idempotencyKey}`}))
      `;
        stage = "IDEMPOTENCY_READ";
        const prior = await transaction<
          Array<{ requestHash: string; response: CreateResumeUploadResponse | string }>
        >`
        SELECT request_hash AS "requestHash", response
        FROM documents.idempotency_keys
        WHERE user_id = ${userId} AND scope = ${scope} AND key = ${idempotencyKey}
      `;
        if (prior[0]) {
          if (prior[0].requestHash !== hash) {
            throw new DocumentIdempotencyConflictError();
          }
          stage = "TRANSACTION_COMMIT";
          return storedUploadResponse(prior[0].response);
        }

        // One writer per candidate decides the slot, so two concurrent uploads with different idempotency keys cannot
        // both pass the count below.
        stage = "SLOT_LOCK";
        await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`${userId}:documents.resume-slot`}))
      `;
        stage = "SLOT_ABANDON";
        const abandoned = await transaction<Array<{ id: string; version: number }>>`
        UPDATE documents.resume_documents
        SET status = 'failed', failure_code = 'scan_failed', processed_at = now(), updated_at = now()
        WHERE user_id = ${userId}
          AND status = 'awaiting_upload'
          AND created_at < now() - (${RESUME_UPLOAD_HOLD_SECONDS}::int * interval '1 second')
        RETURNING id, version
      `;
        for (const row of abandoned) {
          const failure = JSON.stringify({ version: row.version, failureCode: "scan_failed" });
          await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (
            ${uuidv7()}, ${userId}, 'resume.processing.failed', ${row.id}, ${traceId},
            ${failure}::text::jsonb
          )
        `;
        }
        stage = "SLOT_READ";
        const occupied = await transaction<Array<{ status: string; count: number }>>`
        SELECT status, count(*)::int AS count
        FROM documents.resume_documents
        WHERE user_id = ${userId}
          AND status IN ('awaiting_upload', 'scanning', 'parsing', 'parsed')
        GROUP BY status
      `;
        const inFlight = occupied
          .filter(({ status }) => status !== "parsed")
          .reduce((total, { count }) => total + count, 0);
        if (inFlight > 0) {
          throw new ResumeUploadInProgressError();
        }
        const stored = occupied.reduce((total, { count }) => total + count, 0);
        if (stored >= maxStoredResumes) {
          throw new ResumeDocumentLimitError(maxStoredResumes);
        }

        const documentId = uuidv7();
        const objectKey = `quarantine/${documentId}/source`;
        const createdAt = new Date();
        stage = "GRANT_SIGN";
        const upload = await this.signer.createGrant({
          documentId,
          objectKey,
          mediaType: input.mediaType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
        });
        const document: ResumeDocument = {
          id: documentId,
          fileName: input.fileName,
          mediaType: input.mediaType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          status: "awaiting_upload",
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        };
        const response: CreateResumeUploadResponse = { document, upload };

        stage = "DOCUMENT_INSERT";
        await transaction`
        INSERT INTO documents.resume_documents (
          id, user_id, file_name, media_type, size_bytes, sha256,
          source_object_key, status, created_at, updated_at
        ) VALUES (
          ${documentId}, ${userId}, ${input.fileName}, ${input.mediaType}, ${input.sizeBytes},
          ${input.sha256}, ${objectKey}, 'awaiting_upload',
          ${createdAt.toISOString()}::timestamptz, ${createdAt.toISOString()}::timestamptz
        )
      `;
        stage = "IDEMPOTENCY_INSERT";
        // JSON is bound as explicit text and cast in SQL, never through `transaction.json`. The Gateway hands this
        // store its shared client, which installs an identity JSON serializer (see createApplicationsDatabase), so
        // the driver wrapper fails there with ERR_INVALID_ARG_TYPE. `::text::jsonb` keeps the parameter a plain
        // string on every client and still stores structured JSONB (a bare `::jsonb` double-encodes on a plain client).
        const idempotencyResponse = JSON.stringify(response);
        await transaction`
        INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
        VALUES (${userId}, ${scope}, ${idempotencyKey}, ${hash}, ${idempotencyResponse}::text::jsonb)
      `;
        stage = "AUDIT_INSERT";
        const auditMetadata = JSON.stringify({ version: 1, sizeBytes: input.sizeBytes });
        await transaction`
        INSERT INTO documents.audit_events (
          id, user_id, action, document_id, trace_id, metadata
        ) VALUES (
          ${uuidv7()}, ${userId}, 'resume.upload.registered', ${documentId}, ${traceId},
          ${auditMetadata}::text::jsonb
        )
      `;
        stage = "TRANSACTION_COMMIT";
        return response;
      });
    } catch (error) {
      if (
        error instanceof DocumentIdempotencyConflictError ||
        error instanceof ResumeDocumentLimitError ||
        error instanceof ResumeUploadInProgressError ||
        error instanceof ResumeUploadRegistrationError
      ) {
        throw error;
      }
      throw new ResumeUploadRegistrationError(stage, error);
    }
  }

  async close(): Promise<void> {}
}
