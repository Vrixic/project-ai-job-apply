import { createHash } from "node:crypto";
import {
  type DocumentProcessingAcceptanceDocumentRef,
  type DocumentProcessingAcceptanceProfilePort,
  type DocumentProcessingAcceptanceProfileSummary,
  PostgresDocumentProcessingAcceptanceProfilePort,
} from "@ai-job-apply/profile-service/document-processing-acceptance";
import type postgres from "postgres";
import {
  type DocumentProcessingAcceptanceManifestEntry,
  documentProcessingAcceptanceFixtureSetSha256,
} from "./document-processing-acceptance-manifest.js";

export const DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRMATION = "generated-synthetic-only";
export const DOCUMENT_PROCESSING_ACCEPTANCE_SCHEMA_VERSION = 1;

const PROFILE_MIGRATION_VERSION = "0005_resume_fact_proposals";
const PROFILE_MIGRATION_SHA256 = "3c59bee0e4e43e768f7ca3832f5327dc07d784e3cba94f454283a83093ca524e";
const DOCUMENTS_MIGRATION_VERSION = "0002_resume_processing";
const DOCUMENTS_MIGRATION_SHA256 =
  "6b534809a2b20764813500d07784f833897697b261b333c0abe3abf2f2795f32";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROLLBACK_SENTINEL = Object.freeze({ kind: "document-processing-acceptance-rollback" });

export type DocumentProcessingAcceptanceAction =
  | "preflight"
  | "clean"
  | "reviewed"
  | "terminal"
  | "contradiction"
  | "rollback-probe"
  | "cleanup";

export interface DocumentProcessingAcceptanceInput {
  action: DocumentProcessingAcceptanceAction;
  runId: string;
  issuer: string;
  fixtureSetSha256: string;
  fixtureManifest: readonly DocumentProcessingAcceptanceManifestEntry[];
}

export interface DocumentProcessingAcceptanceResult {
  schemaVersion: 1;
  kind: "development-document-processing-acceptance";
  action: DocumentProcessingAcceptanceAction;
  runId: string;
  documentCount: number;
  parsedCount: number;
  rejectedCount: number;
  failedCount: number;
  securityHoldCount: number;
  receiptCount: number;
  dispositionCount: number;
  profileFactCount: number;
  profileVersionCount: number;
  evidenceCount: number;
  persistentRows: number;
  rollbackProved: boolean;
  canonicalSha256: string;
}

interface DocumentRow {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  sourceObjectKey: string;
  sourceObjectVersion: string | null;
  status: "awaiting_upload" | "scanning" | "parsing" | "parsed" | "rejected" | "failed";
  failureCode: string | null;
  securityHold: boolean;
}

interface AggregateRow {
  receiptCount: number;
  dispositionCount: number;
  documentAuditCount: number;
  documentIdempotencyCount: number;
}

const ZERO_PROFILE_SUMMARY: DocumentProcessingAcceptanceProfileSummary = {
  importCount: 0,
  factCount: 0,
  versionCount: 0,
  evidenceCount: 0,
  proposedCount: 0,
  confirmedCount: 0,
  rejectedCount: 0,
  invalidatedCount: 0,
  auditEventCount: 0,
  idempotencyKeyCount: 0,
  canonicalSha256: createHash("sha256").update("[]").digest("hex"),
};

