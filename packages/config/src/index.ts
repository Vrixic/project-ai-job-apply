import { z } from "zod";

export type { ProductBrand, ProductBrandOverrides } from "./brand.js";
export { DEFAULT_PRODUCT_BRAND, resolveProductBrand } from "./brand.js";

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

const backendSchema = baseSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  ...oidcSchema,
  ...telemetrySchema,
});

export type BackendConfig = z.infer<typeof backendSchema>;

const lambdaGatewaySchema = baseSchema
  .extend({
    DATABASE_URL: z.string().url().optional(),
    DATABASE_SECRET_ID: z.string().min(1).optional(),
    OUTBOX_DISPATCH_TARGET: z.literal("lambda_durable").default("lambda_durable"),
    OUTBOX_QUEUE_URL: z.string().url(),
    ...oidcSchema,
    ...telemetrySchema,
  })
  .refine(
    (value) => Boolean(value.DATABASE_URL) !== Boolean(value.DATABASE_SECRET_ID),
    "Exactly one of DATABASE_URL or DATABASE_SECRET_ID is required",
  );

export type LambdaGatewayConfig = z.infer<typeof lambdaGatewaySchema>;

export function loadBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  return backendSchema.parse(environment);
}

export function loadLambdaGatewayConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LambdaGatewayConfig {
  return lambdaGatewaySchema.parse(environment);
}
