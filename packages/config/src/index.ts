import { z } from "zod";
export { DEFAULT_PRODUCT_BRAND, resolveProductBrand } from "./brand.js";
export type { ProductBrand, ProductBrandOverrides } from "./brand.js";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RELEASE_SHA: z.string().default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const backendSchema = baseSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("profile-readiness-v1"),
  TEMPORAL_API_KEY: z.string().min(1).optional(),
  TEMPORAL_TLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1).default("ai-job-apply-api"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1),
});

export type BackendConfig = z.infer<typeof backendSchema>;

const workerSchema = backendSchema.omit({
  PORT: true,
  REDIS_URL: true,
  OIDC_ISSUER: true,
  OIDC_AUDIENCE: true,
});

export type WorkerConfig = z.infer<typeof workerSchema>;

export function loadBackendConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  return backendSchema.parse(environment);
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerSchema.parse(environment);
}
