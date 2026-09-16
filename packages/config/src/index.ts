import { z } from "zod";

export type { ProductBrand, ProductBrandOverrides } from "./brand.js";
export { DEFAULT_PRODUCT_BRAND, resolveProductBrand } from "./brand.js";
export type { PublicJobEdgeLambdaConfig } from "./public-job-edge.js";
export { loadPublicJobEdgeLambdaConfig } from "./public-job-edge.js";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RELEASE_SHA: z.string().default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const oidcSchema = {
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1).default("ai-job-apply-api"),
  OIDC_ID_TOKEN_AUDIENCE: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/)
    .optional(),
};

const telemetrySchema = {
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1),
};

const backendSchema = baseSchema
  .extend({
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    DOCUMENT_UPLOAD_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    DOCUMENT_UPLOAD_KMS_KEY_ARN: z
      .string()
      .regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]{36}$/)
      .optional(),
    ...oidcSchema,
    ...telemetrySchema,
  })
  .refine(
    (value) => Boolean(value.DOCUMENT_UPLOAD_BUCKET) === Boolean(value.DOCUMENT_UPLOAD_KMS_KEY_ARN),
    "DOCUMENT_UPLOAD_BUCKET and DOCUMENT_UPLOAD_KMS_KEY_ARN must be configured together",
  );

export type BackendConfig = z.infer<typeof backendSchema>;

const lambdaGatewaySchema = baseSchema
  .extend({
    DATABASE_URL: z.string().url().optional(),
    DATABASE_SECRET_ID: z.string().min(1).optional(),
    OUTBOX_DISPATCH_TARGET: z.literal("lambda_durable").default("lambda_durable"),
    OUTBOX_QUEUE_URL: z.string().url(),
    DOCUMENT_UPLOAD_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    DOCUMENT_UPLOAD_KMS_KEY_ARN: z
      .string()
      .regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]{36}$/)
      .optional(),
    ...oidcSchema,
    ...telemetrySchema,
  })
  .refine(
    (value) => Boolean(value.DATABASE_URL) !== Boolean(value.DATABASE_SECRET_ID),
    "Exactly one of DATABASE_URL or DATABASE_SECRET_ID is required",
  )
  .refine(
    (value) => Boolean(value.DOCUMENT_UPLOAD_BUCKET) === Boolean(value.DOCUMENT_UPLOAD_KMS_KEY_ARN),
    "DOCUMENT_UPLOAD_BUCKET and DOCUMENT_UPLOAD_KMS_KEY_ARN must be configured together",
  );

export type LambdaGatewayConfig = z.infer<typeof lambdaGatewaySchema>;

const exactDisabledBoolean = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const optionalToken = (pattern: RegExp, maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).max(maximum).regex(pattern).optional(),
  );
const optionalJson = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .min(2)
    .max(32 * 1024)
    .optional(),
);
const trustReviewerRoles = [
  "case_reader",
  "case_opener",
  "initial_reviewer",
  "takedown_reviewer",
  "appeal_reviewer",
] as const;
const trustEvidencePurposes = [
  "independent_verification",
  "initial_review",
  "takedown",
  "appeal_resolution",
  "verified_requester_takedown",
  "development_test_takedown",
] as const;
const lowercaseUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const lowercaseUuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const policyVersion = /^[a-z0-9][a-z0-9._-]{2,99}$/;
const d2DevelopmentContributionProviders = ["greenhouse", "lever", "ashby"] as const;
export type D2DevelopmentContributionProvider = (typeof d2DevelopmentContributionProviders)[number];
const d2DevelopmentContributionDomains = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "jobs.ashbyhq.com",
] as const;
export type D2DevelopmentContributionDomain = (typeof d2DevelopmentContributionDomains)[number];
const d2DevelopmentContributionDomainSchema = z
  .array(z.enum(d2DevelopmentContributionDomains))
  .max(d2DevelopmentContributionDomains.length)
  .superRefine((domains, context) => {
    if (new Set(domains).size !== domains.length) {
      context.addIssue({
        code: "custom",
        message: "Development contribution domains must be unique",
      });
    }
  });
const d2DevelopmentContributionProviderSchema = z
  .array(z.enum(d2DevelopmentContributionProviders))
  .max(d2DevelopmentContributionProviders.length)
  .superRefine((providers, context) => {
    if (new Set(providers).size !== providers.length) {
      context.addIssue({
        code: "custom",
        message: "Development contribution providers must be unique",
      });
    }
  });

