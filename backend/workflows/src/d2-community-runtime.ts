import { createHash, randomBytes } from "node:crypto";
import { loadD2LambdaGatewayConfig } from "@ai-job-apply/config";
import type { OutboxNudgeV1 } from "@ai-job-apply/event-contracts";
import {
  type IndependentProviderVerificationRegistration,
  RegisteredIndependentProviderVerifier,
  SourceRegistry,
} from "@ai-job-apply/ingestion-worker";
import {
  ContributionTrustDecisionSignalConsumer,
  contributionCapabilityPolicySourceFromEnvironment,
  createJobCatalogDatabase,
  IdentifierOnlyContributionProcessingEventPublisher,
  PostgresContributionProcessingQueueStore,
  PostgresContributionProcessingStore,
  PostgresContributionRecoveryStore,
  PostgresJobCatalog,
  ProfileCurrentContributionConsentAdapter,
} from "@ai-job-apply/jobs-service";
import { createLogger } from "@ai-job-apply/observability";
import {
  PostgresUgcContributionConsentStore,
  resolveLambdaDatabaseUrl,
} from "@ai-job-apply/profile-service";
import {
  IdentifierOnlyTrustDecisionEventPublisher,
  PostgresTrustDecisionSignalStore,
  PostgresTrustStore,
  TrustApplicationService,
  TrustDecisionDeliveryRunner,
} from "@ai-job-apply/trust-service";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { AuthoritativeContributionTrustDecisionAdapter } from "./contribution-trust-adapter.js";
import type {
  D2CommunityLambdaConfiguration,
  D2TrustSignalLambdaConfiguration,
} from "./d2-community-lambda.js";
import { parseProviderSourceConfigurations } from "./ingestion-lambda.js";

const POLICY_VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const WORKER = /^[A-Za-z0-9:_-]{3,100}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const MAXIMUM_POLICY_BYTES = 8_192;
const MAXIMUM_VERIFICATION_CONFIGURATION_BYTES = 8_192;

interface RuntimeBatchPolicy {
  workerId: string;
  batchLimit: number;
  maxAttempts: number;
  claimLeaseMilliseconds: number;
  retryDelayMilliseconds: readonly number[];
}

interface RuntimePolicy {
  processing: RuntimeBatchPolicy & { version: string };
  contributionDelivery: RuntimeBatchPolicy;
  trustDelivery: RuntimeBatchPolicy;
}

interface SqsSender {
  send(command: SendMessageCommand): Promise<{ MessageId?: string }>;
}

