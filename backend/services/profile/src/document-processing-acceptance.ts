import { createHash } from "node:crypto";
import type postgres from "postgres";

const ACCEPTANCE_SUBJECT_PREFIX = "d1-document-processing-acceptance:";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type DocumentProcessingAcceptanceProfilePhase =
  | "clean"
  | "reviewed"
  | "terminal"
  | "contradiction";

export type DocumentProcessingAcceptanceFixture =
  | "clean-pdf"
  | "clean-docx"
  | "invalid-pdf"
  | "malware-test";

export interface DocumentProcessingAcceptanceDocumentRef {
  documentId: string;
  fixture: DocumentProcessingAcceptanceFixture;
}

export interface DocumentProcessingAcceptanceProfileSummary {
  importCount: number;
  factCount: number;
  versionCount: number;
  evidenceCount: number;
  proposedCount: number;
  confirmedCount: number;
  rejectedCount: number;
  invalidatedCount: number;
  auditEventCount: number;
  idempotencyKeyCount: number;
  canonicalSha256: string;
}

export interface DocumentProcessingAcceptanceProfileCleanup {
  auditEventCount: number;
  idempotencyKeyCount: number;
  userCount: number;
}

export interface DocumentProcessingAcceptanceProfilePort {
  resolveSyntheticUser(
    transaction: postgres.TransactionSql,
    runId: string,
    issuer: string,
  ): Promise<string | null>;
  inspect(
    transaction: postgres.TransactionSql,
    input: {
      runId: string;
      issuer: string;
      userId: string;
      phase: DocumentProcessingAcceptanceProfilePhase;
      documents: readonly DocumentProcessingAcceptanceDocumentRef[];
    },
  ): Promise<DocumentProcessingAcceptanceProfileSummary>;
  cleanup(
    transaction: postgres.TransactionSql,
    input: {
      runId: string;
      issuer: string;
      userId: string;
      documents: readonly DocumentProcessingAcceptanceDocumentRef[];
    },
  ): Promise<DocumentProcessingAcceptanceProfileCleanup>;
}

interface ProfileInspectionRow {
  factId: string;
  version: number;
  verification: "proposed" | "confirmed" | "rejected";
  availabilityState: "available" | "invalidated";
  availabilityReason: string | null;
  sourceType: string;
  sourceReference: string;
  kind: string;
  key: string;
  sensitivity: string;
  value: unknown;
  evidence: Array<{ documentId: string; documentVersion: number; parserVersion: string }>;
}

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("The document-processing acceptance run ID is invalid");
  }
}

function assertIssuer(issuer: string): void {
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    throw new Error("The document-processing acceptance issuer is invalid");
  }
  if (
    issuer.length > 512 ||
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.toString() !== issuer
  ) {
    throw new Error("The document-processing acceptance issuer is invalid");
  }
}

function assertDocumentRefs(documents: readonly DocumentProcessingAcceptanceDocumentRef[]): void {
  const ids = new Set<string>();
  const fixtures = new Set<DocumentProcessingAcceptanceFixture>();
  for (const document of documents) {
    if (
      !UUID_PATTERN.test(document.documentId) ||
      ids.has(document.documentId) ||
      fixtures.has(document.fixture)
    ) {
      throw new Error("The document-processing acceptance document boundary is invalid");
    }
    ids.add(document.documentId);
    fixtures.add(document.fixture);
  }
}

export function documentProcessingAcceptanceSubject(runId: string): string {
  assertRunId(runId);
  return `${ACCEPTANCE_SUBJECT_PREFIX}${runId}`;
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function storedJson(value: unknown): unknown {
  let parsed = value;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      break;
    }
  }
  return parsed;
}