export function parseDocumentProcessingAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): DocumentProcessingAcceptanceInput {
  if (
    environment.DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRM !==
    DOCUMENT_PROCESSING_ACCEPTANCE_CONFIRMATION
  ) {
    throw new Error("The generated-synthetic acceptance confirmation is required");
  }
  const action = environment.DOCUMENT_PROCESSING_ACCEPTANCE_ACTION;
  if (
    action !== "preflight" &&
    action !== "clean" &&
    action !== "reviewed" &&
    action !== "terminal" &&
    action !== "contradiction" &&
    action !== "rollback-probe" &&
    action !== "cleanup"
  ) {
    throw new Error("The document-processing acceptance action is invalid");
  }
  const runId = environment.DOCUMENT_PROCESSING_ACCEPTANCE_RUN_ID;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("The document-processing acceptance run ID is invalid");
  }
  const fixtureSetSha256 = environment.DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_SET_SHA256;
  if (!fixtureSetSha256 || !SHA256_PATTERN.test(fixtureSetSha256)) {
    throw new Error("The document-processing fixture-set digest is invalid");
  }
  const issuer = environment.DOCUMENT_PROCESSING_ACCEPTANCE_ISSUER;
  if (!issuer || !isCanonicalAcceptanceIssuer(issuer)) {
    throw new Error("The document-processing acceptance issuer is invalid");
  }
  let fixtureManifest: unknown;
  const fixtureManifestText = environment.DOCUMENT_PROCESSING_ACCEPTANCE_FIXTURE_MANIFEST;
  if (
    !fixtureManifestText ||
    fixtureManifestText.length > 4096 ||
    !/^[\x20-\x7e]+$/.test(fixtureManifestText)
  ) {
    throw new Error("The document-processing fixture manifest is invalid");
  }
  try {
    fixtureManifest = JSON.parse(fixtureManifestText);
  } catch {
    throw new Error("The document-processing fixture manifest is invalid");
  }
  assertFixtureManifest(runId, fixtureSetSha256, fixtureManifest);
  return { action, runId, issuer, fixtureSetSha256, fixtureManifest };
}

function isCanonicalAcceptanceIssuer(issuer: string): boolean {
  try {
    const parsed = new URL(issuer);
    return (
      issuer.length <= 512 &&
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.toString() === issuer
    );
  } catch {
    return false;
  }
}

function assertFixtureManifest(
  runId: string,
  fixtureSetSha256: string,
  candidate: unknown,
): asserts candidate is DocumentProcessingAcceptanceManifestEntry[] {
  if (!Array.isArray(candidate) || candidate.length !== 4) {
    throw new Error("The document-processing fixture manifest is incomplete");
  }
  const expectedNames = expectedFileNames(runId);
  const fixtures = new Set<string>();
  for (const entry of candidate as Array<Record<string, unknown>>) {
    const fixture = entry.fixture;
    const fileName = entry.fileName;
    const mediaType = entry.mediaType;
    const expectedFixture = typeof fileName === "string" ? expectedNames.get(fileName) : undefined;
    const expectedMediaType =
      expectedFixture === "clean-docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";
    if (
      typeof fixture !== "string" ||
      fixture !== expectedFixture ||
      fixtures.has(fixture) ||
      mediaType !== expectedMediaType ||
      !Number.isInteger(entry.sizeBytes) ||
      (entry.sizeBytes as number) < 1 ||
      (entry.sizeBytes as number) > 5_242_880 ||
      typeof entry.sha256 !== "string" ||
      !SHA256_PATTERN.test(entry.sha256) ||
      Object.keys(entry).sort().join(",") !== "fileName,fixture,mediaType,sha256,sizeBytes"
    ) {
      throw new Error("The document-processing fixture manifest is invalid");
    }
    fixtures.add(fixture);
  }
  if (
    documentProcessingAcceptanceFixtureSetSha256(
      candidate as DocumentProcessingAcceptanceManifestEntry[],
    ) !== fixtureSetSha256
  ) {
    throw new Error("The document-processing fixture manifest digest does not match");
  }
}

function expectedFileNames(
  runId: string,
): Map<string, DocumentProcessingAcceptanceDocumentRef["fixture"]> {
  const compact = runId.replaceAll("-", "");
  return new Map([
    [`generated-${compact}-clean.pdf`, "clean-pdf"],
    [`generated-${compact}-clean.docx`, "clean-docx"],
    [`generated-${compact}-invalid.pdf`, "invalid-pdf"],
    [`generated-${compact}-malware-test.pdf`, "malware-test"],
  ]);
}