export interface D2CommunityRuntimeDependencies {
  resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
  createDatabase?: (databaseUrl: string) => ReturnType<typeof createJobCatalogDatabase>;
  createSqsSender?: (region: string) => SqsSender;
  now?: () => Date;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function batchPolicy(value: unknown): RuntimeBatchPolicy {
  if (
    !record(value) ||
    !exactKeys(value, [
      "workerId",
      "batchLimit",
      "maxAttempts",
      "claimLeaseMilliseconds",
      "retryDelayMilliseconds",
    ]) ||
    typeof value.workerId !== "string" ||
    !WORKER.test(value.workerId) ||
    !integer(value.batchLimit, 1, 25) ||
    !integer(value.maxAttempts, 1, 5) ||
    !integer(value.claimLeaseMilliseconds, 1_000, 15 * 60_000) ||
    !Array.isArray(value.retryDelayMilliseconds) ||
    value.retryDelayMilliseconds.length !== value.maxAttempts - 1 ||
    value.retryDelayMilliseconds.some(
      (delay, index, values) =>
        !integer(delay, 1_000, 24 * 60 * 60_000) ||
        (index > 0 && Number(delay) < Number(values[index - 1])),
    )
  ) {
    throw new Error("D2CommunityRuntimePolicyRejected");
  }
  return Object.freeze({
    workerId: value.workerId,
    batchLimit: value.batchLimit,
    maxAttempts: value.maxAttempts,
    claimLeaseMilliseconds: value.claimLeaseMilliseconds,
    retryDelayMilliseconds: Object.freeze([...value.retryDelayMilliseconds] as number[]),
  });
}

export function parseD2CommunityRuntimePolicy(value: string): RuntimePolicy {
  if (Buffer.byteLength(value, "utf8") > MAXIMUM_POLICY_BYTES) {
    throw new Error("D2CommunityRuntimePolicyRejected");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("D2CommunityRuntimePolicyRejected");
  }
  if (
    !record(parsed) ||
    !exactKeys(parsed, ["processing", "contributionDelivery", "trustDelivery"]) ||
    !record(parsed.processing) ||
    typeof parsed.processing.version !== "string" ||
    !POLICY_VERSION.test(parsed.processing.version) ||
    !exactKeys(parsed.processing, [
      "version",
      "workerId",
      "batchLimit",
      "maxAttempts",
      "claimLeaseMilliseconds",
      "retryDelayMilliseconds",
    ])
  ) {
    throw new Error("D2CommunityRuntimePolicyRejected");
  }
  const { version, ...processingFields } = parsed.processing;
  return Object.freeze({
    processing: Object.freeze({ version, ...batchPolicy(processingFields) }),
    contributionDelivery: batchPolicy(parsed.contributionDelivery),
    trustDelivery: batchPolicy(parsed.trustDelivery),
  });
}

export function parseD2ProviderVerificationRegistrations(
  value: string,
): readonly IndependentProviderVerificationRegistration[] {
  if (Buffer.byteLength(value, "utf8") > MAXIMUM_VERIFICATION_CONFIGURATION_BYTES) {
    throw new Error("D2CommunityProviderVerificationConfigurationRejected");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("D2CommunityProviderVerificationConfigurationRejected");
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new Error("D2CommunityProviderVerificationConfigurationRejected");
  }
  const seen = new Set<string>();
  return Object.freeze(
    parsed.map((candidate): IndependentProviderVerificationRegistration => {
      if (
        !record(candidate) ||
        !exactKeys(candidate, [
          "sourceId",
          "provider",
          "pageVariant",
          "atsTenant",
          "sourcePolicyVersion",
        ]) ||
        typeof candidate.sourceId !== "string" ||
        !SOURCE_ID.test(candidate.sourceId) ||
        (candidate.provider !== "greenhouse" &&
          candidate.provider !== "lever" &&
          candidate.provider !== "ashby") ||
        typeof candidate.pageVariant !== "string" ||
        typeof candidate.atsTenant !== "string" ||
        !candidate.atsTenant ||
        candidate.atsTenant !==
          candidate.atsTenant.normalize("NFKC").trim().toLocaleLowerCase("en-US") ||
        typeof candidate.sourcePolicyVersion !== "string" ||
        !POLICY_VERSION.test(candidate.sourcePolicyVersion)
      ) {
        throw new Error("D2CommunityProviderVerificationConfigurationRejected");
      }
      const expectedVariant = `${candidate.provider === "greenhouse" ? "greenhouse-board" : candidate.provider === "lever" ? "lever-posting" : "ashby-job-board"}-v1`;
      const key = `${candidate.provider}\0${candidate.atsTenant}`;
      if (candidate.pageVariant !== expectedVariant || seen.has(key)) {
        throw new Error("D2CommunityProviderVerificationConfigurationRejected");
      }
      seen.add(key);
      return Object.freeze({
        sourceId: candidate.sourceId,
        provider: candidate.provider,
        pageVariant:
          candidate.pageVariant as IndependentProviderVerificationRegistration["pageVariant"],
        atsTenant: candidate.atsTenant,
        sourcePolicyVersion: candidate.sourcePolicyVersion,
      });
    }),
  );
}

function reviewerId(issuer: string, subject: string): string {
  const bytes = createHash("sha256")
    .update("ai-job-apply/trust-reviewer/v1\0")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactQueueUrl(value: string, queueArn: string): string {
  const arn =
    /^arn:(aws|aws-us-gov|aws-cn):sqs:([a-z0-9-]+):([0-9]{12}):([A-Za-z0-9_-]{1,80})$/u.exec(
      queueArn,
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("D2CommunityTrustSignalQueueRejected");
  }
  const suffix = arn?.[1] === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com";
  if (
    !arn ||
    url.protocol !== "https:" ||
    url.hostname !== `sqs.${arn[2]}.${suffix}` ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== `/${arn[3]}/${arn[4]}`
  ) {
    throw new Error("D2CommunityTrustSignalQueueRejected");
  }
  return url.toString();
}

export class AwsD2IdentifierOnlyNudgeTransport {
  constructor(
    private readonly queueUrl: string,
    private readonly sender: SqsSender,
  ) {}

  async publish(nudge: OutboxNudgeV1): Promise<void> {
    const response = await this.sender.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(nudge) }),
    );
    if (!response.MessageId) throw new Error("D2CommunityNudgeNotAccepted");
  }
}

