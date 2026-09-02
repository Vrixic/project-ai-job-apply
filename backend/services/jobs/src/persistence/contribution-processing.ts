import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import type {
  ContributionProcessingQueueItem,
  ContributionProcessingQueueStore,
} from "../contribution-processing-runner.js";
import type {
  ContributionOwnerReasonCode,
  ContributionOwnerState,
  ContributionProcessingStore,
  ContributionPublicationReconciler,
  IndependentVerificationEvidence,
  LoadedContributionProcessing,
  PreparedPublicationReconciliation,
  PreparedTerminalReconciliation,
  TrustContributionDecision,
} from "../contribution-processing.js";
import type { NormalizedContributionProposal } from "../contribution-processing-policy.js";

interface LoadedRow {
  contributionId: string;
  ownerUserId: string;
  payload: LoadedContributionProcessing["input"];
  clientSurface: "browser_extension" | null;
  clientVersion: string | null;
  intakeState: "queued";
  state: ContributionOwnerState | null;
  normalizationId: string | null;
  proposalSha256: string | null;
  normalizedCompanyName: string | null;
  normalizedTitle: string | null;
  normalizedLocations: unknown;
  normalizedDescriptionSha256: string | null;
  normalizedDepartment: string | null;
  applicationUrlSha256: string | null;
  employmentType: NormalizedContributionProposal["employmentType"] | null;
  workMode: NormalizedContributionProposal["workMode"] | null;
  exactIdentityKeys: unknown;
  fuzzyFingerprintSha256: string | null;
  provider: NormalizedContributionProposal["provenance"]["provider"] | null;
  pageVariant: NormalizedContributionProposal["provenance"]["pageVariant"] | null;
  canonicalSourceUrl: string | null;
  canonicalSourceUrlSha256: string | null;
  atsTenant: string | null;
  externalJobId: string | null;
  adapterVersion: string | null;
  contributedContentSha256: string | null;
  observedAt: Date | string | null;
  verificationId: string | null;
  verificationJobId: string | null;
  verificationSourceId: string | null;
  evidenceDigestSha256: string | null;
  verifiedContentSha256: string | null;
  sourcePolicyVersion: string | null;
  verifiedAt: Date | string | null;
  trustStatus: "accepted" | "rejected" | "withdrawn" | "taken_down" | null;
  trustDecisionId: string | null;
  trustPolicyVersion: string | null;
  trustDecidedAt: Date | string | null;
  publicationReconciliationId: string | null;
  publicationJobId: string | null;
  publicationSourceId: string | null;
  publicationVerificationId: string | null;
}

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Malformed processing timestamp");
  return parsed.toISOString();
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Malformed ${label}`);
  }
  return Object.freeze([...value]);
}

function loaded(row: LoadedRow): LoadedContributionProcessing {
  let normalization: LoadedContributionProcessing["normalization"];
  if (row.normalizationId) {
    if (
      !row.proposalSha256 ||
      !row.normalizedTitle ||
      !row.fuzzyFingerprintSha256 ||
      !row.provider ||
      !row.pageVariant ||
      !row.canonicalSourceUrl ||
      !row.canonicalSourceUrlSha256 ||
      !row.atsTenant ||
      !row.adapterVersion ||
      !row.contributedContentSha256 ||
      !row.observedAt
    ) {
      throw new Error("Malformed persisted contribution normalization");
    }
    normalization = {
      id: row.normalizationId,
      proposal: Object.freeze({
        schemaVersion: 1,
        ...(row.normalizedCompanyName ? { normalizedCompanyName: row.normalizedCompanyName } : {}),
        normalizedTitle: row.normalizedTitle,
        normalizedLocations: stringArray(row.normalizedLocations, "normalized locations"),
        ...(row.normalizedDescriptionSha256
          ? { normalizedDescriptionSha256: row.normalizedDescriptionSha256 }
          : {}),
        ...(row.normalizedDepartment ? { normalizedDepartment: row.normalizedDepartment } : {}),
        ...(row.applicationUrlSha256 ? { applicationUrlSha256: row.applicationUrlSha256 } : {}),
        ...(row.employmentType ? { employmentType: row.employmentType } : {}),
        ...(row.workMode ? { workMode: row.workMode } : {}),
        provenance: Object.freeze({
          provider: row.provider,
          pageVariant: row.pageVariant,
          canonicalSourceUrl: row.canonicalSourceUrl,
          canonicalSourceUrlSha256: row.canonicalSourceUrlSha256,
          atsTenant: row.atsTenant,
          ...(row.externalJobId ? { externalJobId: row.externalJobId } : {}),
          adapterVersion: row.adapterVersion,
          contributedContentSha256: row.contributedContentSha256,
          observedAt: timestamp(row.observedAt),
        }),
        dedupe: Object.freeze({
          exactIdentityKeys: stringArray(row.exactIdentityKeys, "exact identity keys"),
          fuzzyFingerprintSha256: row.fuzzyFingerprintSha256,
        }),
        proposalSha256: row.proposalSha256,
      }),
    };
  }

  let independentVerification: IndependentVerificationEvidence | undefined;
  if (row.verificationId) {
    if (
      !row.verificationJobId ||
      !row.verificationSourceId ||
      !row.provider ||
      !row.pageVariant ||
      !row.canonicalSourceUrlSha256 ||
      !row.evidenceDigestSha256 ||
      !row.verifiedContentSha256 ||
      !row.sourcePolicyVersion ||
      !row.verifiedAt
    ) {
      throw new Error("Malformed persisted independent verification");
    }
    independentVerification = Object.freeze({
      status: "verified",
      origin: "independent_provider_fetch",
      contributionId: row.contributionId,
      verificationId: row.verificationId,
      jobId: row.verificationJobId,
      sourceId: row.verificationSourceId,
      provider: row.provider,
      pageVariant: row.pageVariant,
      canonicalSourceUrlSha256: row.canonicalSourceUrlSha256,
      evidenceDigestSha256: row.evidenceDigestSha256,
      verifiedContentSha256: row.verifiedContentSha256,
      sourcePolicyVersion: row.sourcePolicyVersion,
      verifiedAt: timestamp(row.verifiedAt),
    });
  }

  let trustDecision: LoadedContributionProcessing["trustDecision"];
  if (row.trustStatus) {
    if (!row.trustDecisionId || !row.trustPolicyVersion || !row.trustDecidedAt) {
      throw new Error("Malformed persisted Trust decision");
    }
    trustDecision = Object.freeze({
      status: row.trustStatus,
      contributionId: row.contributionId,
      decisionId: row.trustDecisionId,
      policyVersion: row.trustPolicyVersion,
      decidedAt: timestamp(row.trustDecidedAt),
    });
  }

  return Object.freeze({
    contributionId: row.contributionId,
    ownerUserId: row.ownerUserId,
    input: structuredClone(row.payload),
    ...(row.clientSurface ? { clientSurface: row.clientSurface } : {}),
    ...(row.clientVersion ? { clientVersion: row.clientVersion } : {}),
    ownerState: row.state ?? row.intakeState,
    ...(normalization ? { normalization } : {}),
    ...(independentVerification ? { independentVerification } : {}),
    ...(trustDecision ? { trustDecision } : {}),
    ...(row.publicationReconciliationId &&
    row.publicationJobId &&
    row.publicationSourceId &&
    row.publicationVerificationId
      ? {
          publication: Object.freeze({
            reconciliationId: row.publicationReconciliationId,
            jobId: row.publicationJobId,
            sourceId: row.publicationSourceId,
            verificationId: row.publicationVerificationId,
          }),
        }
      : {}),
  });
}

async function loadWith(
  client: postgres.Sql | postgres.TransactionSql,
  contributionId: string,
): Promise<LoadedContributionProcessing | null> {
  const [row] = await client<LoadedRow[]>`
    SELECT
      contribution.id AS "contributionId", contribution.owner_user_id AS "ownerUserId",
      contribution.payload, contribution.client_surface AS "clientSurface",
      contribution.client_version AS "clientVersion", contribution.state AS "intakeState",
      state_event.state,
      normalization.id AS "normalizationId", normalization.proposal_sha256 AS "proposalSha256",
      normalization.normalized_company_name AS "normalizedCompanyName",
      normalization.normalized_title AS "normalizedTitle",
      normalization.normalized_locations AS "normalizedLocations",
      normalization.normalized_description_sha256 AS "normalizedDescriptionSha256",
      normalization.normalized_department AS "normalizedDepartment",
      normalization.application_url_sha256 AS "applicationUrlSha256",
      normalization.employment_type AS "employmentType", normalization.work_mode AS "workMode",
      normalization.exact_identity_keys AS "exactIdentityKeys",
      normalization.fuzzy_fingerprint_sha256 AS "fuzzyFingerprintSha256",
      normalization.provider, normalization.page_variant AS "pageVariant",
      normalization.canonical_source_url AS "canonicalSourceUrl",
      normalization.canonical_source_url_sha256 AS "canonicalSourceUrlSha256",
      normalization.ats_tenant AS "atsTenant", normalization.external_job_id AS "externalJobId",
      normalization.adapter_version AS "adapterVersion",
      normalization.contributed_content_sha256 AS "contributedContentSha256",
      normalization.observed_at AS "observedAt",
      verification.id AS "verificationId", verification.job_id AS "verificationJobId",
      verification.source_id AS "verificationSourceId",
      verification.evidence_digest_sha256 AS "evidenceDigestSha256",
      verification.verified_content_sha256 AS "verifiedContentSha256",
      verification.source_policy_version AS "sourcePolicyVersion",
      verification.verified_at AS "verifiedAt",
      trust.status AS "trustStatus", trust.id AS "trustDecisionId",
      trust.trust_policy_version AS "trustPolicyVersion", trust.decided_at AS "trustDecidedAt",
      publication.id AS "publicationReconciliationId", publication.job_id AS "publicationJobId",
      publication.source_id AS "publicationSourceId",
      publication.independent_verification_id AS "publicationVerificationId"
    FROM jobs.job_contributions AS contribution
    LEFT JOIN jobs.job_contribution_normalizations AS normalization
      ON normalization.contribution_id = contribution.id
    LEFT JOIN jobs.job_contribution_independent_verifications AS verification
      ON verification.contribution_id = contribution.id
    LEFT JOIN LATERAL (
      SELECT event.state FROM jobs.job_contribution_state_events AS event
      WHERE event.contribution_id = contribution.id
      ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1
    ) AS state_event ON true
    LEFT JOIN LATERAL (
      SELECT decision.id, decision.status, decision.trust_policy_version, decision.decided_at
      FROM jobs.job_contribution_trust_decisions AS decision
      WHERE decision.contribution_id = contribution.id
      ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
    ) AS trust ON true
    LEFT JOIN jobs.job_contribution_reconciliations AS publication
      ON publication.contribution_id = contribution.id
      AND publication.kind = 'publication' AND publication.state = 'applied'
    WHERE contribution.id = ${contributionId}
  `;
  return row ? loaded(row) : null;
}

async function insertState(
  client: postgres.Sql | postgres.TransactionSql,
  input: {
    contributionId: string;
    state: ContributionOwnerState;
    reasonCode: ContributionOwnerReasonCode;
    processingPolicyVersion: string;
    occurredAt: Date;
  },
): Promise<void> {
  await client`
    INSERT INTO jobs.job_contribution_state_events (
      id, contribution_id, state, reason_code, processing_policy_version, occurred_at
    ) VALUES (
      ${uuidv7()}, ${input.contributionId}, ${input.state}, ${input.reasonCode},
      ${input.processingPolicyVersion}, ${input.occurredAt}
    ) ON CONFLICT (contribution_id, state, reason_code) DO NOTHING
  `;
}

async function insertProcessingEvent(
  client: postgres.Sql | postgres.TransactionSql,
  input: {
    contributionId: string;
    eventType: "job.normalized.v1" | "job.verified.v1";
    data: postgres.JSONValue;
    occurredAt: Date;
  },
): Promise<void> {
  const proposedEventId = uuidv7();
  const [created] = await client<{ id: string }[]>`
    INSERT INTO jobs.job_contribution_processing_outbox (
      id, contribution_id, event_type, subject, data, created_at
    ) VALUES (
      ${proposedEventId}, ${input.contributionId}, ${input.eventType}, ${input.contributionId},
      ${client.json(input.data)}, ${input.occurredAt}
    ) ON CONFLICT (contribution_id, event_type) DO NOTHING
    RETURNING id
  `;
  let eventId = created?.id;
  if (!eventId) {
    const [existing] = await client<{ id: string; exact: boolean }[]>`
      SELECT id, subject = ${input.contributionId}
        AND data = ${client.json(input.data)} AS exact
      FROM jobs.job_contribution_processing_outbox
      WHERE contribution_id = ${input.contributionId} AND event_type = ${input.eventType}
    `;
    if (!existing?.exact) throw new Error("Contribution processing event replay changed");
    eventId = existing.id;
  }
  await client`
    INSERT INTO jobs.job_contribution_processing_event_deliveries (
      event_id, state, attempt, available_at, created_at, updated_at
    ) VALUES (
      ${eventId}, 'pending', 0, ${input.occurredAt}, ${input.occurredAt}, ${input.occurredAt}
    ) ON CONFLICT (event_id) DO NOTHING
  `;
}

export class PostgresContributionProcessingStore implements ContributionProcessingStore {
  constructor(private readonly client: postgres.Sql) {}

  load(contributionId: string): Promise<LoadedContributionProcessing | null> {
    return loadWith(this.client, contributionId);
  }

  async recordOwnerState(
    input: Parameters<ContributionProcessingStore["recordOwnerState"]>[0],
  ): Promise<LoadedContributionProcessing> {
    return this.client.begin(async (transaction) => {
      await insertState(transaction, input);
      const value = await loadWith(transaction, input.contributionId);
      if (!value) throw new Error("Contribution disappeared during state recording");
      return value;
    });
  }

  async recordNormalization(
    input: Parameters<ContributionProcessingStore["recordNormalization"]>[0],
  ): Promise<LoadedContributionProcessing> {
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-processing:${input.contributionId}`}))
      `;
      const proposal = input.proposal;
      const provenance = proposal.provenance;
      const [existing] = await transaction<{ proposalSha256: string }[]>`
        SELECT proposal_sha256 AS "proposalSha256"
        FROM jobs.job_contribution_normalizations
        WHERE contribution_id = ${input.contributionId}
      `;
      if (existing && existing.proposalSha256 !== proposal.proposalSha256) {
        throw new Error("Contribution normalization replay changed");
      }
      if (!existing) {
        const normalizationId = uuidv7();
        await transaction`
          INSERT INTO jobs.job_contribution_normalizations (
            id, contribution_id, proposal_sha256, normalized_company_name, normalized_title,
            normalized_locations, normalized_description_sha256, normalized_department,
            application_url_sha256, employment_type, work_mode, exact_identity_keys,
            fuzzy_fingerprint_sha256, provider, page_variant, canonical_source_url,
            canonical_source_url_sha256, ats_tenant, external_job_id, adapter_version,
            contributed_content_sha256, observed_at, processing_policy_version, created_at
          ) VALUES (
            ${normalizationId}, ${input.contributionId}, ${proposal.proposalSha256},
            ${proposal.normalizedCompanyName ?? null}, ${proposal.normalizedTitle},
            ${transaction.json([...proposal.normalizedLocations])},
            ${proposal.normalizedDescriptionSha256 ?? null},
            ${proposal.normalizedDepartment ?? null}, ${proposal.applicationUrlSha256 ?? null},
            ${proposal.employmentType ?? null}, ${proposal.workMode ?? null},
            ${transaction.json([...proposal.dedupe.exactIdentityKeys])},
            ${proposal.dedupe.fuzzyFingerprintSha256}, ${provenance.provider},
            ${provenance.pageVariant}, ${provenance.canonicalSourceUrl},
            ${provenance.canonicalSourceUrlSha256}, ${provenance.atsTenant},
            ${provenance.externalJobId ?? null}, ${provenance.adapterVersion},
            ${provenance.contributedContentSha256}, ${provenance.observedAt},
            ${input.processingPolicyVersion}, ${input.occurredAt}
          )
        `;
        await insertProcessingEvent(transaction, {
          contributionId: input.contributionId,
          eventType: "job.normalized.v1",
          data: { contributionId: input.contributionId, normalizationId },
          occurredAt: input.occurredAt,
        });
      }
      await insertState(transaction, {
        contributionId: input.contributionId,
        state: "normalized",
        reasonCode: "normalization_complete",
        processingPolicyVersion: input.processingPolicyVersion,
        occurredAt: input.occurredAt,
      });
      const value = await loadWith(transaction, input.contributionId);
      if (!value) throw new Error("Contribution disappeared during normalization");
      return value;
    });
  }

  async recordIndependentVerification(
    input: Parameters<ContributionProcessingStore["recordIndependentVerification"]>[0],
  ): Promise<LoadedContributionProcessing> {
    return this.client.begin(async (transaction) => {
      const evidence = input.evidence;
      const [sourceEvidence] = await transaction<{ valid: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM jobs.source_verification_evidence AS evidence
          JOIN jobs.job_sources AS source
            ON source.id = evidence.source_id AND source.job_id = evidence.job_id
          JOIN jobs.job_contribution_normalizations AS normalization
            ON normalization.contribution_id = ${input.contributionId}
          WHERE evidence.id = ${evidence.verificationId}
            AND evidence.evidence_kind = 'independent_positive_verification'
            AND evidence.job_id = ${evidence.jobId}
            AND evidence.source_id = ${evidence.sourceId}
            AND evidence.provider = ${evidence.provider}
            AND evidence.page_variant = ${evidence.pageVariant}
            AND evidence.evidence_digest_sha256 = ${evidence.evidenceDigestSha256}
            AND evidence.policy_version = ${evidence.sourcePolicyVersion}
            AND evidence.verified_at = ${evidence.verifiedAt}
            AND source.provider = ${evidence.provider}
            AND normalization.provider = ${evidence.provider}
            AND normalization.page_variant = ${evidence.pageVariant}
            AND normalization.canonical_source_url_sha256 = ${evidence.canonicalSourceUrlSha256}
        ) AS valid
      `;
      if (!sourceEvidence?.valid)
        throw new Error("Independent verification does not bind Jobs truth");
      const normalization = await loadWith(transaction, input.contributionId);
      if (!normalization?.normalization) throw new Error("Normalization is required");
      await transaction`
        INSERT INTO jobs.job_contribution_independent_verifications (
          id, contribution_id, normalization_id, job_id, source_id, provider, page_variant,
          canonical_source_url_sha256, evidence_digest_sha256, verified_content_sha256,
          source_policy_version, verified_at, processing_policy_version, created_at
        ) VALUES (
          ${evidence.verificationId}, ${input.contributionId}, ${normalization.normalization.id},
          ${evidence.jobId}, ${evidence.sourceId}, ${evidence.provider}, ${evidence.pageVariant},
          ${evidence.canonicalSourceUrlSha256}, ${evidence.evidenceDigestSha256},
          ${evidence.verifiedContentSha256}, ${evidence.sourcePolicyVersion},
          ${evidence.verifiedAt}, ${input.processingPolicyVersion}, ${input.occurredAt}
        ) ON CONFLICT (contribution_id) DO NOTHING
      `;
      await insertState(transaction, {
        contributionId: input.contributionId,
        state: "independently_verified",
        reasonCode: "independent_verification_complete",
        processingPolicyVersion: input.processingPolicyVersion,
        occurredAt: input.occurredAt,
      });
      const value = await loadWith(transaction, input.contributionId);
      if (!value) throw new Error("Contribution disappeared during verification");
      return value;
    });
  }

  async recordTrustDecision(
    input: Parameters<ContributionProcessingStore["recordTrustDecision"]>[0],
  ): Promise<LoadedContributionProcessing> {
    return this.client.begin(async (transaction) => {
      const decision = input.decision;
      await transaction`
        INSERT INTO jobs.job_contribution_trust_decisions (
          id, contribution_id, status, trust_policy_version,
          processing_policy_version, decided_at, created_at
        ) VALUES (
          ${decision.decisionId}, ${input.contributionId}, ${decision.status},
          ${decision.policyVersion}, ${input.processingPolicyVersion},
          ${decision.decidedAt}, ${input.occurredAt}
        ) ON CONFLICT (id) DO NOTHING
      `;
      await transaction`
        UPDATE jobs.job_contribution_processing_queue
        SET state = 'pending', attempt = 0, available_at = ${input.occurredAt},
          last_error_code = NULL, updated_at = ${input.occurredAt}
        WHERE contribution_id = ${input.contributionId} AND state = 'parked'
      `;
      const transition = trustTransition(decision);
      await insertState(transaction, {
        contributionId: input.contributionId,
        ...transition,
        processingPolicyVersion: input.processingPolicyVersion,
        occurredAt: input.occurredAt,
      });
      const value = await loadWith(transaction, input.contributionId);
      if (!value) throw new Error("Contribution disappeared during Trust recording");
      return value;
    });
  }

  async preparePublication(
    input: Parameters<ContributionProcessingStore["preparePublication"]>[0],
  ): Promise<PreparedPublicationReconciliation> {
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-reconcile:${input.contributionId}`}))
      `;
      const [gates] = await transaction<
        {
          normalizationId: string;
          verificationId: string;
          jobId: string;
          sourceId: string;
          trustDecisionId: string;
        }[]
      >`
        SELECT normalization.id AS "normalizationId", verification.id AS "verificationId",
          verification.job_id AS "jobId", verification.source_id AS "sourceId",
          trust.id AS "trustDecisionId"
        FROM jobs.job_contributions AS contribution
        JOIN jobs.job_contribution_normalizations AS normalization
          ON normalization.contribution_id = contribution.id
        JOIN jobs.job_contribution_independent_verifications AS verification
          ON verification.contribution_id = contribution.id
        JOIN LATERAL (
          SELECT decision.id, decision.status
          FROM jobs.job_contribution_trust_decisions AS decision
          WHERE decision.contribution_id = contribution.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ) AS trust ON trust.status = 'accepted'
        JOIN jobs.source_verification_evidence AS evidence
          ON evidence.id = verification.id
          AND evidence.evidence_kind = 'independent_positive_verification'
          AND evidence.job_id = verification.job_id AND evidence.source_id = verification.source_id
        WHERE contribution.id = ${input.contributionId}
          AND contribution.client_surface = 'browser_extension'
          AND contribution.client_version IS NOT NULL
          AND contribution.payload #>> '{client,surface}' = contribution.client_surface
          AND contribution.payload #>> '{client,version}' = contribution.client_version
      `;
      if (!gates) throw new Error("Publication gates are not complete");
      const [existing] = await transaction<PreparedPublicationReconciliation[]>`
        SELECT id AS "reconciliationId", contribution_id AS "contributionId",
          normalization_id AS "normalizationId",
          independent_verification_id AS "independentVerificationId",
          job_id AS "jobId", source_id AS "sourceId", trust_decision_id AS "trustDecisionId",
          processing_policy_version AS "processingPolicyVersion",
          capability_policy_version AS "capabilityPolicyVersion",
          capability_configuration_digest_sha256 AS "capabilityConfigurationDigestSha256",
          capability_evaluated_at AS "capabilityEvaluatedAt",
          capability_expires_at AS "capabilityExpiresAt"
        FROM jobs.job_contribution_reconciliations
        WHERE contribution_id = ${input.contributionId} AND kind = 'publication'
      `;
      if (existing) {
        if (
          existing.processingPolicyVersion !== input.processingPolicyVersion ||
          existing.capabilityPolicyVersion !== input.capabilityPolicyVersion ||
          existing.capabilityConfigurationDigestSha256 !== input.capabilityConfigurationDigestSha256
        ) {
          throw new Error("Publication policy changed after preparation");
        }
        return existing;
      }
      const command = {
        reconciliationId: uuidv7(),
        contributionId: input.contributionId,
        normalizationId: gates.normalizationId,
        independentVerificationId: gates.verificationId,
        jobId: gates.jobId,
        sourceId: gates.sourceId,
        trustDecisionId: gates.trustDecisionId,
        processingPolicyVersion: input.processingPolicyVersion,
        capabilityPolicyVersion: input.capabilityPolicyVersion,
        capabilityConfigurationDigestSha256: input.capabilityConfigurationDigestSha256,
        capabilityEvaluatedAt: input.capabilityEvaluatedAt,
        capabilityExpiresAt: input.capabilityExpiresAt,
      };
      await transaction`
        INSERT INTO jobs.job_contribution_reconciliations (
          id, contribution_id, kind, state, normalization_id, independent_verification_id,
          trust_decision_id, job_id, source_id, terminal_reason, processing_policy_version,
          capability_policy_version, capability_configuration_digest_sha256,
          capability_evaluated_at, capability_expires_at,
          created_at, updated_at
        ) VALUES (
          ${command.reconciliationId}, ${command.contributionId}, 'publication', 'prepared',
          ${command.normalizationId}, ${command.independentVerificationId},
          ${command.trustDecisionId}, ${command.jobId}, ${command.sourceId}, NULL,
          ${command.processingPolicyVersion}, ${command.capabilityPolicyVersion},
          ${command.capabilityConfigurationDigestSha256}, ${command.capabilityEvaluatedAt},
          ${command.capabilityExpiresAt}, ${input.occurredAt}, ${input.occurredAt}
        )
      `;
      return Object.freeze(command);
    });
  }

  async completePublication(
    input: Parameters<ContributionProcessingStore["completePublication"]>[0],
  ): Promise<LoadedContributionProcessing> {
    return this.client.begin(async (transaction) => {
      if (
        input.result.jobId !== input.command.jobId ||
        input.result.sourceId !== input.command.sourceId ||
        input.result.verificationId !== input.command.independentVerificationId
      ) {
        throw new Error("Publication result changed reconciliation identity");
      }
      await transaction`
        UPDATE jobs.job_contribution_reconciliations SET
          state = 'applied', updated_at = ${input.occurredAt}
        WHERE id = ${input.command.reconciliationId}
          AND contribution_id = ${input.command.contributionId}
          AND kind = 'publication' AND state = 'prepared'
      `;
      await insertState(transaction, {
        contributionId: input.command.contributionId,
        state: "published",
        reasonCode: "publication_complete",
        processingPolicyVersion: input.command.processingPolicyVersion,
        occurredAt: input.occurredAt,
      });
      await insertProcessingEvent(transaction, {
        contributionId: input.command.contributionId,
        eventType: "job.verified.v1",
        data: {
          jobId: input.result.jobId,
          sourceId: input.result.sourceId,
          verificationId: input.result.verificationId,
        },
        occurredAt: input.occurredAt,
      });
      const value = await loadWith(transaction, input.command.contributionId);
      if (!value) throw new Error("Contribution disappeared during publication");
      return value;
    });
  }

  async prepareTerminalReconciliation(
    input: Parameters<ContributionProcessingStore["prepareTerminalReconciliation"]>[0],
  ): Promise<PreparedTerminalReconciliation | null> {
    return this.client.begin(async (transaction) => {
      const [publication] = await transaction<
        {
          normalizationId: string;
          verificationId: string;
          jobId: string;
          sourceId: string;
          trustDecisionId: string;
          capabilityPolicyVersion: string;
          capabilityDigest: string;
          capabilityEvaluatedAt: Date | string;
          capabilityExpiresAt: Date | string;
        }[]
      >`
        SELECT publication.normalization_id AS "normalizationId",
          publication.independent_verification_id AS "verificationId",
          publication.job_id AS "jobId", publication.source_id AS "sourceId",
          trust.id AS "trustDecisionId",
          publication.capability_policy_version AS "capabilityPolicyVersion",
          publication.capability_configuration_digest_sha256 AS "capabilityDigest"
          , publication.capability_evaluated_at AS "capabilityEvaluatedAt"
          , publication.capability_expires_at AS "capabilityExpiresAt"
        FROM jobs.job_contribution_reconciliations AS publication
        JOIN LATERAL (
          SELECT decision.id, decision.status
          FROM jobs.job_contribution_trust_decisions AS decision
          WHERE decision.contribution_id = publication.contribution_id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ) AS trust ON trust.status = ${input.reason}
        WHERE publication.contribution_id = ${input.contributionId}
          AND publication.kind = 'publication' AND publication.state = 'applied'
      `;
      if (!publication) return null;
      const [existing] = await transaction<PreparedTerminalReconciliation[]>`
        SELECT id AS "reconciliationId", contribution_id AS "contributionId",
          job_id AS "jobId", source_id AS "sourceId", terminal_reason AS reason,
          trust_decision_id AS "trustDecisionId",
          processing_policy_version AS "processingPolicyVersion"
        FROM jobs.job_contribution_reconciliations
        WHERE contribution_id = ${input.contributionId} AND kind = 'removal'
      `;
      if (existing) return existing;
      const command: PreparedTerminalReconciliation = {
        reconciliationId: uuidv7(),
        contributionId: input.contributionId,
        jobId: publication.jobId,
        sourceId: publication.sourceId,
        reason: input.reason,
        trustDecisionId: publication.trustDecisionId,
        processingPolicyVersion: input.processingPolicyVersion,
      };
      await transaction`
        INSERT INTO jobs.job_contribution_reconciliations (
          id, contribution_id, kind, state, normalization_id, independent_verification_id,
          trust_decision_id, job_id, source_id, terminal_reason, processing_policy_version,
          capability_policy_version, capability_configuration_digest_sha256,
          capability_evaluated_at, capability_expires_at,
          created_at, updated_at
        ) VALUES (
          ${command.reconciliationId}, ${command.contributionId}, 'removal', 'prepared',
          ${publication.normalizationId}, ${publication.verificationId}, ${command.trustDecisionId},
          ${command.jobId}, ${command.sourceId}, ${command.reason},
          ${command.processingPolicyVersion}, ${publication.capabilityPolicyVersion},
          ${publication.capabilityDigest}, ${publication.capabilityEvaluatedAt},
          ${publication.capabilityExpiresAt}, ${input.occurredAt}, ${input.occurredAt}
        )
      `;
      return command;
    });
  }

  async completeTerminalReconciliation(
    input: Parameters<ContributionProcessingStore["completeTerminalReconciliation"]>[0],
  ): Promise<LoadedContributionProcessing> {
    return this.client.begin(async (transaction) => {
      await transaction`
        UPDATE jobs.job_contribution_reconciliations
        SET state = 'applied', updated_at = ${input.occurredAt}
        WHERE id = ${input.command.reconciliationId}
          AND contribution_id = ${input.command.contributionId}
          AND kind = 'removal' AND state = 'prepared'
      `;
      await insertState(transaction, {
        contributionId: input.command.contributionId,
        state: "removed",
        reasonCode: "terminal_reconciliation_complete",
        processingPolicyVersion: input.command.processingPolicyVersion,
        occurredAt: input.occurredAt,
      });
      const value = await loadWith(transaction, input.command.contributionId);
      if (!value) throw new Error("Contribution disappeared during removal");
      return value;
    });
  }
}