function expectedDocumentCount(action: DocumentProcessingAcceptanceAction): number {
  switch (action) {
    case "preflight":
      return 0;
    case "clean":
    case "reviewed":
      return 2;
    case "terminal":
    case "contradiction":
    case "rollback-probe":
    case "cleanup":
      return 4;
  }
}

function mapDocumentRefs(
  input: DocumentProcessingAcceptanceInput,
  rows: readonly DocumentRow[],
): DocumentProcessingAcceptanceDocumentRef[] {
  const names = expectedFileNames(input.runId);
  const manifest = new Map(input.fixtureManifest.map((entry) => [entry.fixture, entry]));
  const expectedCount = expectedDocumentCount(input.action);
  if (
    (input.action !== "cleanup" && rows.length !== expectedCount) ||
    (input.action === "cleanup" && rows.length > 4)
  ) {
    throw new Error("The synthetic document fixture has an unexpected document count");
  }
  const references = rows.map((row) => {
    const fixture = names.get(row.fileName);
    const expectedMediaType =
      fixture === "clean-docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";
    if (
      !fixture ||
      row.mediaType !== expectedMediaType ||
      row.sizeBytes < 1 ||
      !SHA256_PATTERN.test(row.sha256) ||
      row.sourceObjectKey !== `quarantine/${row.id}/source`
    ) {
      throw new Error("The claimed document does not match the synthetic fixture boundary");
    }
    const expected = manifest.get(fixture);
    if (!expected) {
      throw new Error("The claimed document has no authenticated manifest entry");
    }
    if (
      row.fileName !== expected.fileName ||
      row.mediaType !== expected.mediaType ||
      row.sizeBytes !== expected.sizeBytes ||
      row.sha256 !== expected.sha256
    ) {
      throw new Error("The database document does not match the authenticated fixture manifest");
    }
    return { documentId: row.id, fixture };
  });
  if (new Set(references.map((reference) => reference.fixture)).size !== references.length) {
    throw new Error("The synthetic document fixture contains duplicate roles");
  }
  const required =
    input.action === "cleanup"
      ? []
      : expectedCount === 2
        ? ["clean-pdf", "clean-docx"]
        : expectedCount === 4
          ? ["clean-pdf", "clean-docx", "invalid-pdf", "malware-test"]
          : [];
  if (!required.every((fixture) => references.some((reference) => reference.fixture === fixture))) {
    throw new Error("The synthetic document fixture is incomplete");
  }
  return references;
}

function assertDocumentPhase(
  action: DocumentProcessingAcceptanceAction,
  rows: readonly DocumentRow[],
): void {
  for (const row of rows) {
    const fixture = expectedFileNamesFromRow(row.fileName);
    if (action === "cleanup") {
      const validPartial =
        (row.status === "awaiting_upload" && row.failureCode === null && !row.securityHold) ||
        (row.status === "scanning" && row.failureCode === null && !row.securityHold) ||
        (row.status === "parsing" && row.failureCode === null && !row.securityHold) ||
        ((fixture === "clean-pdf" || fixture === "clean-docx") &&
          row.status === "parsed" &&
          row.failureCode === null &&
          !row.securityHold) ||
        (fixture === "invalid-pdf" &&
          row.status === "rejected" &&
          row.failureCode === "invalid_document" &&
          !row.securityHold) ||
        (fixture === "malware-test" &&
          row.status === "rejected" &&
          row.failureCode === "malware_detected" &&
          !row.securityHold) ||
        (fixture === "clean-pdf" &&
          row.status === "failed" &&
          row.failureCode === "scan_failed" &&
          row.securityHold);
      if (!validPartial) {
        throw new Error("The partial synthetic document is outside a recoverable state");
      }
      continue;
    }
    const contradicted = action === "contradiction" || action === "rollback-probe";
    const expected =
      fixture === "clean-pdf" && contradicted
        ? { status: "failed", failureCode: "scan_failed", securityHold: true }
        : fixture === "clean-pdf" || fixture === "clean-docx"
          ? { status: "parsed", failureCode: null, securityHold: false }
          : fixture === "invalid-pdf"
            ? { status: "rejected", failureCode: "invalid_document", securityHold: false }
            : fixture === "malware-test"
              ? { status: "rejected", failureCode: "malware_detected", securityHold: false }
              : null;
    if (
      !expected ||
      row.status !== expected.status ||
      row.failureCode !== expected.failureCode ||
      row.securityHold !== expected.securityHold ||
      !row.sourceObjectVersion
    ) {
      throw new Error("The synthetic document has an unexpected processing disposition");
    }
  }
}