const d2LambdaGatewayEnvironmentSchema = z.object({
  D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: exactDisabledBoolean,
  D2_DEPLOYMENT_ENVIRONMENT: z.enum(["development", "staging", "production"]).optional(),
  D2_PRIVATE_CAPTURE_ROUTES_ENABLED: exactDisabledBoolean,
  D2_CONTRIBUTION_POLICY_ROUTE_ENABLED: exactDisabledBoolean,
  D2_CONTRIBUTION_ROUTES_ENABLED: exactDisabledBoolean,
  D2_TRUST_REVIEWER_ROUTES_ENABLED: exactDisabledBoolean,
  UGC_CONTRIBUTION_POLICY_VERSION: optionalToken(policyVersion, 100),
  JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: optionalJson,
  JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON: optionalJson,
  D2_TRUST_REVIEWER_ASSIGNMENTS_JSON: optionalJson,
  D2_TRUST_EVIDENCE_ALLOWLIST_JSON: optionalJson,
  D2_TRUST_POLICY_VERSION: optionalToken(policyVersion, 100),
  D2_TRUST_APPEAL_WINDOW_MILLISECONDS: optionalToken(/^[1-9][0-9]{0,10}$/, 11),
  D2_TRUST_SYSTEM_ACTOR_ID: optionalToken(lowercaseUuid, 36),
});

const d2TrustReviewerAssignmentSchema = z
  .object({
    issuer: z.string().url().max(2_048),
    subject: z.string().min(1).max(255),
    roles: z.array(z.enum(trustReviewerRoles)).min(1).max(trustReviewerRoles.length),
    verifiedRequesterTakedown: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.roles).size !== value.roles.length) {
      context.addIssue({ code: "custom", message: "Trust reviewer roles must be unique" });
    }
  });

const d2TrustEvidenceSchema = z
  .object({
    contributionId: z.string().regex(lowercaseUuidV7),
    evidenceDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    purposes: z.array(z.enum(trustEvidencePurposes)).min(1).max(trustEvidencePurposes.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.purposes).size !== value.purposes.length) {
      context.addIssue({ code: "custom", message: "Trust evidence purposes must be unique" });
    }
  });

export interface D2LambdaGatewayTrustConfiguration {
  developmentTestTakedownEnabled?: boolean;
  reviewerAssignments: readonly z.infer<typeof d2TrustReviewerAssignmentSchema>[];
  evidenceAllowlist: readonly z.infer<typeof d2TrustEvidenceSchema>[];
  policyVersion: string;
  appealWindowMilliseconds: number;
  systemActorId: string;
}

export interface D2LambdaGatewayConfiguration {
  valid: boolean;
  developmentContributionsEnabled: boolean;
  developmentContributionProviders?: readonly D2DevelopmentContributionProvider[];
  developmentContributionDomains?: readonly D2DevelopmentContributionDomain[];
  privateCaptureRoutesEnabled: boolean;
  contributionPolicyRouteEnabled: boolean;
  contributionRoutesEnabled: boolean;
  trustReviewerRoutesEnabled: boolean;
  ugcContributionPolicyVersion?: string;
  signedContributionPolicyConfigured: boolean;
  trust?: D2LambdaGatewayTrustConfiguration;
}

const disabledD2LambdaGatewayConfiguration = Object.freeze({
  valid: false,
  developmentContributionsEnabled: false,
  privateCaptureRoutesEnabled: false,
  contributionPolicyRouteEnabled: false,
  contributionRoutesEnabled: false,
  trustReviewerRoutesEnabled: false,
  signedContributionPolicyConfigured: false,
});

function parseBoundedJson<T>(value: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Phase 2 Gateway configuration is malformed");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error("Phase 2 Gateway configuration is malformed");
  return result.data;
}

/** Explicit development provider selection; absence preserves existing Greenhouse-only behavior. */
export function loadD2DevelopmentContributionProviders(
  environment: NodeJS.ProcessEnv = process.env,
): readonly D2DevelopmentContributionProvider[] {
  const configured = environment.D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON;
  const explicitDevelopment =
    environment.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED === "true" &&
    environment.D2_DEPLOYMENT_ENVIRONMENT === "development";
  if (!explicitDevelopment) {
    if (configured !== undefined || environment.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED === "true") {
      throw new Error(
        "Development contribution provider selection requires explicit development mode",
      );
    }
    return Object.freeze([]);
  }
  if (configured === undefined) return Object.freeze(["greenhouse"]);
  if (configured.length > 128) {
    throw new Error("Development contribution provider selection exceeds its configuration bound");
  }
  return Object.freeze(parseBoundedJson(configured, d2DevelopmentContributionProviderSchema));
}

