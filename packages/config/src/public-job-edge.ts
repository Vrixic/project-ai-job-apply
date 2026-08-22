import { z } from "zod";

const publicJobEdgeLambdaSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  RELEASE_SHA: z.string().default("local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  AWS_REGION: z.literal("us-east-2"),
  PUBLIC_JOB_PROJECTION_ARN: z
    .string()
    .regex(
      /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[a-zA-Z0-9-_]{1,64}:[a-zA-Z0-9-_]{1,128}$/,
    ),
  PUBLIC_JOB_CACHE_CAPACITY: z.coerce.number().int().min(1).max(256).default(128),
  PUBLIC_JOB_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(30_000).default(15_000),
  PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS: z.coerce.number().int().min(250).max(5_000).default(2_000),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1),
});

export type PublicJobEdgeLambdaConfig = z.infer<typeof publicJobEdgeLambdaSchema>;

export function loadPublicJobEdgeLambdaConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PublicJobEdgeLambdaConfig {
  return publicJobEdgeLambdaSchema.parse(environment);
}