function expectedFileNamesFromRow(
  fileName: string,
): DocumentProcessingAcceptanceDocumentRef["fixture"] | null {
  if (fileName.endsWith("-clean.pdf")) return "clean-pdf";
  if (fileName.endsWith("-clean.docx")) return "clean-docx";
  if (fileName.endsWith("-invalid.pdf")) return "invalid-pdf";
  if (fileName.endsWith("-malware-test.pdf")) return "malware-test";
  return null;
}

async function assertMigrations(transaction: postgres.TransactionSql): Promise<void> {
  const [profile, documents] = await Promise.all([
    transaction<Array<{ checksum: string }>>`
      SELECT checksum FROM platform.schema_migrations
      WHERE version = ${PROFILE_MIGRATION_VERSION}
    `,
    transaction<Array<{ checksum: string }>>`
      SELECT checksum FROM documents.schema_migrations
      WHERE version = ${DOCUMENTS_MIGRATION_VERSION}
    `,
  ]);
  if (
    profile[0]?.checksum !== PROFILE_MIGRATION_SHA256 ||
    documents[0]?.checksum !== DOCUMENTS_MIGRATION_SHA256
  ) {
    throw new Error("The exact document-processing migrations are not applied");
  }
}

async function readDocuments(
  transaction: postgres.TransactionSql,
  userId: string,
): Promise<DocumentRow[]> {
  return transaction<DocumentRow[]>`
    SELECT id, file_name AS "fileName", media_type AS "mediaType", size_bytes AS "sizeBytes",
      sha256, source_object_key AS "sourceObjectKey",
      source_object_version AS "sourceObjectVersion", status,
      failure_code AS "failureCode", security_hold AS "securityHold"
    FROM documents.resume_documents
    WHERE user_id = ${userId}
    ORDER BY file_name, id
  `;
}

async function assertNoMaterializedRunBoundary(
  transaction: postgres.TransactionSql,
  input: DocumentProcessingAcceptanceInput,
): Promise<void> {
  const subject = `d1-document-processing-acceptance:${input.runId}`;
  const fileNames = input.fixtureManifest.map((entry) => entry.fileName);
  const [counts] = await transaction<Array<{ identityCount: number; documentCount: number }>>`
    SELECT
      (SELECT count(*)::int FROM identity.external_identities
        WHERE subject = ${subject}) AS "identityCount",
      (SELECT count(*)::int FROM documents.resume_documents
        WHERE file_name = ANY(${transaction.array(fileNames)}::text[])) AS "documentCount"
  `;
  if (counts?.identityCount !== 0 || counts.documentCount !== 0) {
    throw new Error("The acceptance run has an existing or colliding persisted boundary");
  }
}

async function readAggregates(
  transaction: postgres.TransactionSql,
  userId: string,
  documentIds: readonly string[],
): Promise<AggregateRow> {
  const [row] = await transaction<AggregateRow[]>`
    SELECT
      (SELECT count(*)::int FROM documents.processing_receipts
        WHERE document_id = ANY(${transaction.array([...documentIds])}::uuid[])) AS "receiptCount",
      (SELECT count(*)::int FROM documents.processing_dispositions
        WHERE document_id = ANY(${transaction.array([...documentIds])}::uuid[])) AS "dispositionCount",
      (SELECT count(*)::int FROM documents.audit_events
        WHERE user_id = ${userId}) AS "documentAuditCount",
      (SELECT count(*)::int FROM documents.idempotency_keys
        WHERE user_id = ${userId}) AS "documentIdempotencyCount"
  `;
  if (!row) throw new Error("The synthetic document aggregates are unavailable");
  return row;
}