function trustTransition(
  decision: Exclude<TrustContributionDecision, { status: "unavailable" | "needs_review" }>,
): { state: ContributionOwnerState; reasonCode: ContributionOwnerReasonCode } {
  switch (decision.status) {
    case "accepted":
      return { state: "ready_for_publication", reasonCode: "publication_gates_complete" };
    case "rejected":
      return { state: "rejected", reasonCode: "trust_policy_rejected" };
    case "withdrawn":
      return { state: "withdrawn", reasonCode: "trust_withdrawal" };
    case "taken_down":
      return { state: "taken_down", reasonCode: "trust_takedown" };
  }
}

export class PostgresContributionPublicationReconciler
  implements ContributionPublicationReconciler
{
  constructor(
    private readonly client: postgres.Sql,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(command: Readonly<PreparedPublicationReconciliation>) {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error("The reconciliation clock is invalid");
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-reconcile:${command.contributionId}`}))
      `;
      const [row] = await transaction<
        {
          jobId: string;
          sourceId: string;
          verificationId: string;
        }[]
      >`
        SELECT reconciliation.job_id AS "jobId", reconciliation.source_id AS "sourceId",
          reconciliation.independent_verification_id AS "verificationId"
        FROM jobs.job_contribution_reconciliations AS reconciliation
        JOIN jobs.job_contribution_independent_verifications AS verification
          ON verification.id = reconciliation.independent_verification_id
        JOIN jobs.source_verification_evidence AS evidence
          ON evidence.id = verification.id
          AND evidence.evidence_kind = 'independent_positive_verification'
          AND evidence.job_id = verification.job_id AND evidence.source_id = verification.source_id
          AND evidence.evidence_digest_sha256 = verification.evidence_digest_sha256
          AND evidence.policy_version = verification.source_policy_version
        JOIN LATERAL (
          SELECT decision.id, decision.status
          FROM jobs.job_contribution_trust_decisions AS decision
          WHERE decision.contribution_id = reconciliation.contribution_id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ) AS trust ON trust.id = reconciliation.trust_decision_id AND trust.status = 'accepted'
        JOIN jobs.job_sources AS source
          ON source.id = reconciliation.source_id AND source.job_id = reconciliation.job_id
          AND source.provider = verification.provider
          AND source.canonical_url_hash = verification.canonical_source_url_sha256
          AND source.content_hash = verification.verified_content_sha256
          AND source.last_verified_at >= verification.verified_at
          AND source.withdrawn_at IS NULL
        JOIN jobs.canonical_jobs AS job
          ON job.id = reconciliation.job_id AND job.status = 'active'
          AND job.expires_at > ${now} AND job.description IS NOT NULL
        WHERE reconciliation.id = ${command.reconciliationId}
          AND reconciliation.contribution_id = ${command.contributionId}
          AND reconciliation.kind = 'publication' AND reconciliation.state IN ('prepared', 'applied')
          AND reconciliation.normalization_id = ${command.normalizationId}
          AND reconciliation.independent_verification_id = ${command.independentVerificationId}
          AND reconciliation.job_id = ${command.jobId}
          AND reconciliation.source_id = ${command.sourceId}
          AND reconciliation.trust_decision_id = ${command.trustDecisionId}
          AND reconciliation.processing_policy_version = ${command.processingPolicyVersion}
          AND reconciliation.capability_policy_version = ${command.capabilityPolicyVersion}
          AND reconciliation.capability_configuration_digest_sha256 =
            ${command.capabilityConfigurationDigestSha256}
          AND reconciliation.capability_evaluated_at = ${command.capabilityEvaluatedAt}
          AND reconciliation.capability_expires_at = ${command.capabilityExpiresAt}
          AND reconciliation.capability_evaluated_at <= ${now}
          AND reconciliation.capability_expires_at > ${now}
        FOR UPDATE OF reconciliation, source, job
      `;
      if (!row) throw new Error("Contribution publication reconciliation is not authorized");
      await transaction`
        UPDATE jobs.job_contribution_reconciliations
        SET state = 'applied', updated_at = ${now}
        WHERE id = ${command.reconciliationId} AND state = 'prepared'
      `;
      return Object.freeze(row);
    });
  }

  async remove(command: Readonly<PreparedTerminalReconciliation>): Promise<void> {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error("The reconciliation clock is invalid");
    await this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-reconcile:${command.contributionId}`}))
      `;
      const [row] = await transaction<{ id: string }[]>`
        SELECT removal.id
        FROM jobs.job_contribution_reconciliations AS removal
        JOIN LATERAL (
          SELECT decision.id, decision.status
          FROM jobs.job_contribution_trust_decisions AS decision
          WHERE decision.contribution_id = removal.contribution_id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ) AS trust
          ON trust.id = removal.trust_decision_id AND trust.status = removal.terminal_reason
        WHERE removal.id = ${command.reconciliationId}
          AND removal.contribution_id = ${command.contributionId}
          AND removal.kind = 'removal' AND removal.state IN ('prepared', 'applied')
          AND removal.job_id = ${command.jobId} AND removal.source_id = ${command.sourceId}
          AND removal.terminal_reason = ${command.reason}
          AND removal.trust_decision_id = ${command.trustDecisionId}
          AND removal.processing_policy_version = ${command.processingPolicyVersion}
        FOR UPDATE OF removal
      `;
      if (!row) throw new Error("Contribution removal reconciliation is not authorized");
      await transaction`
        UPDATE jobs.job_contribution_reconciliations
        SET state = 'applied', updated_at = ${now}
        WHERE id = ${command.reconciliationId} AND state = 'prepared'
      `;
    });
  }
}

