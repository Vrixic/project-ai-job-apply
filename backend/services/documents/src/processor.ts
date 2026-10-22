import type { DocumentScanResultV1 } from "@ai-job-apply/event-contracts";
import type { PostgresResumeProposalWriter } from "@ai-job-apply/profile-service";
import type postgres from "postgres";
import type { DocumentParserResult, DocumentParserSuccess } from "./parser-lambda.js";
import type { NormalizedResumeDocument } from "./parsing/normalize.js";
import { extractResumeDrafts } from "./resume-drafts.js";

export interface DocumentProcessingJob {
  userId: string;
  documentId: string;
  documentVersion: number;
  sourceObjectKey: string;
  sourceObjectVersion: string;
  mediaType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  traceId: string;
}

export type ScanAcceptance =
  | { kind: "acknowledged" }
  | { kind: "security_contradiction" }
  | { kind: "process"; job: DocumentProcessingJob };

interface ProcessingRow {
  id: string;
  userId: string;
  version: number;
  mediaType: DocumentProcessingJob["mediaType"];
  sizeBytes: number;
  sha256: string;
  sourceObjectKey: string;
  sourceObjectVersion: string | null;
  status: "awaiting_upload" | "scanning" | "parsing" | "parsed" | "rejected" | "failed";
  securityHold: boolean;
  createdAt: Date | string;
}

interface DispositionRow {
  scanStatus: DocumentScanResultV1["scanStatus"];
  scanResult: DocumentScanResultV1["scanResult"];
}

interface ReceiptRow {
  documentId: string;
  sourceObjectVersion: string;
}

function terminalFailure(result: DocumentScanResultV1["scanResult"]): {
  status: "rejected" | "failed";
  failureCode: "malware_detected" | "scan_unsupported" | "scan_failed";
} | null {
  switch (result) {
    case "THREATS_FOUND":
      return { status: "rejected", failureCode: "malware_detected" };
    case "UNSUPPORTED":
      return { status: "rejected", failureCode: "scan_unsupported" };
    case "ACCESS_DENIED":
    case "FAILED":
      return { status: "failed", failureCode: "scan_failed" };
    case "NO_THREATS_FOUND":
      return null;
  }
}

export interface ResumeProposalWriter {
  importDrafts: PostgresResumeProposalWriter["importDrafts"];
  holdDocumentProposals: PostgresResumeProposalWriter["holdDocumentProposals"];
}

export class PostgresDocumentProcessorStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly proposalWriter: ResumeProposalWriter,
  ) {}

  async acceptScan(event: DocumentScanResultV1): Promise<ScanAcceptance> {
    return this.client.begin(async (transaction) => {
      const rows = await transaction<ProcessingRow[]>`
        SELECT id, user_id AS "userId", version, media_type AS "mediaType",
          size_bytes AS "sizeBytes", sha256, source_object_key AS "sourceObjectKey",
          source_object_version AS "sourceObjectVersion", status,
          security_hold AS "securityHold", created_at AS "createdAt"
        FROM documents.resume_documents
        WHERE source_object_key = ${event.objectKey}
        FOR UPDATE
      `;
      const document = rows[0];
      if (!document) throw new Error("DocumentScanTargetNotRegistered");

      const priorReceipts = await transaction<ReceiptRow[]>`
        SELECT document_id AS "documentId", source_object_version AS "sourceObjectVersion"
        FROM documents.processing_receipts WHERE event_id = ${event.eventId}
      `;
      await transaction`
        INSERT INTO documents.processing_receipts (
          event_id, document_id, source_object_version, scan_status, scan_result, observed_at
        ) VALUES (
          ${event.eventId}, ${document.id}, ${event.objectVersion}, ${event.scanStatus},
          ${event.scanResult}, ${event.observedAt}::timestamptz
        ) ON CONFLICT (event_id) DO NOTHING
      `;
      const dispositions = await transaction<DispositionRow[]>`
        SELECT scan_status AS "scanStatus", scan_result AS "scanResult"
        FROM documents.processing_dispositions
        WHERE document_id = ${document.id} AND source_object_version = ${event.objectVersion}
      `;
      const disposition = dispositions[0];
      const versionConflict =
        document.sourceObjectVersion !== null &&
        document.sourceObjectVersion !== event.objectVersion;
      const resultConflict =
        disposition !== undefined &&
        (disposition.scanStatus !== event.scanStatus ||
          disposition.scanResult !== event.scanResult);
      const eventIdentityConflict =
        priorReceipts[0] !== undefined &&
        (priorReceipts[0].documentId !== document.id ||
          priorReceipts[0].sourceObjectVersion !== event.objectVersion);
      if (versionConflict || resultConflict || eventIdentityConflict) {
        await this.proposalWriter.holdDocumentProposals(transaction, {
          userId: document.userId,
          documentId: document.id,
          traceId: event.eventId,
        });
        await transaction`
          UPDATE documents.resume_documents
          SET security_hold = true, status = 'failed', failure_code = 'scan_failed',
            processed_at = now(), updated_at = now()
          WHERE id = ${document.id}
        `;
        await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (
            gen_random_uuid(), ${document.userId}, 'resume.processing.contradiction',
            ${document.id}, ${event.eventId}, ${JSON.stringify({ version: document.version })}::jsonb
          )
        `;
        return { kind: "security_contradiction" };
      }
      if (!disposition) {
        await transaction`
          INSERT INTO documents.processing_dispositions (
            document_id, source_object_version, scan_status, scan_result, first_event_id
          ) VALUES (
            ${document.id}, ${event.objectVersion}, ${event.scanStatus}, ${event.scanResult},
            ${event.eventId}
          )
        `;
        await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (
            gen_random_uuid(), ${document.userId}, 'resume.scan.recorded', ${document.id},
            ${event.eventId},
            ${JSON.stringify({ version: document.version, scanResult: event.scanResult })}::jsonb
          )
        `;
      }

      if (document.securityHold || document.status === "parsed") {
        return { kind: "acknowledged" };
      }
      const terminal = terminalFailure(event.scanResult);
      if (terminal) {
        const auditAction =
          terminal.status === "failed" ? "resume.processing.failed" : "resume.processing.rejected";
        if (document.status !== "rejected" && document.status !== "failed") {
          await transaction`
            UPDATE documents.resume_documents
            SET source_object_version = COALESCE(source_object_version, ${event.objectVersion}),
              scan_result = ${event.scanResult}, status = ${terminal.status},
              failure_code = ${terminal.failureCode}, processed_at = now(), updated_at = now()
            WHERE id = ${document.id}
          `;
          await transaction`
            INSERT INTO documents.audit_events (
              id, user_id, action, document_id, trace_id, metadata
            ) VALUES (
              gen_random_uuid(), ${document.userId}, ${auditAction},
              ${document.id}, ${event.eventId},
              ${JSON.stringify({ version: document.version, failureCode: terminal.failureCode })}::jsonb
            )
          `;
        }
        return { kind: "acknowledged" };
      }
      if (event.scanStatus !== "COMPLETED") {
        throw new Error("CleanDocumentScanStatusInvalid");
      }
      if (document.status === "rejected" || document.status === "failed") {
        return { kind: "acknowledged" };
      }
      if (document.status === "awaiting_upload") {
        await transaction`
          UPDATE documents.resume_documents
          SET source_object_version = ${event.objectVersion}, scan_result = ${event.scanResult},
            status = 'scanning', processing_started_at = now(), updated_at = now()
          WHERE id = ${document.id}
        `;
      }
      if (document.status === "awaiting_upload" || document.status === "scanning") {
        await transaction`
          UPDATE documents.resume_documents
          SET status = 'parsing', updated_at = now()
          WHERE id = ${document.id}
        `;
        await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (
            gen_random_uuid(), ${document.userId}, 'resume.parse.started', ${document.id},
            ${event.eventId}, ${JSON.stringify({ version: document.version })}::jsonb
          )
        `;
      }
      return {
        kind: "process",
        job: {
          userId: document.userId,
          documentId: document.id,
          documentVersion: document.version,
          sourceObjectKey: document.sourceObjectKey,
          sourceObjectVersion: event.objectVersion,
          mediaType: document.mediaType,
          sizeBytes: document.sizeBytes,
          sha256: document.sha256,
          createdAt:
            document.createdAt instanceof Date
              ? document.createdAt.toISOString()
              : new Date(document.createdAt).toISOString(),
          traceId: event.eventId,
        },
      };
    });
  }

  async rejectAfterParse(
    job: DocumentProcessingJob,
    result: Exclude<DocumentParserResult, DocumentParserSuccess>,
  ): Promise<void> {
    await this.client.begin(async (transaction) => {
      const rows = await transaction<Array<{ status: string }>>`
        SELECT status FROM documents.resume_documents
        WHERE id = ${job.documentId} AND source_object_version = ${job.sourceObjectVersion}
        FOR UPDATE
      `;
      if (!rows[0] || rows[0].status === "rejected" || rows[0].status === "failed") return;
      if (rows[0].status !== "parsing") throw new Error("DocumentParseStateConflict");
      await transaction`
        UPDATE documents.resume_documents
        SET status = 'rejected', failure_code = ${result.failureCode}, processed_at = now(),
          updated_at = now()
        WHERE id = ${job.documentId}
      `;
      await transaction`
        INSERT INTO documents.audit_events (
          id, user_id, action, document_id, trace_id, metadata
        ) VALUES (
          gen_random_uuid(), ${job.userId}, 'resume.processing.rejected', ${job.documentId},
          ${job.traceId},
          ${JSON.stringify({ version: job.documentVersion, failureCode: result.failureCode })}::jsonb
        )
      `;
    });
  }

  async completeParsed(
    job: DocumentProcessingJob,
    result: DocumentParserSuccess,
    normalized: NormalizedResumeDocument,
  ): Promise<number> {
    if (
      normalized.documentId !== job.documentId ||
      normalized.version !== job.documentVersion ||
      normalized.parserVersion !== result.parserVersion ||
      normalized.sourceSha256 !== job.sha256 ||
      normalized.mediaType !== job.mediaType
    ) {
      throw new Error("NormalizedDocumentIdentityMismatch");
    }
    const drafts = extractResumeDrafts(normalized);
    return this.client.begin(async (transaction) => {
      const rows = await transaction<Array<{ status: string; securityHold: boolean }>>`
        SELECT status, security_hold AS "securityHold"
        FROM documents.resume_documents
        WHERE id = ${job.documentId} AND source_object_version = ${job.sourceObjectVersion}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new Error("DocumentParseTargetNotFound");
      if (current.securityHold) throw new Error("DocumentSecurityHold");
      if (current.status === "parsed") return drafts.length;
      if (current.status !== "parsing") throw new Error("DocumentParseStateConflict");
      const proposalCount = await this.proposalWriter.importDrafts(transaction, {
        userId: job.userId,
        documentId: job.documentId,
        documentVersion: job.documentVersion,
        parserVersion: result.parserVersion,
        traceId: job.traceId,
        drafts,
      });
      await transaction`
        UPDATE documents.resume_documents
        SET status = 'parsed', failure_code = NULL,
          normalized_object_key = ${result.normalizedObjectKey},
          normalized_object_version = ${result.normalizedObjectVersion},
          normalized_sha256 = ${result.normalizedSha256}, parser_version = ${result.parserVersion},
          page_count = ${result.pageCount}, character_count = ${result.characterCount},
          processed_at = now(), updated_at = now()
        WHERE id = ${job.documentId}
      `;
      await transaction`
        INSERT INTO documents.audit_events (
          id, user_id, action, document_id, trace_id, metadata
        ) VALUES (
          gen_random_uuid(), ${job.userId}, 'resume.parse.completed', ${job.documentId},
          ${job.traceId},
          ${JSON.stringify({
            version: job.documentVersion,
            parserVersion: result.parserVersion,
            pageCount: result.pageCount,
            characterCount: result.characterCount,
            proposalCount,
          })}::jsonb
        )
      `;
      return proposalCount;
    });
  }

  async failStuckDocuments(): Promise<{ scanTimedOut: number; parseTimedOut: number }> {
    return this.client.begin(async (transaction) => {
      const scanRows = await transaction<Array<{ id: string; userId: string; version: number }>>`
        UPDATE documents.resume_documents
        SET status = 'failed', failure_code = 'scan_failed', processed_at = now(), updated_at = now()
        WHERE status IN ('awaiting_upload', 'scanning')
          AND COALESCE(processing_started_at, created_at) < now() - interval '30 minutes'
        RETURNING id, user_id AS "userId", version
      `;
      for (const row of scanRows) {
        await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (
            gen_random_uuid(), ${row.userId}, 'resume.processing.failed', ${row.id},
            'document-processing-reconciler',
            ${JSON.stringify({ version: row.version, failureCode: "scan_failed" })}::jsonb
          )
        `;
      }

      const parseRows = await transaction<Array<{ id: string; userId: string; version: number }>>`
        UPDATE documents.resume_documents
        SET status = 'failed', failure_code = 'parse_failed', processed_at = now(), updated_at = now()
        WHERE status = 'parsing'
          AND processing_started_at < now() - interval '15 minutes'
        RETURNING id, user_id AS "userId", version
      `;
      for (const row of parseRows) {
        await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (
            gen_random_uuid(), ${row.userId}, 'resume.processing.failed', ${row.id},
            'document-processing-reconciler',
            ${JSON.stringify({ version: row.version, failureCode: "parse_failed" })}::jsonb
          )
        `;
      }
      return { scanTimedOut: scanRows.length, parseTimedOut: parseRows.length };
    });
  }
}