async function assertCleanupOwnedDocumentRows(
  transaction: postgres.TransactionSql,
  userId: string,
  references: readonly DocumentProcessingAcceptanceDocumentRef[],
): Promise<void> {
  const documentIds = new Set(references.map((reference) => reference.documentId));
  const claimedDocumentIds = references.map((reference) => reference.documentId);
  const audits = await transaction<
    Array<{ userId: string | null; documentId: string; action: string }>
  >`
    SELECT user_id::text AS "userId", document_id::text AS "documentId", action
    FROM documents.audit_events
    WHERE user_id = ${userId}
      OR document_id = ANY(${transaction.array(claimedDocumentIds)}::uuid[])
    ORDER BY document_id, created_at, id
  `;
  const idempotency = await transaction<
    Array<{ userId: string; scope: string; response: unknown }>
  >`
    SELECT user_id::text AS "userId", scope, response
    FROM documents.idempotency_keys
    WHERE user_id = ${userId}
      OR response #>> '{document,id}' = ANY(${transaction.array(claimedDocumentIds)}::text[])
    ORDER BY scope, key
  `;
  const registered = new Map<string, number>();
  for (const audit of audits) {
    if (
      audit.userId !== userId ||
      !documentIds.has(audit.documentId) ||
      ![
        "resume.upload.registered",
        "resume.scan.recorded",
        "resume.parse.started",
        "resume.parse.completed",
        "resume.processing.rejected",
        "resume.processing.failed",
        "resume.processing.contradiction",
      ].includes(audit.action)
    ) {
      throw new Error("Cleanup refused an unrelated Documents audit row");
    }
    if (audit.action === "resume.upload.registered") {
      registered.set(audit.documentId, (registered.get(audit.documentId) ?? 0) + 1);
    }
  }
  const idempotentDocumentIds = new Set<string>();
  for (const row of idempotency) {
    let response: { document?: { id?: unknown } } | null = null;
    try {
      response = (typeof row.response === "string" ? JSON.parse(row.response) : row.response) as {
        document?: { id?: unknown };
      } | null;
    } catch {
      throw new Error("Cleanup refused a malformed Documents idempotency response");
    }
    const documentId = response?.document?.id;
    if (
      row.userId !== userId ||
      row.scope !== "documents.resume-upload.create.v1" ||
      typeof documentId !== "string" ||
      !documentIds.has(documentId) ||
      idempotentDocumentIds.has(documentId)
    ) {
      throw new Error("Cleanup refused an unrelated Documents idempotency row");
    }
    idempotentDocumentIds.add(documentId);
  }
  if (
    references.some(
      (reference) =>
        registered.get(reference.documentId) !== 1 ||
        !idempotentDocumentIds.has(reference.documentId),
    ) ||
    idempotency.length !== references.length
  ) {
    throw new Error("Cleanup refused an incomplete Documents ownership boundary");
  }
}

function assertAggregatePhase(
  action: DocumentProcessingAcceptanceAction,
  aggregate: AggregateRow,
): void {
  const expected =
    action === "clean" || action === "reviewed"
      ? { receiptCount: 2, dispositionCount: 2 }
      : action === "terminal"
        ? { receiptCount: 4, dispositionCount: 4 }
        : { receiptCount: 5, dispositionCount: 4 };
  if (
    aggregate.receiptCount !== expected.receiptCount ||
    aggregate.dispositionCount !== expected.dispositionCount
  ) {
    throw new Error("The processing receipts or dispositions are outside the exact phase boundary");
  }
}