interface QueueRow {
  id: string;
  contributionId: string;
  attempt: number;
  claimedBy: string;
  claimExpiresAt: Date | string;
}

function queueItem(row: QueueRow): ContributionProcessingQueueItem {
  return Object.freeze({
    id: row.id,
    contributionId: row.contributionId,
    state: "claimed",
    attempt: row.attempt,
    claimedBy: row.claimedBy,
    claimExpiresAt: new Date(timestamp(row.claimExpiresAt)),
  });
}

export class PostgresContributionProcessingQueueStore implements ContributionProcessingQueueStore {
  constructor(private readonly client: postgres.Sql) {}

  async claim(input: Parameters<ContributionProcessingQueueStore["claim"]>[0]) {
    return this.client.begin(async (transaction) => {
      await transaction`
        UPDATE jobs.job_contribution_processing_queue
        SET state = 'pending', available_at = ${input.now}, claimed_at = NULL,
          claim_expires_at = NULL, claimed_by = NULL,
          last_error_code = 'processing_dependency', updated_at = ${input.now}
        WHERE state = 'claimed' AND claim_expires_at <= ${input.now}
      `;
      const rows = await transaction<QueueRow[]>`
        WITH claimable AS (
          SELECT id FROM jobs.job_contribution_processing_queue
          WHERE state = 'pending' AND available_at <= ${input.now}
          ORDER BY available_at, created_at, id
          FOR UPDATE SKIP LOCKED LIMIT ${input.limit}
        )
        UPDATE jobs.job_contribution_processing_queue AS queue
        SET state = 'claimed', attempt = queue.attempt + 1, claimed_at = ${input.now},
          claim_expires_at = ${input.claimExpiresAt}, claimed_by = ${input.workerId},
          last_error_code = NULL, updated_at = ${input.now}
        FROM claimable WHERE queue.id = claimable.id
        RETURNING queue.id, queue.contribution_id AS "contributionId", queue.attempt,
          queue.claimed_by AS "claimedBy", queue.claim_expires_at AS "claimExpiresAt"
      `;
      return rows.map(queueItem);
    });
  }

