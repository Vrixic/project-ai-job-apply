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