/** Additional exact-host restriction; absence preserves each immutable provider descriptor. */
export function loadD2DevelopmentContributionDomains(
  environment: NodeJS.ProcessEnv = process.env,
): readonly D2DevelopmentContributionDomain[] | undefined {
  const configured = environment.D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON;
  const explicitDevelopment =
    environment.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED === "true" &&
    environment.D2_DEPLOYMENT_ENVIRONMENT === "development";
  if (!explicitDevelopment) {
    if (configured !== undefined || environment.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED === "true") {
      throw new Error(
        "Development contribution domain selection requires explicit development mode",
      );
    }
    return undefined;
  }
  if (configured === undefined) return undefined;
  if (typeof configured !== "string" || configured.length > 256) {
    throw new Error("Development contribution domain selection exceeds its configuration bound");
  }
  return Object.freeze(parseBoundedJson(configured, d2DevelopmentContributionDomainSchema));
}

/**
 * Parses only the default-dark Phase 2 Gateway boundary. Callers should use the safe loader in a
 * shared Gateway process so a malformed optional D2 configuration cannot disable existing D1
 * routes.
 */
export function loadD2LambdaGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): D2LambdaGatewayConfiguration {
  const explicitDevelopment =
    environment.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED === "true" &&
    environment.D2_DEPLOYMENT_ENVIRONMENT === "development";
  // Retired signature inputs and the retained legacy route flag cannot invalidate development
  // intake. They never create an unsigned projection or weaken any other deployment environment.
  const value = d2LambdaGatewayEnvironmentSchema.parse(
    explicitDevelopment
      ? {
          ...environment,
          JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: undefined,
          JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON: undefined,
        }
      : environment,
  );
  if (
    value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED &&
    value.D2_DEPLOYMENT_ENVIRONMENT !== "development"
  ) {
    throw new Error(
      "Persistent development contributions require the exact development environment",
    );
  }
  const developmentContributionProviders = loadD2DevelopmentContributionProviders(environment);
  const developmentContributionDomains = loadD2DevelopmentContributionDomains(environment);
  const policyPair =
    Boolean(value.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON) ===
    Boolean(value.JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON);
  if (!value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED && !policyPair) {
    throw new Error("The signed contribution policy boundary must be complete");
  }
  const signedContributionPolicyConfigured = Boolean(
    value.JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON &&
      value.JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON,
  );

  const trustFields = [
    value.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON,
    value.D2_TRUST_EVIDENCE_ALLOWLIST_JSON,
    value.D2_TRUST_POLICY_VERSION,
    value.D2_TRUST_APPEAL_WINDOW_MILLISECONDS,
    value.D2_TRUST_SYSTEM_ACTOR_ID,
  ];
  const trustFieldCount = trustFields.filter(Boolean).length;
  if (trustFieldCount !== 0 && trustFieldCount !== trustFields.length) {
    throw new Error("The Trust Gateway boundary must be complete");
  }

  let trust: D2LambdaGatewayTrustConfiguration | undefined;
  if (trustFieldCount === trustFields.length) {
    const reviewerAssignments = parseBoundedJson(
      value.D2_TRUST_REVIEWER_ASSIGNMENTS_JSON as string,
      z.array(d2TrustReviewerAssignmentSchema).max(64),
    );
    const assignmentKeys = reviewerAssignments.map(
      (assignment) => `${assignment.issuer}\0${assignment.subject}`,
    );
    if (new Set(assignmentKeys).size !== assignmentKeys.length) {
      throw new Error("Trust reviewer assignments must be unique");
    }
    const evidenceAllowlist = parseBoundedJson(
      value.D2_TRUST_EVIDENCE_ALLOWLIST_JSON as string,
      z.array(d2TrustEvidenceSchema).max(256),
    );
    const evidenceKeys = evidenceAllowlist.flatMap((evidence) =>
      evidence.purposes.map(
        (purpose) => `${evidence.contributionId}\0${evidence.evidenceDigestSha256}\0${purpose}`,
      ),
    );
    if (new Set(evidenceKeys).size !== evidenceKeys.length) {
      throw new Error("Trust evidence assignments must be unique");
    }
    const developmentTestTakedownEnabled = evidenceAllowlist.some((evidence) =>
      evidence.purposes.includes("development_test_takedown"),
    );
    if (developmentTestTakedownEnabled && !explicitDevelopment) {
      throw new Error("Test takedown evidence requires explicit development contributions");
    }
    const appealWindowMilliseconds = Number(value.D2_TRUST_APPEAL_WINDOW_MILLISECONDS);
    if (
      !Number.isSafeInteger(appealWindowMilliseconds) ||
      appealWindowMilliseconds < 1 ||
      appealWindowMilliseconds > 365 * 24 * 60 * 60 * 1_000
    ) {
      throw new Error("The Trust appeal window is outside the technical bound");
    }
    trust = Object.freeze({
      ...(developmentTestTakedownEnabled ? { developmentTestTakedownEnabled: true } : {}),
      reviewerAssignments: Object.freeze(reviewerAssignments),
      evidenceAllowlist: Object.freeze(evidenceAllowlist),
      policyVersion: value.D2_TRUST_POLICY_VERSION as string,
      appealWindowMilliseconds,
      systemActorId: value.D2_TRUST_SYSTEM_ACTOR_ID as string,
    });
  }

  if (
    !value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED &&
    value.D2_CONTRIBUTION_POLICY_ROUTE_ENABLED &&
    !signedContributionPolicyConfigured
  ) {
    throw new Error("The contribution policy route requires the complete signed policy boundary");
  }
  if (
    value.D2_CONTRIBUTION_ROUTES_ENABLED &&
    ((!signedContributionPolicyConfigured && !value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED) ||
      !value.UGC_CONTRIBUTION_POLICY_VERSION)
  ) {
    throw new Error(
      "Contribution mutation routes require the signed capability and consent policies",
    );
  }
  if ((value.D2_CONTRIBUTION_ROUTES_ENABLED || value.D2_TRUST_REVIEWER_ROUTES_ENABLED) && !trust) {
    throw new Error("Contribution and reviewer routes require the complete Trust boundary");
  }
  if (value.D2_TRUST_REVIEWER_ROUTES_ENABLED && trust?.reviewerAssignments.length === 0) {
    throw new Error("Reviewer routes require at least one explicit reviewer assignment");
  }

  return Object.freeze({
    valid: true,
    developmentContributionsEnabled: value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED,
    ...(value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED ? { developmentContributionProviders } : {}),
    ...(developmentContributionDomains !== undefined ? { developmentContributionDomains } : {}),
    privateCaptureRoutesEnabled: value.D2_PRIVATE_CAPTURE_ROUTES_ENABLED,
    contributionPolicyRouteEnabled:
      !value.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED && value.D2_CONTRIBUTION_POLICY_ROUTE_ENABLED,
    contributionRoutesEnabled: value.D2_CONTRIBUTION_ROUTES_ENABLED,
    trustReviewerRoutesEnabled: value.D2_TRUST_REVIEWER_ROUTES_ENABLED,
    ...(value.UGC_CONTRIBUTION_POLICY_VERSION
      ? { ugcContributionPolicyVersion: value.UGC_CONTRIBUTION_POLICY_VERSION }
      : {}),
    signedContributionPolicyConfigured,
    ...(trust ? { trust } : {}),
  });
}