function trustApplication(
  client: ReturnType<typeof createJobCatalogDatabase>,
  configuration: NonNullable<ReturnType<typeof loadD2LambdaGatewayConfig>["trust"]>,
  openerId: string,
  now: () => Date,
): TrustApplicationService {
  return new TrustApplicationService({
    store: new PostgresTrustStore(client),
    reviewerAuthority: {
      authorize: async ({ reviewerId: candidate, role }) =>
        candidate === openerId && role === "case_opener",
    },
    contributionEvidence: {
      async readEligibility(contributionId) {
        const [row] = await client<
          { contributionId: string; contributorUserId: string; independentlyVerified: boolean }[]
        >`
          SELECT contribution.id AS "contributionId",
            contribution.owner_user_id AS "contributorUserId",
            EXISTS (
              SELECT 1 FROM jobs.job_contribution_independent_verifications AS verification
              WHERE verification.contribution_id = contribution.id
            ) AS "independentlyVerified"
          FROM jobs.job_contributions AS contribution
          WHERE contribution.id = ${contributionId}
        `;
        return row
          ? Object.freeze({
              contributionId: row.contributionId,
              contributorUserId: row.contributorUserId,
              eligibleForTrustReview: row.independentlyVerified,
            })
          : null;
      },
      async verifyEvidence({ contributionId, evidenceDigestSha256, purpose }) {
        if (purpose !== "independent_verification") return false;
        const [row] = await client<{ verified: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM jobs.job_contribution_independent_verifications
            WHERE contribution_id = ${contributionId}
              AND evidence_digest_sha256 = ${evidenceDigestSha256}
          ) AS verified
        `;
        return row?.verified === true;
      },
    },
    approvedPolicy: {
      readApprovedPolicy: async () =>
        Object.freeze({
          version: configuration.policyVersion,
          appealWindowMilliseconds: configuration.appealWindowMilliseconds,
        }),
    },
    systemActorId: configuration.systemActorId,
    now,
  });
}

/**
 * Creates the real Phase 2 Lambda composition only after exact activation. Missing provider
 * registrations remain an empty registry, so no host is fetched and processing parks closed.
 */
export async function createConfiguredD2CommunityLambdaConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: D2CommunityRuntimeDependencies = {},
): Promise<D2CommunityLambdaConfiguration> {
  if (environment.D2_COMMUNITY_RUNTIME_ENABLED !== "true") return { enabled: false };
  const required = [
    environment.D2_COMMUNITY_ACCOUNT_ID,
    environment.D2_COMMUNITY_REGION,
    environment.D2_COMMUNITY_SCHEDULE_RULE_ARN,
    environment.D2_TRUST_SIGNAL_QUEUE_ARN,
    environment.D2_TRUST_SIGNAL_QUEUE_URL,
    environment.D2_COMMUNITY_RUNTIME_POLICY_JSON,
  ];
  if (
    required.some((value) => !value) ||
    environment.AWS_REGION !== environment.D2_COMMUNITY_REGION
  ) {
    throw new Error("D2CommunityRuntimeConfigurationRejected");
  }
  const region = environment.D2_COMMUNITY_REGION as string;
  const now = dependencies.now ?? (() => new Date());
  const policy = parseD2CommunityRuntimePolicy(
    environment.D2_COMMUNITY_RUNTIME_POLICY_JSON as string,
  );
  const trustConfiguration = loadD2LambdaGatewayConfig(environment).trust;
  const capability = contributionCapabilityPolicySourceFromEnvironment(environment, () => now());
  if (!trustConfiguration || !capability) {
    throw new Error("D2CommunityRuntimeAuthorityRejected");
  }
  const openerAssignments = trustConfiguration.reviewerAssignments.filter((assignment) =>
    assignment.roles.includes("case_opener"),
  );
  if (openerAssignments.length !== 1) {
    throw new Error("D2CommunityCaseOpenerAuthorityRejected");
  }
  const opener = openerAssignments[0] as (typeof openerAssignments)[number];
  const caseOpenerReviewerId = reviewerId(opener.issuer, opener.subject);
  if (!UUID.test(caseOpenerReviewerId)) throw new Error("D2CommunityCaseOpenerAuthorityRejected");

  const providerActivationAllowed = environment.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED === "true";
  if (
    environment.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED !== undefined &&
    environment.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED !== "true" &&
    environment.D2_COMMUNITY_PROVIDER_ACTIVATION_ALLOWED !== "false"
  ) {
    throw new Error("D2CommunityProviderActivationRejected");
  }
  const configuredSources = parseProviderSourceConfigurations(
    environment.D2_COMMUNITY_PROVIDER_SOURCES_JSON ?? "[]",
    providerActivationAllowed,
  );
  const verificationRegistrations = parseD2ProviderVerificationRegistrations(
    environment.D2_COMMUNITY_PROVIDER_VERIFICATION_REGISTRATIONS_JSON ?? "[]",
  );
  const registry = new SourceRegistry(
    configuredSources.map((source) => source.registration),
    () => true,
    { providerActivationAllowed },
  );
  const resolveDatabaseUrl = dependencies.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  if (Boolean(environment.DATABASE_URL) === Boolean(environment.DATABASE_SECRET_ID)) {
    throw new Error("D2CommunityDatabaseAuthorityRejected");
  }
  const databaseUrl = await resolveDatabaseUrl(
    {
      ...(environment.DATABASE_URL ? { DATABASE_URL: environment.DATABASE_URL } : {}),
      ...(environment.DATABASE_SECRET_ID
        ? { DATABASE_SECRET_ID: environment.DATABASE_SECRET_ID }
        : {}),
    },
    { ...(environment.AWS_SESSION_TOKEN ? { sessionToken: environment.AWS_SESSION_TOKEN } : {}) },
  );
  const client = (
    dependencies.createDatabase ?? ((url) => createJobCatalogDatabase(url, { maxConnections: 1 }))
  )(databaseUrl);
  const signalStore = new PostgresTrustDecisionSignalStore(client);
  const processingStore = new PostgresContributionProcessingStore(client);
  const queueStore = new PostgresContributionProcessingQueueStore(client);
  const catalog = new PostgresJobCatalog(client, {
    acceptedProvenance: new Set(["permitted_api"]),
    searchCursorKeys: { active: { id: "d2-community-unused", key: randomBytes(32) } },
  });
  const independentVerifier = new RegisteredIndependentProviderVerifier(
    registry,
    {
      async findExact(input) {
        return client<{ jobId: string; sourceId: string }[]>`
          SELECT job_id AS "jobId", id AS "sourceId"
          FROM jobs.job_sources
          WHERE provider = ${input.provider}
            AND ats_tenant = ${input.atsTenant}
            AND external_job_id = ${input.externalJobId}
            AND canonical_url = ${input.canonicalSourceUrl}
          ORDER BY id LIMIT 2
        `;
      },
    },
    verificationRegistrations,
    { clock: now },
  );
  const queueUrl = exactQueueUrl(
    environment.D2_TRUST_SIGNAL_QUEUE_URL as string,
    environment.D2_TRUST_SIGNAL_QUEUE_ARN as string,
  );
  const sender = (
    dependencies.createSqsSender ??
    ((configuredRegion) => new SQSClient({ region: configuredRegion }))
  )(region);
  const nudgeTransport = new AwsD2IdentifierOnlyNudgeTransport(queueUrl, sender);
  const trustService = trustApplication(client, trustConfiguration, caseOpenerReviewerId, now);
  const trustDecision = new AuthoritativeContributionTrustDecisionAdapter(
    trustService,
    signalStore,
    caseOpenerReviewerId,
  );
  const logger = createLogger({
    service: "d2-community-runtime",
    level: "info",
    releaseSha: environment.RELEASE_SHA ?? "local",
  });

  const contributionQueueUrl = environment.D2_CONTRIBUTION_EVENT_QUEUE_URL;
  const contributionQueueArn = environment.D2_CONTRIBUTION_EVENT_QUEUE_ARN;
  if (Boolean(contributionQueueUrl) !== Boolean(contributionQueueArn)) {
    throw new Error("D2CommunityContributionQueueRejected");
  }
  const exactContributionQueueUrl =
    contributionQueueUrl && contributionQueueArn
      ? exactQueueUrl(contributionQueueUrl, contributionQueueArn)
      : undefined;
  const jobsDelivery = exactContributionQueueUrl
    ? {
        input: {
          workerId: policy.contributionDelivery.workerId,
          limit: policy.contributionDelivery.batchLimit,
        },
        runtime: {
          policy: {
            maxAttempts: policy.contributionDelivery.maxAttempts,
            claimLeaseMilliseconds: policy.contributionDelivery.claimLeaseMilliseconds,
            retryDelayMilliseconds: policy.contributionDelivery.retryDelayMilliseconds,
          },
          publisher: new IdentifierOnlyContributionProcessingEventPublisher(
            new AwsD2IdentifierOnlyNudgeTransport(exactContributionQueueUrl, sender),
          ),
        },
      }
    : undefined;

  return Object.freeze({
    enabled: true,
    boundary: Object.freeze({
      accountId: environment.D2_COMMUNITY_ACCOUNT_ID as string,
      region,
      scheduleRuleArn: environment.D2_COMMUNITY_SCHEDULE_RULE_ARN as string,
      trustSignalQueueArn: environment.D2_TRUST_SIGNAL_QUEUE_ARN as string,
    }),
    jobs: Object.freeze({
      input: Object.freeze({
        processingWorkerId: policy.processing.workerId,
        processingLimit: policy.processing.batchLimit,
        ...(jobsDelivery ? { delivery: jobsDelivery.input } : {}),
      }),
      runtime: Object.freeze({
        enabled: true,
        client,
        processingPolicy: Object.freeze({ version: policy.processing.version }),
        processingRunnerPolicy: Object.freeze({
          maxAttempts: policy.processing.maxAttempts,
          claimLeaseMilliseconds: policy.processing.claimLeaseMilliseconds,
          retryDelayMilliseconds: policy.processing.retryDelayMilliseconds,
        }),
        consent: new ProfileCurrentContributionConsentAdapter(
          new PostgresUgcContributionConsentStore(client),
        ),
        independentVerifier,
        trust: trustDecision,
        capability,
        publicationCatalog: catalog,
        ...(jobsDelivery
          ? {
              eventDelivery: Object.freeze({
                policy: jobsDelivery.runtime.policy,
                publisher: jobsDelivery.runtime.publisher,
              }),
            }
          : {}),
        now,
      }),
    }),
    trustDelivery: Object.freeze({
      runner: new TrustDecisionDeliveryRunner(
        signalStore,
        new IdentifierOnlyTrustDecisionEventPublisher(nudgeTransport),
        {
          maxAttempts: policy.trustDelivery.maxAttempts,
          claimLeaseMilliseconds: policy.trustDelivery.claimLeaseMilliseconds,
          retryDelayMilliseconds: policy.trustDelivery.retryDelayMilliseconds,
        },
      ),
      workerId: policy.trustDelivery.workerId,
      limit: policy.trustDelivery.batchLimit,
    }),
    trustSignal: new ContributionTrustDecisionSignalConsumer(
      signalStore,
      processingStore,
      queueStore,
      policy.processing.version,
    ),
    providerRecovery: new PostgresContributionRecoveryStore(client),
    now,
    logger,
  });
}

/** Least-privilege composition for the receive-only Trust-signal Lambda. */
export async function createConfiguredD2TrustSignalLambdaConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: D2CommunityRuntimeDependencies = {},
): Promise<D2TrustSignalLambdaConfiguration> {
  if (environment.D2_COMMUNITY_RUNTIME_ENABLED !== "true") return { enabled: false };
  if (
    !environment.D2_COMMUNITY_ACCOUNT_ID ||
    !environment.D2_COMMUNITY_REGION ||
    !environment.D2_TRUST_SIGNAL_QUEUE_ARN ||
    environment.AWS_REGION !== environment.D2_COMMUNITY_REGION ||
    typeof environment.D2_COMMUNITY_PROCESSING_POLICY_VERSION !== "string" ||
    !POLICY_VERSION.test(environment.D2_COMMUNITY_PROCESSING_POLICY_VERSION) ||
    Boolean(environment.DATABASE_URL) === Boolean(environment.DATABASE_SECRET_ID)
  ) {
    throw new Error("D2CommunityTrustSignalConfigurationRejected");
  }
  const resolveDatabaseUrl = dependencies.resolveDatabaseUrl ?? resolveLambdaDatabaseUrl;
  const databaseUrl = await resolveDatabaseUrl(
    {
      ...(environment.DATABASE_URL ? { DATABASE_URL: environment.DATABASE_URL } : {}),
      ...(environment.DATABASE_SECRET_ID
        ? { DATABASE_SECRET_ID: environment.DATABASE_SECRET_ID }
        : {}),
    },
    { ...(environment.AWS_SESSION_TOKEN ? { sessionToken: environment.AWS_SESSION_TOKEN } : {}) },
  );
  const client = (
    dependencies.createDatabase ?? ((url) => createJobCatalogDatabase(url, { maxConnections: 1 }))
  )(databaseUrl);
  const signalStore = new PostgresTrustDecisionSignalStore(client);
  const now = dependencies.now ?? (() => new Date());
  return Object.freeze({
    enabled: true,
    boundary: Object.freeze({
      accountId: environment.D2_COMMUNITY_ACCOUNT_ID,
      region: environment.D2_COMMUNITY_REGION,
      trustSignalQueueArn: environment.D2_TRUST_SIGNAL_QUEUE_ARN,
    }),
    trustSignal: new ContributionTrustDecisionSignalConsumer(
      signalStore,
      new PostgresContributionProcessingStore(client),
      new PostgresContributionProcessingQueueStore(client),
      environment.D2_COMMUNITY_PROCESSING_POLICY_VERSION,
    ),
    now,
    logger: createLogger({
      service: "d2-trust-signal-runtime",
      level: "info",
      releaseSha: environment.RELEASE_SHA ?? "local",
    }),
  });
}
