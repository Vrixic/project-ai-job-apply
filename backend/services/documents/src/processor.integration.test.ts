import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgresResumeProposalWriter } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedResumeDocument } from "./parsing/index.js";
import { PostgresDocumentProcessorStore } from "./processor.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeWithDatabase("PostgresDocumentProcessorStore", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });
  const store = new PostgresDocumentProcessorStore(client, new PostgresResumeProposalWriter());

  beforeAll(async () => {
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../../profile/dist/src/migrate.js", import.meta.url))],
      { env: environment },
    );
    await execFileAsync(
      process.execPath,
      [fileURLToPath(new URL("../dist/src/migrate.js", import.meta.url))],
      { env: environment },
    );
  });

  afterAll(async () => client.end());

  it("imports one immutable proposal batch under at-least-once scan delivery", async () => {
    const userId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const sourceVersion = "synthetic-source-version";
    const sourceSha256 = "b".repeat(64);
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    try {
      await client`
        INSERT INTO documents.resume_documents (
          id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status
        ) VALUES (
          ${documentId}, ${userId}, 'synthetic.pdf', 'application/pdf', 1024, ${sourceSha256},
          ${`quarantine/${documentId}/source`}, 'awaiting_upload'
        )
      `;
      const scan = {
        schemaVersion: 1 as const,
        eventId: `event-${crypto.randomUUID()}`,
        accountId: "362544434697",
        region: "us-east-2" as const,
        protectionPlanArn:
          "arn:aws:guardduty:us-east-2:362544434697:malware-protection-plan/syntheticplan",
        bucketName: "synthetic-candidate-documents",
        objectKey: `quarantine/${documentId}/source`,
        objectVersion: sourceVersion,
        scanStatus: "COMPLETED" as const,
        scanResult: "NO_THREATS_FOUND" as const,
        observedAt: "2026-08-12T12:00:00.000Z",
      };
      const accepted = await store.acceptScan(scan);
      expect(accepted.kind).toBe("process");
      const replay = await store.acceptScan({ ...scan, eventId: `event-${crypto.randomUUID()}` });
      expect(replay.kind).toBe("process");
      if (accepted.kind !== "process") throw new Error("expected process job");

      const normalized: NormalizedResumeDocument = {
        documentId,
        version: 1,
        parserVersion: "resume-parser-v1",
        mediaType: "application/pdf",
        sourceSha256,
        createdAt: accepted.job.createdAt,
        blocks: [
          {
            index: 0,
            text: "Skills: TypeScript, PostgreSQL",
            startOffset: 0,
            endOffset: 30,
            page: 1,
          },
        ],
      };
      const result = {
        ok: true as const,
        normalizedObjectKey: `normalized/${documentId}/${sourceSha256}/resume-parser-v1/resume.json`,
        normalizedObjectVersion: "normalized-version",
        normalizedSha256: "c".repeat(64),
        parserVersion: "resume-parser-v1",
        pageCount: 1,
        characterCount: 30,
      };
      await expect(store.completeParsed(accepted.job, result, normalized)).resolves.toBe(2);
      await expect(store.completeParsed(accepted.job, result, normalized)).resolves.toBe(2);

      const [counts] = await client<Array<{ facts: number; imports: number; evidence: number }>>`
        SELECT
          (SELECT count(*)::int FROM profile.profile_facts WHERE user_id = ${userId}) AS facts,
          (SELECT count(*)::int FROM profile.resume_fact_imports WHERE user_id = ${userId}) AS imports,
          (SELECT count(*)::int FROM profile.profile_fact_evidence AS evidence
            JOIN profile.profile_facts AS fact ON fact.id = evidence.fact_id
            WHERE fact.user_id = ${userId}) AS evidence
      `;
      expect(counts).toEqual({ facts: 2, imports: 1, evidence: 2 });
      const [document] = await client<Array<{ status: string; parserVersion: string }>>`
        SELECT status, parser_version AS "parserVersion"
        FROM documents.resume_documents WHERE id = ${documentId}
      `;
      expect(document).toEqual({ status: "parsed", parserVersion: "resume-parser-v1" });

      const [confirmedFact] = await client<Array<{ id: string }>>`
        SELECT id FROM profile.profile_facts WHERE user_id = ${userId} ORDER BY id LIMIT 1
      `;
      if (!confirmedFact) throw new Error("expected imported fact");
      await client.begin(async (transaction) => {
        await transaction`
          INSERT INTO profile.profile_fact_versions (
            fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
            source_type, source_reference
          )
          SELECT fact_id, 2, kind, fact_key, fact_value, 'confirmed', sensitivity,
            source_type, source_reference
          FROM profile.profile_fact_versions
          WHERE fact_id = ${confirmedFact.id} AND version = 1
        `;
        await transaction`
          INSERT INTO profile.profile_fact_evidence (
            fact_id, fact_version, ordinal, document_id, document_version, parser_version,
            block_index, start_offset, end_offset, page
          )
          SELECT fact_id, 2, ordinal, document_id, document_version, parser_version,
            block_index, start_offset, end_offset, page
          FROM profile.profile_fact_evidence
          WHERE fact_id = ${confirmedFact.id} AND fact_version = 1
        `;
      });
      await expect(
        store.acceptScan({
          ...scan,
          eventId: `event-${crypto.randomUUID()}`,
          scanResult: "THREATS_FOUND",
        }),
      ).resolves.toEqual({ kind: "security_contradiction" });
      const latest = await client<Array<{ verification: string; availabilityState: string }>>`
        SELECT version.verification, version.availability_state AS "availabilityState"
        FROM profile.profile_facts AS fact
        JOIN LATERAL (
          SELECT verification, availability_state FROM profile.profile_fact_versions
          WHERE fact_id = fact.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE fact.user_id = ${userId}
      `;
      expect(latest.map((fact) => fact.availabilityState)).toEqual(["invalidated", "invalidated"]);
      expect(latest.map((fact) => fact.verification).sort()).toEqual(["confirmed", "proposed"]);
      const [held] = await client<Array<{ status: string; securityHold: boolean }>>`
        SELECT status, security_hold AS "securityHold"
        FROM documents.resume_documents WHERE id = ${documentId}
      `;
      expect(held).toEqual({ status: "failed", securityHold: true });
    } finally {
      await client`DELETE FROM identity.users WHERE id = ${userId}`;
    }
  });

  it("terminalizes scan and parse states after their bounded processing windows", async () => {
    const userId = crypto.randomUUID();
    const scanDocumentId = crypto.randomUUID();
    const parseDocumentId = crypto.randomUUID();
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    try {
      await client`
        INSERT INTO documents.resume_documents (
          id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status,
          created_at, updated_at
        ) VALUES
          (
            ${scanDocumentId}, ${userId}, 'scan-timeout.pdf', 'application/pdf', 1024,
            ${"d".repeat(64)}, ${`quarantine/${scanDocumentId}/source`}, 'awaiting_upload',
            now() - interval '31 minutes', now() - interval '31 minutes'
          ),
          (
            ${parseDocumentId}, ${userId}, 'parse-timeout.pdf', 'application/pdf', 1024,
            ${"e".repeat(64)}, ${`quarantine/${parseDocumentId}/source`}, 'parsing',
            now() - interval '31 minutes', now() - interval '16 minutes'
          )
      `;
      await client`
        UPDATE documents.resume_documents
        SET processing_started_at = now() - interval '16 minutes',
          source_object_version = 'synthetic-version', scan_result = 'NO_THREATS_FOUND'
        WHERE id = ${parseDocumentId}
      `;

      await expect(store.failStuckDocuments()).resolves.toEqual({
        scanTimedOut: 1,
        parseTimedOut: 1,
      });
      await expect(store.failStuckDocuments()).resolves.toEqual({
        scanTimedOut: 0,
        parseTimedOut: 0,
      });
      const documents = await client<Array<{ id: string; status: string; failureCode: string }>>`
        SELECT id, status, failure_code AS "failureCode"
        FROM documents.resume_documents WHERE id IN (${scanDocumentId}, ${parseDocumentId})
        ORDER BY id
      `;
      expect(documents).toEqual(
        [
          { id: scanDocumentId, status: "failed", failureCode: "scan_failed" },
          { id: parseDocumentId, status: "failed", failureCode: "parse_failed" },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
      const [audit] = await client<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM documents.audit_events
        WHERE document_id IN (${scanDocumentId}, ${parseDocumentId})
          AND trace_id = 'document-processing-reconciler'
      `;
      expect(audit?.count).toBe(2);
    } finally {
      await client`DELETE FROM identity.users WHERE id = ${userId}`;
    }
  });
});