/** Fail only the optional D2 surface; existing Gateway capabilities remain available. */
export function loadD2LambdaGatewayConfigSafely(
  environment: NodeJS.ProcessEnv = process.env,
): D2LambdaGatewayConfiguration {
  const privateCaptureResult = z
    .object({ D2_PRIVATE_CAPTURE_ROUTES_ENABLED: exactDisabledBoolean })
    .safeParse(environment);
  const privateCaptureRoutesEnabled = privateCaptureResult.success
    ? privateCaptureResult.data.D2_PRIVATE_CAPTURE_ROUTES_ENABLED
    : false;
  try {
    return loadD2LambdaGatewayConfig(environment);
  } catch {
    return privateCaptureRoutesEnabled
      ? Object.freeze({
          ...disabledD2LambdaGatewayConfiguration,
          privateCaptureRoutesEnabled: true,
        })
      : disabledD2LambdaGatewayConfiguration;
  }
}

const publicJobLambdaSchema = baseSchema.extend({
  AWS_REGION: z.literal("us-east-2"),
  PUBLIC_JOB_DATABASE_HOST: z.string().regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.rds\.amazonaws\.com$/),
  PUBLIC_JOB_DATABASE_PORT: z.coerce.number().pipe(z.literal(5432)).default(5432),
  PUBLIC_JOB_DATABASE_NAME: z.literal("ai_job_apply"),
  PUBLIC_JOB_DATABASE_USER: z.literal("ai_job_apply_public_job_reader"),
  PUBLIC_JOB_CACHE_CAPACITY: z.coerce.number().int().min(1).max(256).default(128),
  PUBLIC_JOB_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(30_000).default(15_000),
  PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS: z.coerce.number().int().min(250).max(5_000).default(2_000),
  ...telemetrySchema,
});

export type PublicJobLambdaConfig = z.infer<typeof publicJobLambdaSchema>;

export function loadBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  return backendSchema.parse(environment);
}

export function loadLambdaGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LambdaGatewayConfig {
  return lambdaGatewaySchema.parse(environment);
}

export function loadPublicJobLambdaConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PublicJobLambdaConfig {
  return publicJobLambdaSchema.parse(environment);
}