function resultFor(
  input: DocumentProcessingAcceptanceInput,
  rows: readonly DocumentRow[],
  aggregates: AggregateRow,
  profile: DocumentProcessingAcceptanceProfileSummary,
  rollbackProved: boolean,
): DocumentProcessingAcceptanceResult {
  const aggregate = {
    schemaVersion: DOCUMENT_PROCESSING_ACCEPTANCE_SCHEMA_VERSION as 1,
    kind: "development-document-processing-acceptance" as const,
    action: input.action,
    runId: input.runId,
    documentCount: rows.length,
    parsedCount: rows.filter((row) => row.status === "parsed").length,
    rejectedCount: rows.filter((row) => row.status === "rejected").length,
    failedCount: rows.filter((row) => row.status === "failed").length,
    securityHoldCount: rows.filter((row) => row.securityHold).length,
    receiptCount: aggregates.receiptCount,
    dispositionCount: aggregates.dispositionCount,
    profileFactCount: profile.factCount,
    profileVersionCount: profile.versionCount,
    evidenceCount: profile.evidenceCount,
    persistentRows:
      rows.length +
      aggregates.receiptCount +
      aggregates.dispositionCount +
      aggregates.documentAuditCount +
      aggregates.documentIdempotencyCount +
      profile.importCount +
      profile.factCount +
      profile.versionCount +
      profile.evidenceCount +
      profile.auditEventCount +
      profile.idempotencyKeyCount,
    rollbackProved,
  };
  return {
    ...aggregate,
    canonicalSha256: createHash("sha256")
      .update(
        JSON.stringify({
          ...aggregate,
          fixtureSetSha256: input.fixtureSetSha256,
          profileCanonicalSha256: profile.canonicalSha256,
          documents: rows,
        }),
      )
      .digest("hex"),
  };
}

async function executeRollbackProbe(
  client: postgres.Sql,
  input: DocumentProcessingAcceptanceInput,
  profilePort: DocumentProcessingAcceptanceProfilePort,
): Promise<DocumentProcessingAcceptanceResult> {
  let userId: string | null = null;
  let documentRows: DocumentRow[] = [];
  try {
    await client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`documents:processing-acceptance:${input.runId}`}))
      `;
      await assertMigrations(transaction);
      userId = await profilePort.resolveSyntheticUser(transaction, input.runId, input.issuer);
      if (!userId) throw new Error("The synthetic acceptance identity is unavailable");
      documentRows = await readDocuments(transaction, userId);
      mapDocumentRefs(input, documentRows);
      assertDocumentPhase(input.action, documentRows);
      const document = documentRows[0];
      if (!document) throw new Error("The rollback probe has no synthetic document");
      await transaction`
        INSERT INTO documents.audit_events (
          id, user_id, action, document_id, trace_id, metadata
        ) VALUES (
          gen_random_uuid(), ${userId}, 'resume.scan.recorded', ${document.id},
          ${`acceptance-rollback:${input.runId}`}, ${transaction.json({ probe: true })}::jsonb
        )
      `;
      throw ROLLBACK_SENTINEL;
    });
  } catch (error) {
    if (error !== ROLLBACK_SENTINEL) throw error;
  }
  if (!userId) throw new Error("The rollback probe identity was not retained in memory");
  const resolvedUserId = userId;
  return client.begin(async (transaction) => {
    const [probe] = await transaction<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM documents.audit_events
      WHERE user_id = ${resolvedUserId} AND trace_id = ${`acceptance-rollback:${input.runId}`}
    `;
    if (probe?.count !== 0) throw new Error("The synthetic rollback probe was persisted");
    const references = mapDocumentRefs(input, documentRows);
    const profile = await profilePort.inspect(transaction, {
      runId: input.runId,
      issuer: input.issuer,
      userId: resolvedUserId,
      phase: "contradiction",
      documents: references,
    });
    const aggregates = await readAggregates(
      transaction,
      resolvedUserId,
      references.map((reference) => reference.documentId),
    );
    assertAggregatePhase(input.action, aggregates);
    return resultFor(input, documentRows, aggregates, profile, true);
  });
}

