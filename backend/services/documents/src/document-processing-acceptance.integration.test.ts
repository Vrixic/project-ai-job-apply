import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeDocumentProcessingAcceptance } from "./document-processing-acceptance.js";
import { documentProcessingAcceptanceFixtureSetSha256 } from "./document-processing-acceptance-manifest.js";

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const execFileAsync = promisify(execFile);
const issuer = "https://acceptance.invalid/";

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`${description} is missing`);
  return value;
}

describeWithDatabase("document-processing acceptance SQL boundary", () => {
  const client = postgres(databaseUrl ?? "postgres://invalid", {
    max: 2,
    onnotice: () => undefined,
  });

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

  it.each(["identity-only", "one-upload"] as const)(
    "recovers an exact %s partial run",
    async (scenario) => {
      const runId = crypto.randomUUID();
      const compact = runId.replaceAll("-", "");
      const userId = crypto.randomUUID();
      const fixtureManifest = [
        {
          fixture: "clean-pdf" as const,
          fileName: `generated-${compact}-clean.pdf`,
          mediaType: "application/pdf" as const,
          sizeBytes: 101,
          sha256: "1".repeat(64),
        },
        {
          fixture: "clean-docx" as const,
          fileName: `generated-${compact}-clean.docx`,
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
          sizeBytes: 102,
          sha256: "2".repeat(64),
        },
        {
          fixture: "invalid-pdf" as const,
          fileName: `generated-${compact}-invalid.pdf`,
          mediaType: "application/pdf" as const,
          sizeBytes: 103,
          sha256: "3".repeat(64),
        },
        {
          fixture: "malware-test" as const,
          fileName: `generated-${compact}-malware-test.pdf`,
          mediaType: "application/pdf" as const,
          sizeBytes: 104,
          sha256: "4".repeat(64),
        },
      ];
      await client`INSERT INTO identity.users (id) VALUES (${userId})`;
      await client`
        INSERT INTO identity.external_identities (issuer, subject, user_id)
        VALUES ('https://acceptance.invalid/', ${`d1-document-processing-acceptance:${runId}`}, ${userId})
      `;
      await client`
        INSERT INTO platform.audit_events (
          id, user_id, action, resource_type, resource_id, trace_id, metadata
        ) VALUES (${crypto.randomUUID()}, ${userId}, 'identity.linked', 'user', ${userId},
          'acceptance', ${JSON.stringify({ issuer })}::jsonb)
      `;
      if (scenario === "one-upload") {
        const documentId = crypto.randomUUID();
        const fixture = required(fixtureManifest[0], "clean PDF manifest entry");
        await client`
          INSERT INTO documents.resume_documents (
            id, user_id, file_name, media_type, size_bytes, sha256, source_object_key, status
          ) VALUES (
            ${documentId}, ${userId}, ${fixture.fileName}, ${fixture.mediaType},
            ${fixture.sizeBytes}, ${fixture.sha256}, ${`quarantine/${documentId}/source`},
            'awaiting_upload'
          )
        `;
        await client`
          INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
          VALUES (${userId}, 'documents.resume-upload.create.v1',
            ${`acceptance-${documentId}`}, ${"a".repeat(64)},
            ${JSON.stringify({ document: { id: documentId } })}::jsonb)
        `;
        await client`
          INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id, metadata)
          VALUES (${crypto.randomUUID()}, ${userId}, 'resume.upload.registered',
            ${documentId}, 'acceptance', '{}'::jsonb)
        `;
      }
      const result = await executeDocumentProcessingAcceptance(client, {
        action: "cleanup",
        runId,
        issuer,
        fixtureManifest,
        fixtureSetSha256: documentProcessingAcceptanceFixtureSetSha256(fixtureManifest),
      });
      expect(result).toMatchObject({ documentCount: 0, persistentRows: 0 });
    },
  );

  it("does not resolve or clean a subject collision under another issuer", async () => {
    const runId = crypto.randomUUID();
    const compact = runId.replaceAll("-", "");
    const userId = crypto.randomUUID();
    const fixtureManifest = [
      {
        fixture: "clean-pdf" as const,
        fileName: `generated-${compact}-clean.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 101,
        sha256: "1".repeat(64),
      },
      {
        fixture: "clean-docx" as const,
        fileName: `generated-${compact}-clean.docx`,
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
        sizeBytes: 102,
        sha256: "2".repeat(64),
      },
      {
        fixture: "invalid-pdf" as const,
        fileName: `generated-${compact}-invalid.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 103,
        sha256: "3".repeat(64),
      },
      {
        fixture: "malware-test" as const,
        fileName: `generated-${compact}-malware-test.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 104,
        sha256: "4".repeat(64),
      },
    ];
    await client`INSERT INTO identity.users (id) VALUES (${userId})`;
    try {
      await client`
        INSERT INTO identity.external_identities (issuer, subject, user_id)
        VALUES ('https://wrong-issuer.invalid/',
          ${`d1-document-processing-acceptance:${runId}`}, ${userId})
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, {
          action: "cleanup",
          runId,
          issuer,
          fixtureManifest,
          fixtureSetSha256: documentProcessingAcceptanceFixtureSetSha256(fixtureManifest),
        }),
      ).rejects.toThrow("colliding persisted boundary");
      await expect(
        client`SELECT id FROM identity.users WHERE id = ${userId}`,
      ).resolves.toHaveLength(1);
    } finally {
      await client`DELETE FROM identity.users WHERE id = ${userId}`;
    }
  });

  it.each([
    { scenario: "two-clean-proposals", includeInvalid: false },
    { scenario: "three-document-terminal-partial", includeInvalid: true },
  ])("recovers an exact $scenario run", async ({ includeInvalid }) => {
    const runId = crypto.randomUUID();
    const compact = runId.replaceAll("-", "");
    const userId = crypto.randomUUID();
    const fixtureManifest = [
      {
        fixture: "clean-pdf" as const,
        fileName: `generated-${compact}-clean.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 201,
        sha256: "1".repeat(64),
      },
      {
        fixture: "clean-docx" as const,
        fileName: `generated-${compact}-clean.docx`,
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
        sizeBytes: 202,
        sha256: "2".repeat(64),
      },
      {
        fixture: "invalid-pdf" as const,
        fileName: `generated-${compact}-invalid.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 203,
        sha256: "3".repeat(64),
      },
      {
        fixture: "malware-test" as const,
        fileName: `generated-${compact}-malware-test.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 204,
        sha256: "4".repeat(64),
      },
    ];
    const documentIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await client.begin(async (transaction) => {
      await transaction`INSERT INTO identity.users (id) VALUES (${userId})`;
      await transaction`
        INSERT INTO identity.external_identities (issuer, subject, user_id)
        VALUES ('https://acceptance.invalid/', ${`d1-document-processing-acceptance:${runId}`}, ${userId})
      `;
      await transaction`
        INSERT INTO platform.audit_events (
          id, user_id, action, resource_type, resource_id, trace_id, metadata
        ) VALUES (${crypto.randomUUID()}, ${userId}, 'identity.linked', 'user', ${userId},
          'acceptance', ${JSON.stringify({ issuer })}::jsonb)
      `;
      for (const [index, fixture] of fixtureManifest.slice(0, includeInvalid ? 3 : 2).entries()) {
        const documentId = required(documentIds[index], "partial document ID");
        const rejected = fixture.fixture === "invalid-pdf";
        await transaction`
          INSERT INTO documents.resume_documents (
            id, user_id, file_name, media_type, size_bytes, sha256, source_object_key,
            source_object_version, normalized_object_key, normalized_object_version,
            status, failure_code, page_count, character_count, parser_version, normalized_sha256
          ) VALUES (
            ${documentId}, ${userId}, ${fixture.fileName}, ${fixture.mediaType},
            ${fixture.sizeBytes}, ${fixture.sha256}, ${`quarantine/${documentId}/source`}, 'v1',
            ${rejected ? null : `normalized/${documentId}`}, ${rejected ? null : "n1"},
            ${rejected ? "rejected" : "parsed"}, ${rejected ? "invalid_document" : null},
            ${rejected ? null : 1}, ${rejected ? null : 20},
            ${rejected ? null : "resume-parser-v1"}, ${rejected ? null : "8".repeat(64)}
          )
        `;
        await transaction`
          INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
          VALUES (${userId}, 'documents.resume-upload.create.v1',
            ${`acceptance-${documentId}`}, ${"a".repeat(64)},
            ${JSON.stringify({ document: { id: documentId } })}::jsonb)
        `;
        await transaction`
          INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id, metadata)
          VALUES (${crypto.randomUUID()}, ${userId}, 'resume.upload.registered',
            ${documentId}, 'acceptance', '{}'::jsonb)
        `;
      }
      const cleanPdfDocumentId = required(documentIds[0], "clean PDF document ID");
      const cleanDocxDocumentId = required(documentIds[1], "clean DOCX document ID");
      const factDefinitions = [
        {
          id: crypto.randomUUID(),
          documentId: cleanPdfDocumentId,
          kind: "identity",
          key: "email",
          sensitivity: "confidential",
          value: `candidate-${compact}@example.test`,
        },
        {
          id: crypto.randomUUID(),
          documentId: cleanDocxDocumentId,
          kind: "skill",
          key: "skill",
          sensitivity: "standard",
          value: "TypeScript",
        },
        {
          id: crypto.randomUUID(),
          documentId: cleanDocxDocumentId,
          kind: "skill",
          key: "skill",
          sensitivity: "standard",
          value: "PostgreSQL",
        },
      ];
      for (const [index, documentId] of documentIds.slice(0, 2).entries()) {
        await transaction`
          INSERT INTO profile.resume_fact_imports (
            id, user_id, document_id, document_version, parser_version, proposal_digest, proposal_count
          ) VALUES (
            ${crypto.randomUUID()}, ${userId}, ${documentId}, 1, 'resume-parser-v1',
            ${"9".repeat(64)}, ${index === 0 ? 1 : 2}
          )
        `;
        await transaction`
          INSERT INTO platform.audit_events (
            id, user_id, action, resource_type, resource_id, trace_id, metadata
          ) VALUES (${crypto.randomUUID()}, ${userId}, 'profile.resume.proposals.imported',
            'resume_document', ${documentId}, 'acceptance',
            ${JSON.stringify({
              documentVersion: 1,
              parserVersion: "resume-parser-v1",
              proposalCount: index === 0 ? 1 : 2,
            })}::jsonb)
        `;
      }
      for (const fact of factDefinitions) {
        await transaction`INSERT INTO profile.profile_facts (id, user_id) VALUES (${fact.id}, ${userId})`;
        await transaction`
          INSERT INTO profile.profile_fact_versions (
            fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
            source_type, source_reference
          ) VALUES (
            ${fact.id}, 1, ${fact.kind}, ${fact.key}, ${JSON.stringify(fact.value)}::jsonb,
            'proposed', ${fact.sensitivity}, 'resume',
            ${`resume:${fact.documentId}:v1:resume-parser-v1`}
          )
        `;
        await transaction`
          INSERT INTO profile.profile_fact_evidence (
            fact_id, fact_version, ordinal, document_id, document_version,
            parser_version, block_index, start_offset, end_offset
          ) VALUES (${fact.id}, 1, 0, ${fact.documentId}, 1, 'resume-parser-v1', 0, 0, 1)
        `;
      }
    });
    const result = await executeDocumentProcessingAcceptance(client, {
      action: "cleanup",
      runId,
      issuer,
      fixtureManifest,
      fixtureSetSha256: documentProcessingAcceptanceFixtureSetSha256(fixtureManifest),
    });
    expect(result).toMatchObject({ documentCount: 0, persistentRows: 0 });
  });

  it("inspects exact contradiction state and refuses unrelated facts before cleanup", async () => {
    const runId = crypto.randomUUID();
    const compact = runId.replaceAll("-", "");
    const userId = crypto.randomUUID();
    const documents = [
      {
        fixture: "clean-pdf" as const,
        id: crypto.randomUUID(),
        fileName: `generated-${compact}-clean.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 701,
        sha256: "1".repeat(64),
        status: "failed",
        failureCode: "scan_failed",
        securityHold: true,
      },
      {
        fixture: "clean-docx" as const,
        id: crypto.randomUUID(),
        fileName: `generated-${compact}-clean.docx`,
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
        sizeBytes: 702,
        sha256: "2".repeat(64),
        status: "parsed",
        failureCode: null,
        securityHold: false,
      },
      {
        fixture: "invalid-pdf" as const,
        id: crypto.randomUUID(),
        fileName: `generated-${compact}-invalid.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 703,
        sha256: "3".repeat(64),
        status: "rejected",
        failureCode: "invalid_document",
        securityHold: false,
      },
      {
        fixture: "malware-test" as const,
        id: crypto.randomUUID(),
        fileName: `generated-${compact}-malware-test.pdf`,
        mediaType: "application/pdf" as const,
        sizeBytes: 704,
        sha256: "4".repeat(64),
        status: "rejected",
        failureCode: "malware_detected",
        securityHold: false,
      },
    ];
    const fixtureManifest = documents.map(
      ({ fixture, fileName, mediaType, sizeBytes, sha256 }) => ({
        fixture,
        fileName,
        mediaType,
        sizeBytes,
        sha256,
      }),
    );
    const fixtureSetSha256 = documentProcessingAcceptanceFixtureSetSha256(fixtureManifest);
    const inputBase = { runId, issuer, fixtureSetSha256, fixtureManifest };
    const factIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const emailFactId = required(factIds[0], "email fact ID");
    const typescriptFactId = required(factIds[1], "TypeScript fact ID");
    const postgresqlFactId = required(factIds[2], "PostgreSQL fact ID");
    const cleanPdfDocument = required(documents[0], "clean PDF document");
    const cleanDocxDocument = required(documents[1], "clean DOCX document");
    const definitions = [
      {
        factId: emailFactId,
        kind: "identity",
        key: "email",
        sensitivity: "confidential",
        documentId: cleanPdfDocument.id,
        initialValue: `candidate-${compact}@example.test`,
        decision: "confirmed",
      },
      {
        factId: typescriptFactId,
        kind: "skill",
        key: "skill",
        sensitivity: "standard",
        documentId: cleanDocxDocument.id,
        initialValue: "TypeScript",
        decision: "confirmed",
      },
      {
        factId: postgresqlFactId,
        kind: "skill",
        key: "skill",
        sensitivity: "standard",
        documentId: cleanDocxDocument.id,
        initialValue: "PostgreSQL",
        decision: "rejected",
      },
    ];
    try {
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "preflight" }),
      ).resolves.toMatchObject({ documentCount: 0, persistentRows: 0 });
      await client.begin(async (transaction) => {
        await transaction`INSERT INTO identity.users (id) VALUES (${userId})`;
        await transaction`
          INSERT INTO identity.external_identities (issuer, subject, user_id)
          VALUES ('https://acceptance.invalid/', ${`d1-document-processing-acceptance:${runId}`}, ${userId})
        `;
        await transaction`
          INSERT INTO platform.audit_events (
            id, user_id, action, resource_type, resource_id, trace_id, metadata
          ) VALUES (${crypto.randomUUID()}, ${userId}, 'identity.linked', 'user', ${userId},
            'acceptance', ${JSON.stringify({ issuer })}::jsonb)
        `;
        for (const document of documents.slice(0, 2)) {
          await transaction`
            INSERT INTO documents.resume_documents (
              id, user_id, file_name, media_type, size_bytes, sha256, source_object_key,
              source_object_version, normalized_object_key, normalized_object_version,
              status, failure_code, page_count, character_count, scan_result, parser_version,
              normalized_sha256, security_hold
            ) VALUES (
              ${document.id}, ${userId}, ${document.fileName}, ${document.mediaType},
              ${document.sizeBytes}, ${document.sha256}, ${`quarantine/${document.id}/source`},
              ${`version-${document.fixture}`},
              ${`normalized/${document.id}`}, 'normalized-version', 'parsed', NULL, 1, 40,
              'NO_THREATS_FOUND', 'resume-parser-v1', ${"5".repeat(64)}, false
            )
          `;
          await transaction`
            INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
            VALUES (${userId}, 'documents.resume-upload.create.v1',
              ${`acceptance-${document.id}`}, ${"a".repeat(64)},
              ${JSON.stringify({ document: { id: document.id } })}::jsonb)
          `;
          await transaction`
            INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id, metadata)
            VALUES (${crypto.randomUUID()}, ${userId}, 'resume.upload.registered',
              ${document.id}, 'acceptance', '{}'::jsonb)
          `;
          for (const action of [
            "resume.scan.recorded",
            "resume.parse.started",
            "resume.parse.completed",
          ]) {
            await transaction`
              INSERT INTO documents.audit_events (
                id, user_id, action, document_id, trace_id, metadata
              ) VALUES (${crypto.randomUUID()}, ${userId}, ${action}, ${document.id},
                'acceptance', '{}'::jsonb)
            `;
          }
          await transaction`
            INSERT INTO documents.processing_dispositions (
              document_id, source_object_version, scan_status, scan_result, first_event_id
            ) VALUES (
              ${document.id}, ${`version-${document.fixture}`}, 'COMPLETED',
              'NO_THREATS_FOUND',
              ${`event-${document.fixture}`}
            )
          `;
          await transaction`
            INSERT INTO documents.processing_receipts (
              event_id, document_id, source_object_version, scan_status, scan_result, observed_at
            ) VALUES (
              ${`event-${document.fixture}`}, ${document.id}, ${`version-${document.fixture}`},
              'COMPLETED',
              'NO_THREATS_FOUND',
              now()
            )
          `;
        }
        for (const document of documents.slice(0, 2)) {
          await transaction`
            INSERT INTO profile.resume_fact_imports (
              id, user_id, document_id, document_version, parser_version,
              proposal_digest, proposal_count
            ) VALUES (
              ${crypto.randomUUID()}, ${userId}, ${document.id}, 1, 'resume-parser-v1',
              ${"6".repeat(64)}, ${document.fixture === "clean-pdf" ? 1 : 2}
            )
          `;
        }
        for (const definition of definitions) {
          await transaction`INSERT INTO profile.profile_facts (id, user_id) VALUES (${definition.factId}, ${userId})`;
          await transaction`
            INSERT INTO profile.profile_fact_versions (
              fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
              source_type, source_reference
            ) VALUES (
              ${definition.factId}, 1, ${definition.kind}, ${definition.key},
              ${JSON.stringify(definition.initialValue)}::jsonb, 'proposed',
              ${definition.sensitivity}, 'resume',
              ${`resume:${definition.documentId}:v1:resume-parser-v1`}
            )
          `;
          await transaction`
            INSERT INTO profile.profile_fact_evidence (
              fact_id, fact_version, ordinal, document_id, document_version,
              parser_version, block_index, start_offset, end_offset
            ) VALUES (
              ${definition.factId}, 1, 0, ${definition.documentId}, 1,
              'resume-parser-v1', 0, 0, 1
            )
          `;
        }
        for (const document of documents.slice(0, 2)) {
          await transaction`
            INSERT INTO platform.audit_events (
              id, user_id, action, resource_type, resource_id, trace_id, metadata
            ) VALUES (
              ${crypto.randomUUID()}, ${userId}, 'profile.resume.proposals.imported',
              'resume_document', ${document.id}, 'acceptance',
              ${JSON.stringify({
                documentVersion: 1,
                parserVersion: "resume-parser-v1",
                proposalCount: document.fixture === "clean-pdf" ? 1 : 2,
              })}::jsonb
            )
          `;
        }
      });
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "clean" }),
      ).resolves.toMatchObject({
        documentCount: 2,
        profileVersionCount: 3,
        evidenceCount: 3,
        persistentRows: 30,
      });

      const insertReviewVersions = async (
        fault: "none" | "value" | "decision" | "source",
        recordRequest = false,
      ): Promise<void> =>
        client.begin(async (transaction) => {
          for (const definition of definitions) {
            const corrected = definition.initialValue === "TypeScript";
            const email = definition.initialValue.endsWith("@example.test");
            const postgresSkill = definition.initialValue === "PostgreSQL";
            const evidenceDocumentId =
              fault === "source" && email ? cleanDocxDocument.id : definition.documentId;
            const value =
              fault === "value" && corrected
                ? "JavaScript (reviewed synthetic)"
                : corrected
                  ? "TypeScript (reviewed synthetic)"
                  : definition.initialValue;
            const decision =
              fault === "decision" && postgresSkill ? "confirmed" : definition.decision;
            await transaction`
            INSERT INTO profile.profile_fact_versions (
              fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
              source_type, source_reference
            ) VALUES (
              ${definition.factId}, 2, ${definition.kind}, ${definition.key},
              ${JSON.stringify(value)}::jsonb, ${decision}, ${definition.sensitivity},
              ${corrected ? "user" : "resume"},
              ${corrected ? `resume-correction:${definition.factId}` : `resume:${evidenceDocumentId}:v1:resume-parser-v1`}
            )
          `;
            if (!corrected) {
              await transaction`
              INSERT INTO profile.profile_fact_evidence (
                fact_id, fact_version, ordinal, document_id, document_version,
                parser_version, block_index, start_offset, end_offset
              ) VALUES (${definition.factId}, 2, 0, ${evidenceDocumentId}, 1, 'resume-parser-v1', 0, 0, 1)
            `;
            }
            if (recordRequest) {
              await transaction`
              INSERT INTO platform.idempotency_keys (user_id, scope, key, request_hash, response)
              VALUES (${userId}, ${`profile.fact.update.v1:${definition.factId}`},
                ${`acceptance-${definition.factId}`}, ${"7".repeat(64)},
                ${JSON.stringify({
                  id: definition.factId,
                  version: 2,
                  verification: decision,
                })}::jsonb)
            `;
              await transaction`
              INSERT INTO platform.audit_events (
                id, user_id, action, resource_type, resource_id, trace_id, metadata
              ) VALUES (${crypto.randomUUID()}, ${userId}, 'profile.fact.version.created',
                'profile_fact', ${definition.factId}, 'acceptance',
                ${JSON.stringify({ version: 2 })}::jsonb)
            `;
            }
          }
        });
      for (const fault of ["value", "decision", "source"] as const) {
        await insertReviewVersions(fault);
        await expect(
          executeDocumentProcessingAcceptance(client, { ...inputBase, action: "reviewed" }),
        ).rejects.toThrow("synthetic");
        await client`DELETE FROM profile.profile_fact_versions WHERE fact_id = ANY(${client.array(factIds)}::uuid[]) AND version = 2`;
      }
      await insertReviewVersions("none", true);
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "reviewed" }),
      ).resolves.toMatchObject({
        documentCount: 2,
        profileVersionCount: 6,
        evidenceCount: 5,
        persistentRows: 41,
      });

      await client.begin(async (transaction) => {
        for (const document of documents.slice(2)) {
          await transaction`
            INSERT INTO documents.resume_documents (
              id, user_id, file_name, media_type, size_bytes, sha256, source_object_key,
              source_object_version, status, failure_code, scan_result
            ) VALUES (${document.id}, ${userId}, ${document.fileName}, ${document.mediaType},
              ${document.sizeBytes}, ${document.sha256}, ${`quarantine/${document.id}/source`},
              ${`version-${document.fixture}`}, 'rejected', ${document.failureCode},
              ${document.fixture === "malware-test" ? "THREATS_FOUND" : "NO_THREATS_FOUND"})
          `;
          await transaction`
            INSERT INTO documents.idempotency_keys (user_id, scope, key, request_hash, response)
            VALUES (${userId}, 'documents.resume-upload.create.v1',
              ${`acceptance-${document.id}`}, ${"a".repeat(64)},
              ${JSON.stringify({ document: { id: document.id } })}::jsonb)
          `;
          await transaction`
            INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id, metadata)
            VALUES (${crypto.randomUUID()}, ${userId}, 'resume.upload.registered',
              ${document.id}, 'acceptance', '{}'::jsonb)
          `;
          const terminalAuditActions =
            document.fixture === "invalid-pdf"
              ? ["resume.scan.recorded", "resume.parse.started", "resume.processing.rejected"]
              : ["resume.scan.recorded", "resume.processing.rejected"];
          for (const action of terminalAuditActions) {
            await transaction`
              INSERT INTO documents.audit_events (
                id, user_id, action, document_id, trace_id, metadata
              ) VALUES (${crypto.randomUUID()}, ${userId}, ${action}, ${document.id},
                'acceptance', '{}'::jsonb)
            `;
          }
          await transaction`
            INSERT INTO documents.processing_dispositions (
              document_id, source_object_version, scan_status, scan_result, first_event_id
            ) VALUES (${document.id}, ${`version-${document.fixture}`}, 'COMPLETED',
              ${document.fixture === "malware-test" ? "THREATS_FOUND" : "NO_THREATS_FOUND"},
              ${`event-${document.fixture}`})
          `;
          await transaction`
            INSERT INTO documents.processing_receipts (
              event_id, document_id, source_object_version, scan_status, scan_result, observed_at
            ) VALUES (${`event-${document.fixture}`}, ${document.id},
              ${`version-${document.fixture}`}, 'COMPLETED',
              ${document.fixture === "malware-test" ? "THREATS_FOUND" : "NO_THREATS_FOUND"}, now())
          `;
        }
      });
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "terminal" }),
      ).resolves.toMatchObject({
        documentCount: 4,
        rejectedCount: 2,
        profileVersionCount: 6,
        persistentRows: 56,
      });

      await client.begin(async (transaction) => {
        await transaction`
          UPDATE documents.resume_documents
          SET status = 'failed', failure_code = 'scan_failed', security_hold = true
          WHERE id = ${cleanDocxDocument.id}
        `;
        await transaction`
          INSERT INTO documents.processing_receipts (
            event_id, document_id, source_object_version, scan_status, scan_result, observed_at
          ) VALUES ('event-wrong-held-role', ${cleanDocxDocument.id}, 'wrong-held-version',
            'COMPLETED', 'NO_THREATS_FOUND', now())
        `;
        await transaction`
          INSERT INTO profile.profile_fact_versions (
            fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
            source_type, source_reference, availability_state, availability_reason
          ) VALUES (${postgresqlFactId}, 3, 'skill', 'skill', '"PostgreSQL"'::jsonb, 'rejected',
            'standard', 'resume', ${`resume:${cleanDocxDocument.id}:v1:resume-parser-v1`},
            'invalidated', 'source_security_hold')
        `;
        await transaction`
          INSERT INTO profile.profile_fact_evidence (
            fact_id, fact_version, ordinal, document_id, document_version,
            parser_version, block_index, start_offset, end_offset
          ) VALUES (${postgresqlFactId}, 3, 0, ${cleanDocxDocument.id}, 1,
            'resume-parser-v1', 0, 0, 1)
        `;
      });
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "contradiction" }),
      ).rejects.toThrow();
      await client.begin(async (transaction) => {
        await transaction`
          DELETE FROM profile.profile_fact_versions WHERE fact_id = ${postgresqlFactId} AND version = 3
        `;
        await transaction`DELETE FROM documents.resume_documents WHERE id = ${cleanDocxDocument.id}`;
        const document = cleanDocxDocument;
        await transaction`
          INSERT INTO documents.resume_documents (
            id, user_id, file_name, media_type, size_bytes, sha256, source_object_key,
            source_object_version, normalized_object_key, normalized_object_version,
            status, page_count, character_count, scan_result, parser_version, normalized_sha256
          ) VALUES (${document.id}, ${userId}, ${document.fileName}, ${document.mediaType},
            ${document.sizeBytes}, ${document.sha256}, ${`quarantine/${document.id}/source`},
            ${`version-${document.fixture}`}, ${`normalized/${document.id}`},
            'normalized-version', 'parsed', 1, 40, 'NO_THREATS_FOUND',
            'resume-parser-v1', ${"5".repeat(64)})
        `;
        await transaction`
          INSERT INTO documents.processing_dispositions (
            document_id, source_object_version, scan_status, scan_result, first_event_id
          ) VALUES (${document.id}, ${`version-${document.fixture}`}, 'COMPLETED',
            'NO_THREATS_FOUND', ${`event-${document.fixture}`})
        `;
        await transaction`
          INSERT INTO documents.processing_receipts (
            event_id, document_id, source_object_version, scan_status, scan_result, observed_at
          ) VALUES (${`event-${document.fixture}`}, ${document.id},
            ${`version-${document.fixture}`}, 'COMPLETED', 'NO_THREATS_FOUND', now())
        `;
      });

      await client.begin(async (transaction) => {
        await transaction`
          UPDATE documents.resume_documents
          SET status = 'failed', failure_code = 'scan_failed', security_hold = true
          WHERE id = ${cleanPdfDocument.id}
        `;
        await transaction`
          INSERT INTO documents.processing_receipts (
            event_id, document_id, source_object_version, scan_status, scan_result, observed_at
          ) VALUES ('event-contradiction', ${cleanPdfDocument.id}, 'contradictory-version',
            'COMPLETED', 'NO_THREATS_FOUND', now())
        `;
        await transaction`
          INSERT INTO documents.audit_events (
            id, user_id, action, document_id, trace_id, metadata
          ) VALUES (${crypto.randomUUID()}, ${userId}, 'resume.processing.contradiction',
            ${cleanPdfDocument.id}, 'acceptance', '{}'::jsonb)
        `;
        await transaction`
          INSERT INTO profile.profile_fact_versions (
            fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
            source_type, source_reference, availability_state, availability_reason
          ) VALUES (${emailFactId}, 3, 'identity', 'email',
            ${JSON.stringify(`candidate-${compact}@example.test`)}::jsonb, 'confirmed',
            'confidential', 'resume', ${`resume:${cleanPdfDocument.id}:v1:resume-parser-v1`},
            'invalidated', 'source_security_hold')
        `;
        await transaction`
          INSERT INTO profile.profile_fact_evidence (
            fact_id, fact_version, ordinal, document_id, document_version,
            parser_version, block_index, start_offset, end_offset
          ) VALUES (${emailFactId}, 3, 0, ${cleanPdfDocument.id}, 1, 'resume-parser-v1', 0, 0, 1)
        `;
        await transaction`
          INSERT INTO platform.audit_events (
            id, user_id, action, resource_type, resource_id, trace_id, metadata
          ) VALUES (${crypto.randomUUID()}, ${userId}, 'profile.resume.proposals.security-held',
            'resume_document', ${cleanPdfDocument.id}, 'acceptance',
            ${JSON.stringify({ rejectedProposalCount: 1 })}::jsonb)
        `;
      });
      const inspected = await executeDocumentProcessingAcceptance(client, {
        ...inputBase,
        action: "contradiction",
      });
      expect(inspected).toMatchObject({
        documentCount: 4,
        parsedCount: 1,
        rejectedCount: 2,
        failedCount: 1,
        securityHoldCount: 1,
        receiptCount: 5,
        dispositionCount: 4,
        profileFactCount: 3,
        profileVersionCount: 7,
        evidenceCount: 6,
        persistentRows: 61,
      });
      expect(JSON.stringify(inspected)).not.toContain(userId);
      expect(JSON.stringify(inspected)).not.toContain(cleanPdfDocument.id);
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "rollback-probe" }),
      ).resolves.toMatchObject({ rollbackProved: true, persistentRows: 61 });

      const unrelatedFactId = crypto.randomUUID();
      await client`INSERT INTO profile.profile_facts (id, user_id) VALUES (${unrelatedFactId}, ${userId})`;
      await client`
        INSERT INTO profile.profile_fact_versions (
          fact_id, version, kind, fact_key, fact_value, verification, sensitivity,
          source_type, source_reference
        ) VALUES (
          ${unrelatedFactId}, 1, 'skill', 'skill', '"unrelated"'::jsonb,
          'confirmed', 'standard', 'user', ${`direct:${unrelatedFactId}`}
        )
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).rejects.toThrow("Profile");
      await client`DELETE FROM profile.profile_facts WHERE id = ${unrelatedFactId}`;

      const jobPreferenceId = crypto.randomUUID();
      await client`
        INSERT INTO profile.job_preferences (id, user_id, version, preferences)
        VALUES (${jobPreferenceId}, ${userId}, 1, '{}'::jsonb)
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).rejects.toThrow("unrelated Profile-owned user state");
      await client`DELETE FROM profile.job_preferences WHERE id = ${jobPreferenceId}`;

      const operationId = crypto.randomUUID();
      await client`
        INSERT INTO platform.operations (id, user_id, kind, state)
        VALUES (${operationId}, ${userId}, 'synthetic-refusal-test', 'queued')
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).rejects.toThrow("unrelated Profile-owned user state");
      await client`DELETE FROM platform.operations WHERE id = ${operationId}`;

      await client`
        UPDATE identity.external_identities
        SET email = 'unexpected-synthetic@example.test'
        WHERE issuer = ${issuer} AND subject = ${`d1-document-processing-acceptance:${runId}`}
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).rejects.toThrow("unrelated identity");
      await client`
        UPDATE identity.external_identities
        SET email = NULL
        WHERE issuer = ${issuer} AND subject = ${`d1-document-processing-acceptance:${runId}`}
      `;

      const duplicateAuditId = crypto.randomUUID();
      await client`
        INSERT INTO platform.audit_events (
          id, user_id, action, resource_type, resource_id, trace_id, metadata
        ) VALUES (${duplicateAuditId}, ${userId}, 'identity.linked', 'user', ${userId},
          'acceptance-duplicate', ${JSON.stringify({ issuer })}::jsonb)
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).rejects.toThrow("duplicate Profile audit");
      await client`DELETE FROM platform.audit_events WHERE id = ${duplicateAuditId}`;

      const unrelatedIdempotencyKey = "acceptance-unrelated-profile-fact";
      const unrelatedIdempotencyFactId = crypto.randomUUID();
      await client`
        INSERT INTO platform.idempotency_keys (user_id, scope, key, request_hash, response)
        VALUES (${userId}, ${`profile.fact.update.v1:${unrelatedIdempotencyFactId}`},
          ${unrelatedIdempotencyKey}, ${"8".repeat(64)},
          ${JSON.stringify({
            id: unrelatedIdempotencyFactId,
            version: 2,
            verification: "confirmed",
          })}::jsonb)
      `;
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).rejects.toThrow("unrelated Profile idempotency");
      await client`
        DELETE FROM platform.idempotency_keys
        WHERE user_id = ${userId} AND key = ${unrelatedIdempotencyKey}
      `;

      const cleaned = await executeDocumentProcessingAcceptance(client, {
        ...inputBase,
        action: "cleanup",
      });
      expect(cleaned).toMatchObject({ documentCount: 0, persistentRows: 0 });
      await expect(
        executeDocumentProcessingAcceptance(client, { ...inputBase, action: "cleanup" }),
      ).resolves.toMatchObject({ documentCount: 0, persistentRows: 0 });
    } finally {
      await client`DELETE FROM documents.audit_events WHERE user_id = ${userId}`;
      await client`DELETE FROM platform.audit_events WHERE user_id = ${userId}`;
      await client`DELETE FROM identity.users WHERE id = ${userId}`;
    }
  });
});