function assertProfilePhase(
  phase: DocumentProcessingAcceptanceProfilePhase,
  summary: Omit<DocumentProcessingAcceptanceProfileSummary, "canonicalSha256">,
): void {
  const expected =
    phase === "clean"
      ? {
          importCount: 2,
          factCount: 3,
          versionCount: 3,
          evidenceCount: 3,
          proposedCount: 3,
          confirmedCount: 0,
          rejectedCount: 0,
          invalidatedCount: 0,
          auditEventCount: 3,
          idempotencyKeyCount: 0,
        }
      : phase === "reviewed" || phase === "terminal"
        ? {
            importCount: 2,
            factCount: 3,
            versionCount: 6,
            evidenceCount: 5,
            proposedCount: 0,
            confirmedCount: 2,
            rejectedCount: 1,
            invalidatedCount: 0,
            auditEventCount: 6,
            idempotencyKeyCount: 3,
          }
        : {
            importCount: 2,
            factCount: 3,
            versionCount: 7,
            evidenceCount: 6,
            proposedCount: 0,
            confirmedCount: 2,
            rejectedCount: 1,
            invalidatedCount: 1,
            auditEventCount: 7,
            idempotencyKeyCount: 3,
          };
  if (
    Object.entries(expected).some(([key, value]) => summary[key as keyof typeof summary] !== value)
  ) {
    throw new Error("The acceptance profile is not in its exact expected phase");
  }
}

function assertExactFactSemantics(
  rows: readonly ProfileInspectionRow[],
  documents: readonly DocumentProcessingAcceptanceDocumentRef[],
  runId: string,
): void {
  const fixturesById = new Map(
    documents.map((document) => [document.documentId, document.fixture]),
  );
  const compactRunId = runId.replaceAll("-", "");
  const facts = new Map<string, ProfileInspectionRow[]>();
  for (const row of rows) {
    const versions = facts.get(row.factId) ?? [];
    versions.push(row);
    facts.set(row.factId, versions);
  }
  const claimedSemantics = new Set<string>();
  for (const versions of facts.values()) {
    const first = versions[0];
    const firstEvidence = first?.evidence[0];
    if (!first || !firstEvidence) {
      throw new Error("The synthetic Profile fact has no original evidence");
    }
    const firstValue = storedJson(first.value);
    const fixture = fixturesById.get(firstEvidence.documentId);
    const semantic =
      fixture === "clean-pdf"
        ? "email"
        : firstValue === "TypeScript"
          ? "typescript"
          : firstValue === "PostgreSQL"
            ? "postgresql"
            : null;
    const expectedInitialValue =
      semantic === "email"
        ? `candidate-${compactRunId}@example.test`
        : semantic === "typescript"
          ? "TypeScript"
          : semantic === "postgresql"
            ? "PostgreSQL"
            : null;
    if (!semantic) throw new Error("The synthetic Profile semantic role is unexpected");
    if (claimedSemantics.has(semantic)) {
      throw new Error("The synthetic Profile semantic role is duplicated");
    }
    if (firstValue !== expectedInitialValue) {
      throw new Error("The synthetic Profile semantic value is unexpected");
    }
    if (
      (semantic === "email" &&
        (fixture !== "clean-pdf" || first.kind !== "identity" || first.key !== "email")) ||
      (semantic !== "email" &&
        (fixture !== "clean-docx" || first.kind !== "skill" || first.key !== "skill"))
    ) {
      throw new Error("The synthetic Profile source fixture is unexpected");
    }
    claimedSemantics.add(semantic);
    for (const row of versions.slice(1)) {
      const rowValue = storedJson(row.value);
      const evidence = row.evidence[0];
      const sameResumeEvidence =
        row.sourceType === "resume" &&
        row.evidence.length === 1 &&
        evidence?.documentId === firstEvidence.documentId &&
        evidence.documentVersion === firstEvidence.documentVersion &&
        evidence.parserVersion === firstEvidence.parserVersion;
      if (semantic === "email") {
        const validEmailReview =
          row.version === 2 &&
          rowValue === expectedInitialValue &&
          sameResumeEvidence &&
          ((row.verification === "confirmed" && row.availabilityState === "available") ||
            (row.verification === "proposed" && row.availabilityState === "invalidated"));
        const validEmailHold =
          row.version === 3 &&
          rowValue === expectedInitialValue &&
          row.verification === "confirmed" &&
          row.availabilityState === "invalidated" &&
          sameResumeEvidence;
        if (!validEmailReview && !validEmailHold) {
          throw new Error("The synthetic email decision chain is unexpected");
        }
      } else if (
        semantic === "typescript" &&
        !(
          row.version === 2 &&
          rowValue === "TypeScript (reviewed synthetic)" &&
          row.verification === "confirmed" &&
          row.sourceType === "user" &&
          row.sourceReference === `resume-correction:${row.factId}`
        )
      ) {
        throw new Error("The synthetic edited skill decision is unexpected");
      } else if (
        semantic === "postgresql" &&
        !(
          row.version === 2 &&
          rowValue === "PostgreSQL" &&
          row.verification === "rejected" &&
          sameResumeEvidence
        )
      ) {
        throw new Error("The synthetic rejected skill decision is unexpected");
      }
    }
  }
}