export async function executeDocumentProcessingAcceptance(
  client: postgres.Sql,
  input: DocumentProcessingAcceptanceInput,
  profilePort: DocumentProcessingAcceptanceProfilePort = new PostgresDocumentProcessingAcceptanceProfilePort(),
): Promise<DocumentProcessingAcceptanceResult> {
  if (
    !RUN_ID_PATTERN.test(input.runId) ||
    !SHA256_PATTERN.test(input.fixtureSetSha256) ||
    !isCanonicalAcceptanceIssuer(input.issuer)
  ) {
    throw new Error("The document-processing acceptance input is invalid");
  }
  assertFixtureManifest(input.runId, input.fixtureSetSha256, input.fixtureManifest);
  if (input.action === "rollback-probe") {
    return executeRollbackProbe(client, input, profilePort);
  }
  return client.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext(${`documents:processing-acceptance:${input.runId}`}))
    `;
    await assertMigrations(transaction);
    const userId = await profilePort.resolveSyntheticUser(transaction, input.runId, input.issuer);
    if (input.action === "preflight") {
      if (userId) {
        throw new Error("Preflight refused a previously materialized synthetic identity");
      }
      await assertNoMaterializedRunBoundary(transaction, input);
      return resultFor(
        input,
        [],
        {
          receiptCount: 0,
          dispositionCount: 0,
          documentAuditCount: 0,
          documentIdempotencyCount: 0,
        },
        ZERO_PROFILE_SUMMARY,
        false,
      );
    }
    if (!userId) {
      if (input.action !== "cleanup") {
        throw new Error("The synthetic acceptance identity is unavailable");
      }
      await assertNoMaterializedRunBoundary(transaction, input);
      return resultFor(
        input,
        [],
        {
          receiptCount: 0,
          dispositionCount: 0,
          documentAuditCount: 0,
          documentIdempotencyCount: 0,
        },
        ZERO_PROFILE_SUMMARY,
        false,
      );
    }
    const rows = await readDocuments(transaction, userId);
    const references = mapDocumentRefs(input, rows);
    assertDocumentPhase(input.action, rows);
    if (input.action === "cleanup") {
      await assertCleanupOwnedDocumentRows(transaction, userId, references);
      await transaction`
        DELETE FROM documents.audit_events WHERE user_id = ${userId}
      `;
      const cleanup = await profilePort.cleanup(transaction, {
        runId: input.runId,
        issuer: input.issuer,
        userId,
        documents: references,
      });
      const [remaining] = await transaction<
        Array<{ documentCount: number; auditCount: number; userCount: number }>
      >`
        SELECT
          (SELECT count(*)::int FROM documents.resume_documents
            WHERE id = ANY(${transaction.array(references.map((reference) => reference.documentId))}::uuid[]))
            AS "documentCount",
          (SELECT count(*)::int FROM documents.audit_events WHERE user_id = ${userId})
            AS "auditCount",
          (SELECT count(*)::int FROM identity.users WHERE id = ${userId}) AS "userCount"
      `;
      if (
        remaining?.documentCount !== 0 ||
        remaining.auditCount !== 0 ||
        remaining.userCount !== 0 ||
        cleanup.userCount !== 1
      ) {
        throw new Error("The synthetic acceptance cleanup left persistent rows");
      }
      return resultFor(
        input,
        [],
        {
          receiptCount: 0,
          dispositionCount: 0,
          documentAuditCount: 0,
          documentIdempotencyCount: 0,
        },
        ZERO_PROFILE_SUMMARY,
        false,
      );
    }
    const profile = await profilePort.inspect(transaction, {
      runId: input.runId,
      issuer: input.issuer,
      userId,
      phase:
        input.action === "contradiction"
          ? "contradiction"
          : input.action === "reviewed"
            ? "reviewed"
            : input.action === "terminal"
              ? "terminal"
              : "clean",
      documents: references,
    });
    const aggregates = await readAggregates(
      transaction,
      userId,
      references.map((reference) => reference.documentId),
    );
    assertAggregatePhase(input.action, aggregates);
    return resultFor(input, rows, aggregates, profile, false);
  });
}
