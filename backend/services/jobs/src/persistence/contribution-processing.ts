import { createHash } from "node:crypto";
import {
  DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST,
  DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION,
  DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS,
} from "../contribution-capability-source.js";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
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
import type {
  ContributionProcessingQueueItem,
  ContributionProcessingQueueStore,
} from "../contribution-processing-runner.js";
import { canonicalizeJobUrl } from "../domain/canonical-job.js";
import {
  type CatalogObservation,
  type PostgresJobCatalog,
  ProbableDuplicateObservationError,
} from "./catalog.js";

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
  providerObservation: unknown;
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

function providerObservation(value: unknown): CatalogObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed staged provider observation");
  }
  const row = structuredClone(value) as Record<string, unknown>;
  if ("rawSnapshot" in row) throw new Error("Raw provider snapshots cannot be staged");
  for (const field of ["observedAt", "datePosted", "validThrough"] as const) {
    if (row[field] !== undefined) {
      if (typeof row[field] !== "string") throw new Error("Malformed provider timestamp");
      row[field] = new Date(row[field]);
    }
  }
  return row as unknown as CatalogObservation;
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
      Boolean(row.verificationJobId) !== Boolean(row.verificationSourceId) ||
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
      ...(row.verificationJobId ? { jobId: row.verificationJobId } : {}),
      ...(row.verificationSourceId ? { sourceId: row.verificationSourceId } : {}),
      provider: row.provider,
      pageVariant: row.pageVariant,
      canonicalSourceUrlSha256: row.canonicalSourceUrlSha256,
      evidenceDigestSha256: row.evidenceDigestSha256,
      verifiedContentSha256: row.verifiedContentSha256,
      sourcePolicyVersion: row.sourcePolicyVersion,
      verifiedAt: timestamp(row.verifiedAt),
      providerObservation: providerObservation(row.providerObservation),
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
      verification.provider_observation AS "providerObservation",
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
      ORDER BY (event.state = 'consent_invalid') DESC, event.occurred_at DESC, event.id DESC LIMIT 1
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
  const [cancelled] = await client<Array<{ present: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM jobs.job_contribution_state_events
      WHERE contribution_id = ${input.contributionId} AND state = 'consent_invalid') AS present
  `;
  if (cancelled?.present) return;
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
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-processing:${input.contributionId}`}))`;
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
      const current = await loadWith(transaction, input.contributionId);
      if (current?.ownerState === "consent_invalid") return current;
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
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-processing:${input.contributionId}`}))`;
      const evidence = input.evidence;
      const normalization = await loadWith(transaction, input.contributionId);
      if (normalization?.ownerState === "consent_invalid") return normalization;
      if (!normalization?.normalization) throw new Error("Normalization is required");
      if (
        normalization.normalization.proposal.provenance.provider !== evidence.provider ||
        normalization.normalization.proposal.provenance.pageVariant !== evidence.pageVariant ||
        normalization.normalization.proposal.provenance.canonicalSourceUrlSha256 !==
          evidence.canonicalSourceUrlSha256
      ) {
        throw new Error("Independent verification does not bind the staged normalization");
      }
      await transaction`
        INSERT INTO jobs.job_contribution_independent_verifications (
          id, contribution_id, normalization_id, job_id, source_id, provider, page_variant,
          canonical_source_url_sha256, evidence_digest_sha256, verified_content_sha256,
          source_policy_version, verified_at, provider_observation,
          processing_policy_version, created_at
        ) VALUES (
          ${evidence.verificationId}, ${input.contributionId}, ${normalization.normalization.id},
          ${evidence.jobId ?? null}, ${evidence.sourceId ?? null}, ${evidence.provider},
          ${evidence.pageVariant},
          ${evidence.canonicalSourceUrlSha256}, ${evidence.evidenceDigestSha256},
          ${evidence.verifiedContentSha256}, ${evidence.sourcePolicyVersion},
          ${evidence.verifiedAt},
          ${transaction.json(evidence.providerObservation as unknown as postgres.JSONValue)},
          ${input.processingPolicyVersion}, ${input.occurredAt}
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
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-processing:${input.contributionId}`}))`;
      const current = await loadWith(transaction, input.contributionId);
      if (current?.ownerState === "consent_invalid") return current;
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
    if (
      input.developmentOperationLease &&
      (input.capabilityPolicyVersion !== DEVELOPMENT_CONTRIBUTION_CAPABILITY_VERSION ||
        input.capabilityConfigurationDigestSha256 !== DEVELOPMENT_CONTRIBUTION_CAPABILITY_DIGEST ||
        Date.parse(input.capabilityExpiresAt) - Date.parse(input.capabilityEvaluatedAt) !==
          DEVELOPMENT_CONTRIBUTION_OPERATION_LEASE_MS ||
        Date.parse(input.capabilityEvaluatedAt) > input.occurredAt.getTime() ||
        Date.parse(input.capabilityExpiresAt) <= input.occurredAt.getTime())
    ) {
      throw new Error("Development publication operation lease is invalid");
    }
    return this.client.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-reconcile:${input.contributionId}`}))
      `;
      const [gates] = await transaction<
        {
          normalizationId: string;
          verificationId: string;
          trustDecisionId: string;
        }[]
      >`
        SELECT normalization.id AS "normalizationId", verification.id AS "verificationId",
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
        WHERE contribution.id = ${input.contributionId}
          AND NOT EXISTS (SELECT 1 FROM jobs.job_contribution_state_events AS cancelled
            WHERE cancelled.contribution_id = contribution.id AND cancelled.state = 'consent_invalid')
          AND contribution.client_surface = 'browser_extension'
          AND contribution.client_version IS NOT NULL
          AND contribution.payload #>> '{client,surface}' = contribution.client_surface
          AND contribution.payload #>> '{client,version}' = contribution.client_version
      `;
      if (!gates) throw new Error("Publication gates are not complete");
      const [existing] = await transaction<
        Array<PreparedPublicationReconciliation & { state: "prepared" | "applied" }>
      >`
        SELECT id AS "reconciliationId", contribution_id AS "contributionId",
          state,
          normalization_id AS "normalizationId",
          independent_verification_id AS "independentVerificationId",
          trust_decision_id AS "trustDecisionId",
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
          existing.capabilityConfigurationDigestSha256 !==
            input.capabilityConfigurationDigestSha256 ||
          existing.normalizationId !== gates.normalizationId ||
          existing.independentVerificationId !== gates.verificationId ||
          existing.trustDecisionId !== gates.trustDecisionId
        ) {
          throw new Error("Publication policy changed after preparation");
        }
        const { state, ...command } = existing;
        const existingCommand = {
          ...command,
          capabilityEvaluatedAt: timestamp(command.capabilityEvaluatedAt),
          capabilityExpiresAt: timestamp(command.capabilityExpiresAt),
        };
        if (
          input.developmentOperationLease &&
          Date.parse(existingCommand.capabilityExpiresAt) <= Date.parse(input.capabilityEvaluatedAt)
        ) {
          if (state !== "prepared") throw new Error("Completed publication leases are immutable");
          // Set only after fresh service capability/consent/verification/Trust checks and the
          // locked exact evidence comparison above. This transaction-local marker is not authority.
          await transaction`SELECT set_config('ai_job_apply.development_contribution_lease', 'renew', true)`;
          const changed = await transaction<{ id: string }[]>`
            UPDATE jobs.job_contribution_reconciliations
            SET capability_evaluated_at = ${input.capabilityEvaluatedAt},
              capability_expires_at = ${input.capabilityExpiresAt}, updated_at = ${input.occurredAt}
            WHERE id = ${existing.reconciliationId} AND state = 'prepared'
            RETURNING id
          `;
          if (changed.length !== 1)
            throw new Error("Development operation lease changed concurrently");
          return Object.freeze({
            ...existingCommand,
            capabilityEvaluatedAt: input.capabilityEvaluatedAt,
            capabilityExpiresAt: input.capabilityExpiresAt,
          });
        }
        return Object.freeze(existingCommand);
      }
      const command = {
        reconciliationId: uuidv7(),
        contributionId: input.contributionId,
        normalizationId: gates.normalizationId,
        independentVerificationId: gates.verificationId,
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
          ${command.trustDecisionId}, NULL, NULL, NULL,
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
      if (input.result.verificationId !== input.command.independentVerificationId) {
        throw new Error("Publication result changed reconciliation identity");
      }
      const completed = await transaction<{ id: string }[]>`
        SELECT id FROM jobs.job_contribution_reconciliations
        WHERE id = ${input.command.reconciliationId}
          AND contribution_id = ${input.command.contributionId}
          AND kind = 'publication' AND state = 'applied'
          AND job_id = ${input.result.jobId} AND source_id = ${input.result.sourceId}
      `;
      if (completed.length !== 1) {
        throw new Error(
          "Publication reconciliation is not applied to the returned catalog identity",
        );
      }
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
    private readonly catalog: Pick<PostgresJobCatalog, "recordObservationInTransaction">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(command: Readonly<PreparedPublicationReconciliation>) {
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error("The reconciliation clock is invalid");
    try {
      return await this.client.begin(async (transaction) => {
        await transaction`
          SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-reconcile:${command.contributionId}`}))
        `;
        const [row] = await transaction<
          {
            state: "prepared" | "applied";
            jobId: string | null;
            sourceId: string | null;
            verificationId: string;
            provider: string;
            pageVariant: string;
            evidenceDigestSha256: string;
            sourcePolicyVersion: string;
            verifiedAt: Date | string;
            providerObservation: unknown;
          }[]
        >`
          SELECT reconciliation.state, reconciliation.job_id AS "jobId",
            reconciliation.source_id AS "sourceId",
            verification.id AS "verificationId", verification.provider,
            verification.page_variant AS "pageVariant",
            verification.evidence_digest_sha256 AS "evidenceDigestSha256",
            verification.source_policy_version AS "sourcePolicyVersion",
            verification.verified_at AS "verifiedAt",
            verification.provider_observation AS "providerObservation"
          FROM jobs.job_contribution_reconciliations AS reconciliation
          JOIN jobs.job_contribution_independent_verifications AS verification
            ON verification.id = reconciliation.independent_verification_id
          JOIN LATERAL (
            SELECT decision.id, decision.status
            FROM jobs.job_contribution_trust_decisions AS decision
            WHERE decision.contribution_id = reconciliation.contribution_id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ) AS trust ON trust.id = reconciliation.trust_decision_id AND trust.status = 'accepted'
          WHERE reconciliation.id = ${command.reconciliationId}
            AND reconciliation.contribution_id = ${command.contributionId}
            AND reconciliation.kind = 'publication'
            AND NOT EXISTS (SELECT 1 FROM jobs.job_contribution_state_events AS cancelled
              WHERE cancelled.contribution_id = reconciliation.contribution_id AND cancelled.state = 'consent_invalid')
            AND reconciliation.normalization_id = ${command.normalizationId}
            AND reconciliation.independent_verification_id = ${command.independentVerificationId}
            AND reconciliation.trust_decision_id = ${command.trustDecisionId}
            AND reconciliation.processing_policy_version = ${command.processingPolicyVersion}
            AND reconciliation.capability_policy_version = ${command.capabilityPolicyVersion}
            AND reconciliation.capability_configuration_digest_sha256 =
              ${command.capabilityConfigurationDigestSha256}
            AND reconciliation.capability_evaluated_at = ${command.capabilityEvaluatedAt}
            AND reconciliation.capability_expires_at = ${command.capabilityExpiresAt}
            AND reconciliation.capability_evaluated_at <= ${now}
            AND reconciliation.capability_expires_at > ${now}
          FOR UPDATE OF reconciliation
        `;
        if (!row) throw new Error("Contribution publication reconciliation is not authorized");
        if (row.state === "applied") {
          if (!row.jobId || !row.sourceId)
            throw new Error("Applied publication lost catalog identity");
          return Object.freeze({
            status: "published" as const,
            jobId: row.jobId,
            sourceId: row.sourceId,
            verificationId: row.verificationId,
          });
        }
        const observation = providerObservation(row.providerObservation);
        const recorded = await this.catalog.recordObservationInTransaction(
          transaction,
          observation,
          { rejectProbableDuplicates: true },
        );
        if (recorded.job.status !== "active") {
          throw new Error("Contribution publication reconciliation is not authorized");
        }
        const source = await transaction<{ id: string }[]>`
          SELECT id FROM jobs.job_sources
          WHERE job_id = ${recorded.job.id} AND provider = ${observation.provider}
            AND canonical_url_hash = ${createHash("sha256").update(canonicalizeJobUrl(observation.sourceUrl)).digest("hex")}
          ORDER BY created_at, id LIMIT 1
        `;
        const sourceId = source[0]?.id;
        if (
          !sourceId ||
          (row.jobId && row.jobId !== recorded.job.id) ||
          (row.sourceId && row.sourceId !== sourceId)
        ) {
          throw new Error("Provider publication changed staged exact identity");
        }
        await transaction`
          INSERT INTO jobs.source_verification_evidence (
            id, job_id, source_id, provider, page_variant, evidence_kind,
            evidence_digest_sha256, policy_version, verified_at, recorded_at
          ) VALUES (
            ${row.verificationId}, ${recorded.job.id}, ${sourceId}, ${row.provider},
            ${row.pageVariant}, 'independent_positive_verification',
            ${row.evidenceDigestSha256}, ${row.sourcePolicyVersion}, ${row.verifiedAt}, ${now}
          ) ON CONFLICT (id) DO NOTHING
        `;
        const evidence = await transaction<
          { jobId: string; sourceId: string; provider: string; digest: string }[]
        >`
          SELECT job_id AS "jobId", source_id AS "sourceId", provider,
            evidence_digest_sha256 AS digest
          FROM jobs.source_verification_evidence
          WHERE id = ${row.verificationId}
        `;
        if (
          evidence.length !== 1 ||
          evidence[0]?.jobId !== recorded.job.id ||
          evidence[0]?.sourceId !== sourceId ||
          evidence[0]?.provider !== row.provider ||
          evidence[0]?.digest !== row.evidenceDigestSha256
        ) {
          throw new Error("Provider publication verification evidence is ambiguous");
        }
        if (!row.jobId) {
          await transaction`
            UPDATE jobs.job_contribution_independent_verifications
            SET job_id = ${recorded.job.id}, source_id = ${sourceId}
            WHERE id = ${row.verificationId} AND job_id IS NULL AND source_id IS NULL
          `;
        }
        await transaction`
          UPDATE jobs.job_contribution_reconciliations
          SET state = 'applied', job_id = ${recorded.job.id}, source_id = ${sourceId}, updated_at = ${now}
          WHERE id = ${command.reconciliationId} AND state = 'prepared'
        `;
        return Object.freeze({
          status: "published" as const,
          jobId: recorded.job.id,
          sourceId,
          verificationId: row.verificationId,
        });
      });
    } catch (error) {
      if (error instanceof ProbableDuplicateObservationError) {
        return Object.freeze({
          status: "probable_duplicate" as const,
          probableDuplicateJobIds: Object.freeze([...error.probableDuplicateJobIds]),
        });
      }
      throw error;
    }
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
            AND NOT EXISTS (SELECT 1 FROM jobs.job_contribution_state_events AS cancelled
              WHERE cancelled.contribution_id = jobs.job_contribution_processing_queue.contribution_id
                AND cancelled.state = 'consent_invalid')
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
        last_error_code = NULL, updated_at = ${input.now},
        completed_trust_decision_id = (
          SELECT decision.id FROM jobs.job_contribution_trust_decisions AS decision
          WHERE decision.contribution_id = ${input.item.contributionId}
            AND (
              (${input.outcome} = 'published' AND decision.status = 'accepted' AND EXISTS (
                SELECT 1 FROM jobs.job_contribution_reconciliations AS reconciliation
                WHERE reconciliation.contribution_id = decision.contribution_id
                  AND reconciliation.kind = 'publication' AND reconciliation.state = 'applied'
                  AND reconciliation.trust_decision_id = decision.id
              )) OR (${input.outcome} = 'rejected' AND decision.status = 'rejected')
              OR (${input.outcome} IN ('withdrawn', 'taken_down') AND decision.status = ${input.outcome})
              OR (${input.outcome} = 'removed' AND decision.status IN ('withdrawn', 'taken_down') AND EXISTS (
                SELECT 1 FROM jobs.job_contribution_reconciliations AS reconciliation
                WHERE reconciliation.contribution_id = decision.contribution_id
                  AND reconciliation.kind = 'removal' AND reconciliation.state = 'applied'
                  AND reconciliation.trust_decision_id = decision.id
              ))
            )
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        )
      WHERE id = ${input.item.id} AND contribution_id = ${input.item.contributionId}
        AND state = 'claimed' AND claimed_by = ${input.workerId}
        AND attempt = ${input.item.attempt}
      RETURNING id
    `;
    if (rows.count !== 1) throw new Error("Contribution processing completion lost its lease");
    // A Trust signal may have arrived while the queue was claimed. Recheck after
    // completion so that signal cannot be lost between copy and lease release.
    await this.requeue({
      contributionId: input.item.contributionId,
      now: input.now,
      signal: "trust_decision",
    });
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
    await this.client.begin(async (transaction) => {
      // Serialize the handoff with authoritative Trust decision copying. A
      // signal that saw this attempt claimed must not be lost when it parks;
      // a later signal sees the committed parked row and wakes it normally.
      await transaction`SELECT pg_advisory_xact_lock(hashtext(${`jobs:contribution-processing:${input.item.contributionId}`}))`;
      const rows = await transaction`
      UPDATE jobs.job_contribution_processing_queue
      SET state = 'parked', claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
        last_error_code = ${input.reason}, updated_at = ${input.now}
      WHERE id = ${input.item.id} AND contribution_id = ${input.item.contributionId}
        AND state = 'claimed' AND claimed_by = ${input.workerId}
        AND attempt = ${input.item.attempt}
      RETURNING id
    `;
      if (rows.count !== 1) throw new Error("Contribution processing park lost its lease");
      if (input.reason !== "trust_pending") return;
      // The owner-held/provider-held cases are not retried merely because a
      // nudge arrived. This wakeup requires actual decision truth, including
      // rejection, which must finish processing rather than wait for a review
      // that already happened.
      await transaction`
        UPDATE jobs.job_contribution_processing_queue
        SET state = 'pending', attempt = 0, available_at = ${input.now},
          last_error_code = NULL, updated_at = ${input.now}
        WHERE id = ${input.item.id} AND contribution_id = ${input.item.contributionId}
          AND state = 'parked' AND last_error_code = 'trust_pending'
          AND EXISTS (SELECT 1 FROM jobs.job_contribution_trust_decisions
            WHERE contribution_id = ${input.item.contributionId}
              AND status IN ('accepted', 'rejected', 'withdrawn', 'taken_down'))
          AND NOT EXISTS (SELECT 1 FROM jobs.job_contribution_state_events
            WHERE contribution_id = ${input.item.contributionId} AND state = 'consent_invalid')
      `;
    });
  }

  async requeue(
    input: Parameters<ContributionProcessingQueueStore["requeue"]>[0],
  ): Promise<boolean> {
    const rows = await this.client`
      UPDATE jobs.job_contribution_processing_queue
      SET state = 'pending', attempt = 0, available_at = ${input.now},
        last_error_code = NULL, updated_at = ${input.now}
      WHERE contribution_id = ${input.contributionId} AND (
        state = 'parked' OR (state = 'completed'
          AND ${input.signal} IN ('trust_decision', 'withdrawal', 'takedown')
          AND jobs.contribution_requires_trust_processing(contribution_id, completed_trust_decision_id))
      )
      RETURNING id
    `;
    return rows.count === 1;
  }
}