export class PostgresDocumentProcessingAcceptanceProfilePort
  implements DocumentProcessingAcceptanceProfilePort
{
  async resolveSyntheticUser(
    transaction: postgres.TransactionSql,
    runId: string,
    issuer: string,
  ): Promise<string | null> {
    assertIssuer(issuer);
    const subject = documentProcessingAcceptanceSubject(runId);
    const rows = await transaction<Array<{ userId: string }>>`
      SELECT user_id AS "userId"
      FROM identity.external_identities
      WHERE issuer = ${issuer} AND subject = ${subject}
    `;
    return rows[0]?.userId ?? null;
  }

  async inspect(
    transaction: postgres.TransactionSql,
    input: {
      runId: string;
      issuer: string;
      userId: string;
      phase: DocumentProcessingAcceptanceProfilePhase;
      documents: readonly DocumentProcessingAcceptanceDocumentRef[];
    },
  ): Promise<DocumentProcessingAcceptanceProfileSummary> {
    assertRunId(input.runId);
    if (!UUID_PATTERN.test(input.userId)) {
      throw new Error("The synthetic acceptance user boundary is invalid");
    }
    assertDocumentRefs(input.documents);
    const resolvedUserId = await this.resolveSyntheticUser(transaction, input.runId, input.issuer);
    if (resolvedUserId !== input.userId) {
      throw new Error("The synthetic acceptance identity does not own the claimed profile");
    }
    const cleanDocuments = input.documents.filter(
      (document) => document.fixture === "clean-pdf" || document.fixture === "clean-docx",
    );
    if (
      cleanDocuments.length !== 2 ||
      !cleanDocuments.some((document) => document.fixture === "clean-pdf") ||
      !cleanDocuments.some((document) => document.fixture === "clean-docx")
    ) {
      throw new Error("The clean proposal document boundary is incomplete");
    }
    const documentIds = cleanDocuments.map((document) => document.documentId);
    const rows = await transaction<ProfileInspectionRow[]>`
      SELECT fact.id AS "factId", version.version, version.verification,
        version.availability_state AS "availabilityState",
        version.availability_reason AS "availabilityReason",
        version.source_type AS "sourceType", version.source_reference AS "sourceReference",
        version.kind, version.fact_key AS key, version.sensitivity,
        version.fact_value #>> '{}' AS value,
        COALESCE(jsonb_agg(jsonb_build_object(
          'documentId', evidence.document_id::text,
          'documentVersion', evidence.document_version,
          'parserVersion', evidence.parser_version
        ) ORDER BY evidence.ordinal) FILTER (WHERE evidence.document_id IS NOT NULL), '[]'::jsonb)
          AS evidence
      FROM profile.profile_facts AS fact
      INNER JOIN profile.profile_fact_versions AS version ON version.fact_id = fact.id
      LEFT JOIN profile.profile_fact_evidence AS evidence
        ON evidence.fact_id = version.fact_id AND evidence.fact_version = version.version
      WHERE fact.user_id = ${input.userId}
      GROUP BY fact.id, version.version, version.verification, version.availability_state,
        version.availability_reason, version.source_type, version.source_reference,
        version.kind, version.fact_key, version.sensitivity, version.fact_value
      ORDER BY fact.id, version.version
    `;
    const allowedDocumentIds = new Set(documentIds);
    for (const row of rows) {
      const corrected =
        row.sourceType === "user" && row.sourceReference === `resume-correction:${row.factId}`;
      const exactEvidence = row.evidence.every(
        (evidence) =>
          allowedDocumentIds.has(evidence.documentId) &&
          row.sourceReference ===
            `resume:${evidence.documentId}:v${evidence.documentVersion}:${evidence.parserVersion}`,
      );
      if (
        (!corrected &&
          (row.sourceType !== "resume" || row.evidence.length !== 1 || !exactEvidence)) ||
        (corrected && row.evidence.length !== 0) ||
        !(
          (row.kind === "identity" && row.key === "email" && row.sensitivity === "confidential") ||
          (row.kind === "skill" && row.key === "skill" && row.sensitivity === "standard")
        ) ||
        (row.availabilityState === "invalidated" &&
          row.availabilityReason !== "source_security_hold")
      ) {
        throw new Error(
          "The claimed profile contains rows outside the synthetic document boundary",
        );
      }
    }
    const imports = await transaction<
      Array<{ documentId: string; documentVersion: number; parserVersion: string }>
    >`
      SELECT document_id::text AS "documentId", document_version AS "documentVersion",
        parser_version AS "parserVersion"
      FROM profile.resume_fact_imports
      WHERE user_id = ${input.userId}
      ORDER BY document_id
    `;
    if (
      imports.length !== 2 ||
      imports.some(
        (entry) =>
          !allowedDocumentIds.has(entry.documentId) ||
          entry.documentVersion !== 1 ||
          entry.parserVersion !== "resume-parser-v1",
      )
    ) {
      throw new Error("The profile imports are outside the exact clean document boundary");
    }
    const [ownedRows] = await transaction<
      Array<{ auditEventCount: number; idempotencyKeyCount: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM platform.audit_events WHERE user_id = ${input.userId})
          AS "auditEventCount",
        (SELECT count(*)::int FROM platform.idempotency_keys WHERE user_id = ${input.userId})
          AS "idempotencyKeyCount"
    `;
    if (!ownedRows) throw new Error("The Profile-owned aggregate boundary is unavailable");
    const latestByFact = new Map<string, ProfileInspectionRow>();
    for (const row of rows) latestByFact.set(row.factId, row);
    const latest = [...latestByFact.values()];
    assertExactFactSemantics(rows, cleanDocuments, input.runId);
    const summaryWithoutDigest = {
      importCount: imports.length,
      factCount: latest.length,
      versionCount: rows.length,
      evidenceCount: rows.reduce((count, row) => count + row.evidence.length, 0),
      proposedCount: latest.filter((row) => row.verification === "proposed").length,
      confirmedCount: latest.filter((row) => row.verification === "confirmed").length,
      rejectedCount: latest.filter((row) => row.verification === "rejected").length,
      invalidatedCount: latest.filter((row) => row.availabilityState === "invalidated").length,
      auditEventCount: ownedRows.auditEventCount,
      idempotencyKeyCount: ownedRows.idempotencyKeyCount,
    };
    assertProfilePhase(input.phase, summaryWithoutDigest);
    return {
      ...summaryWithoutDigest,
      canonicalSha256: canonicalSha256({
        runId: input.runId,
        phase: input.phase,
        documents: [...input.documents].sort((left, right) =>
          left.fixture.localeCompare(right.fixture),
        ),
        rows,
      }),
    };
  }

  async cleanup(
    transaction: postgres.TransactionSql,
    input: {
      runId: string;
      issuer: string;
      userId: string;
      documents: readonly DocumentProcessingAcceptanceDocumentRef[];
    },
  ): Promise<DocumentProcessingAcceptanceProfileCleanup> {
    assertRunId(input.runId);
    if (!UUID_PATTERN.test(input.userId)) {
      throw new Error("The synthetic acceptance user boundary is invalid");
    }
    assertDocumentRefs(input.documents);
    const userRows = await transaction<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM identity.users
      WHERE id = ${input.userId}
      FOR UPDATE
    `;
    if (userRows.length !== 1 || userRows[0]?.id !== input.userId) {
      throw new Error("Cleanup refused an unavailable synthetic user boundary");
    }
    const cleanDocuments = input.documents.filter(
      (document) => document.fixture === "clean-pdf" || document.fixture === "clean-docx",
    );
    const cleanDocumentIds = new Set(cleanDocuments.map((document) => document.documentId));
    const imports = await transaction<
      Array<{
        documentId: string;
        documentVersion: number;
        parserVersion: string;
        proposalCount: number;
      }>
    >`
      SELECT document_id::text AS "documentId", document_version AS "documentVersion",
        parser_version AS "parserVersion", proposal_count AS "proposalCount"
      FROM profile.resume_fact_imports
      WHERE user_id = ${input.userId}
      ORDER BY document_id
    `;
    for (const row of imports) {
      const fixture = cleanDocuments.find(
        (document) => document.documentId === row.documentId,
      )?.fixture;
      if (
        !cleanDocumentIds.has(row.documentId) ||
        row.documentVersion !== 1 ||
        row.parserVersion !== "resume-parser-v1" ||
        row.proposalCount !== (fixture === "clean-pdf" ? 1 : 2)
      ) {
        throw new Error("Cleanup refused an unrelated Profile import");
      }
    }
    const rows = await transaction<ProfileInspectionRow[]>`
      SELECT fact.id AS "factId", version.version, version.verification,
        version.availability_state AS "availabilityState",
        version.availability_reason AS "availabilityReason",
        version.source_type AS "sourceType", version.source_reference AS "sourceReference",
        version.kind, version.fact_key AS key, version.sensitivity,
        version.fact_value #>> '{}' AS value,
        COALESCE(jsonb_agg(jsonb_build_object(
          'documentId', evidence.document_id::text,
          'documentVersion', evidence.document_version,
          'parserVersion', evidence.parser_version
        ) ORDER BY evidence.ordinal) FILTER (WHERE evidence.document_id IS NOT NULL), '[]'::jsonb)
          AS evidence
      FROM profile.profile_facts AS fact
      INNER JOIN profile.profile_fact_versions AS version ON version.fact_id = fact.id
      LEFT JOIN profile.profile_fact_evidence AS evidence
        ON evidence.fact_id = version.fact_id AND evidence.fact_version = version.version
      WHERE fact.user_id = ${input.userId}
      GROUP BY fact.id, version.version, version.verification, version.availability_state,
        version.availability_reason, version.source_type, version.source_reference,
        version.kind, version.fact_key, version.sensitivity, version.fact_value
      ORDER BY fact.id, version.version
    `;
    const byFact = new Map<string, ProfileInspectionRow[]>();
    for (const row of rows) {
      const versions = byFact.get(row.factId) ?? [];
      versions.push(row);
      byFact.set(row.factId, versions);
    }
    assertExactFactSemantics(rows, cleanDocuments, input.runId);
    if (
      byFact.size !== imports.reduce((count, row) => count + row.proposalCount, 0) ||
      byFact.size > 3
    ) {
      throw new Error("Cleanup refused an unexpected Profile fact cardinality");
    }
    for (const versions of byFact.values()) {
      if (versions.length < 1 || versions.length > 3) {
        throw new Error("Cleanup refused an unexpected Profile version cardinality");
      }
      for (const [offset, row] of versions.entries()) {
        const expectedVersion = offset + 1;
        const evidence = row.evidence[0];
        const resumeSource =
          row.sourceType === "resume" &&
          row.evidence.length === 1 &&
          evidence !== undefined &&
          cleanDocumentIds.has(evidence.documentId) &&
          row.sourceReference ===
            `resume:${evidence.documentId}:v${evidence.documentVersion}:${evidence.parserVersion}`;
        const correction =
          row.sourceType === "user" &&
          row.sourceReference === `resume-correction:${row.factId}` &&
          row.evidence.length === 0;
        const validShape =
          (row.kind === "identity" && row.key === "email" && row.sensitivity === "confidential") ||
          (row.kind === "skill" && row.key === "skill" && row.sensitivity === "standard");
        const validState =
          expectedVersion === 1
            ? row.verification === "proposed" &&
              row.availabilityState === "available" &&
              resumeSource
            : expectedVersion === 2
              ? ((row.verification === "confirmed" || row.verification === "rejected") &&
                  row.availabilityState === "available" &&
                  (resumeSource || correction)) ||
                (row.verification === "proposed" &&
                  row.availabilityState === "invalidated" &&
                  row.availabilityReason === "source_security_hold" &&
                  resumeSource)
              : (row.verification === "confirmed" || row.verification === "rejected") &&
                row.availabilityState === "invalidated" &&
                row.availabilityReason === "source_security_hold" &&
                resumeSource;
        if (row.version !== expectedVersion || !validShape || !validState) {
          throw new Error("Cleanup refused a Profile fact outside the recoverable lifecycle");
        }
      }
    }
    const subject = documentProcessingAcceptanceSubject(input.runId);
    const identities = await transaction<
      Array<{ issuer: string; subject: string; email: string | null }>
    >`
      SELECT issuer, subject, email
      FROM identity.external_identities
      WHERE user_id = ${input.userId}
      ORDER BY issuer, subject
      FOR UPDATE
    `;
    if (
      identities.length !== 1 ||
      identities[0]?.issuer !== input.issuer ||
      identities[0]?.subject !== subject ||
      identities[0].email !== null
    ) {
      throw new Error("Cleanup refused a user with an unrelated identity");
    }
    const [unrelatedState] = await transaction<
      Array<{ jobPreferenceCount: number; operationCount: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM profile.job_preferences WHERE user_id = ${input.userId})
          AS "jobPreferenceCount",
        (SELECT count(*)::int FROM platform.operations WHERE user_id = ${input.userId})
          AS "operationCount"
    `;
    if (unrelatedState?.jobPreferenceCount !== 0 || unrelatedState.operationCount !== 0) {
      throw new Error("Cleanup refused unrelated Profile-owned user state");
    }
    const audits = await transaction<
      Array<{
        action: string;
        resourceType: string;
        resourceId: string | null;
        metadata: unknown;
      }>
    >`
      SELECT action, resource_type AS "resourceType", resource_id::text AS "resourceId", metadata
      FROM platform.audit_events
      WHERE user_id = ${input.userId}
      ORDER BY occurred_at, id
    `;
    const reviewedRows = rows.filter(
      (row) =>
        row.version === 2 &&
        row.availabilityState === "available" &&
        (row.verification === "confirmed" || row.verification === "rejected"),
    );
    const invalidatedRows = rows.filter((row) => row.availabilityState === "invalidated");
    const cleanPdfDocumentId = cleanDocuments.find(
      (document) => document.fixture === "clean-pdf",
    )?.documentId;
    const expectedAuditKeys = new Set<string>([
      `identity.linked:user:${input.userId}`,
      ...imports.map(
        (row) => `profile.resume.proposals.imported:resume_document:${row.documentId}`,
      ),
      ...reviewedRows.map((row) => `profile.fact.version.created:profile_fact:${row.factId}`),
      ...(invalidatedRows.length > 0 && cleanPdfDocumentId
        ? [`profile.resume.proposals.security-held:resume_document:${cleanPdfDocumentId}`]
        : []),
    ]);
    const actualAuditKeys = new Set<string>();
    for (const audit of audits) {
      const key = `${audit.action}:${audit.resourceType}:${audit.resourceId ?? ""}`;
      const metadata = storedJson(audit.metadata) as Record<string, unknown> | null;
      const imported = imports.find((row) => row.documentId === audit.resourceId);
      const validMetadata =
        audit.action === "identity.linked"
          ? metadata?.issuer === input.issuer
          : audit.action === "profile.resume.proposals.imported"
            ? imported !== undefined &&
              metadata?.documentVersion === 1 &&
              metadata.parserVersion === "resume-parser-v1" &&
              metadata.proposalCount === imported.proposalCount
            : audit.action === "profile.fact.version.created"
              ? metadata?.version === 2
              : audit.action === "profile.resume.proposals.security-held"
                ? metadata?.rejectedProposalCount === 1
                : false;
      if (!expectedAuditKeys.has(key) || actualAuditKeys.has(key) || !validMetadata) {
        throw new Error("Cleanup refused an unrelated or duplicate Profile audit row");
      }
      actualAuditKeys.add(key);
    }
    if (
      actualAuditKeys.size !== expectedAuditKeys.size ||
      [...expectedAuditKeys].some((key) => !actualAuditKeys.has(key))
    ) {
      throw new Error("Cleanup refused an incomplete Profile audit boundary");
    }
    const idempotency = await transaction<Array<{ scope: string; response: unknown }>>`
      SELECT scope, response
      FROM platform.idempotency_keys
      WHERE user_id = ${input.userId}
      ORDER BY scope, key
    `;
    const expectedUpdates = new Map(reviewedRows.map((row) => [row.factId, row]));
    const claimedUpdates = new Set<string>();
    for (const entry of idempotency) {
      const factId = entry.scope.startsWith("profile.fact.update.v1:")
        ? entry.scope.slice("profile.fact.update.v1:".length)
        : "";
      const expected = expectedUpdates.get(factId);
      const response = storedJson(entry.response) as Record<string, unknown> | null;
      if (
        !expected ||
        claimedUpdates.has(factId) ||
        response?.id !== factId ||
        response.version !== 2 ||
        response.verification !== expected.verification
      ) {
        throw new Error("Cleanup refused an unrelated Profile idempotency row");
      }
      claimedUpdates.add(factId);
    }
    if (
      claimedUpdates.size !== expectedUpdates.size ||
      [...expectedUpdates.keys()].some((factId) => !claimedUpdates.has(factId))
    ) {
      throw new Error("Cleanup refused an incomplete Profile idempotency boundary");
    }
    const auditEvents = await transaction`
      DELETE FROM platform.audit_events
      WHERE user_id = ${input.userId}
    `;
    const idempotencyKeys = await transaction`
      DELETE FROM platform.idempotency_keys
      WHERE user_id = ${input.userId}
    `;
    const users = await transaction`
      DELETE FROM identity.users
      WHERE id = ${input.userId}
        AND EXISTS (
          SELECT 1 FROM identity.external_identities
          WHERE user_id = ${input.userId} AND issuer = ${input.issuer} AND subject = ${subject}
        )
    `;
    if (users.count !== 1) {
      throw new Error("Cleanup did not remove the exact synthetic identity");
    }
    return {
      auditEventCount: auditEvents.count,
      idempotencyKeyCount: idempotencyKeys.count,
      userCount: users.count,
    };
  }
}