  async complete(
    input: Parameters<ContributionProcessingQueueStore["complete"]>[0],
  ): Promise<void> {
    const rows = await this.client`
      UPDATE jobs.job_contribution_processing_queue
      SET state = 'completed', claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = NULL, updated_at = ${input.now}
      WHERE id = ${input.item.id} AND contribution_id = ${input.item.contributionId}
        AND state = 'claimed' AND claimed_by = ${input.workerId}
        AND attempt = ${input.item.attempt}
      RETURNING id
    `;
    if (rows.count !== 1) throw new Error("Contribution processing completion lost its lease");
  }

  async retry(input: Parameters<ContributionProcessingQueueStore["retry"]>[0]): Promise<void> {
    const rows = await this.client`
      UPDATE jobs.job_contribution_processing_queue
      SET state = ${input.terminal ? "dead" : "pending"}, available_at = ${input.retryAt},
        claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = ${input.errorCode}, updated_at = ${input.now}
      WHERE id = ${input.item.id} AND contribution_id = ${input.item.contributionId}
        AND state = 'claimed' AND claimed_by = ${input.workerId}
        AND attempt = ${input.item.attempt}
      RETURNING id
    `;
    if (rows.count !== 1) throw new Error("Contribution processing retry lost its lease");
  }

  async park(input: Parameters<ContributionProcessingQueueStore["park"]>[0]): Promise<void> {
    const rows = await this.client`
      UPDATE jobs.job_contribution_processing_queue
      SET state = 'parked', claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = ${input.reason}, updated_at = ${input.now}
      WHERE id = ${input.item.id} AND contribution_id = ${input.item.contributionId}
        AND state = 'claimed' AND claimed_by = ${input.workerId}
        AND attempt = ${input.item.attempt}
      RETURNING id
    `;
    if (rows.count !== 1) throw new Error("Contribution processing park lost its lease");
  }

  async requeue(
    input: Parameters<ContributionProcessingQueueStore["requeue"]>[0],
  ): Promise<boolean> {
    const rows = await this.client`
      UPDATE jobs.job_contribution_processing_queue
      SET state = 'pending', attempt = 0, available_at = ${input.now},
        last_error_code = NULL, updated_at = ${input.now}
      WHERE contribution_id = ${input.contributionId} AND state = 'parked'
      RETURNING id
    `;
    return rows.count === 1;
  }
}
