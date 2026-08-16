import { loadPublicJobLambdaConfig, type PublicJobLambdaConfig } from "@ai-job-apply/config";
import { PostgresPublicJobDetailReader } from "@ai-job-apply/jobs-service";
import { initializeTelemetry } from "@ai-job-apply/observability";
import { Signer } from "@aws-sdk/rds-signer";
import postgres from "postgres";
import {
  createPublicJobReadHandler,
  type PublicJobHandler,
  PublicJobReadCache,
  publicJobUnavailableResponse,
} from "./public-job-read.js";

export function publicJobPostgresOptions(
  config: PublicJobLambdaConfig,
  password: () => Promise<string>,
) {
  return {
    host: config.PUBLIC_JOB_DATABASE_HOST,
    port: config.PUBLIC_JOB_DATABASE_PORT,
    database: config.PUBLIC_JOB_DATABASE_NAME,
    username: config.PUBLIC_JOB_DATABASE_USER,
    password,
    ssl: "verify-full" as const,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 2,
    transform: postgres.camel,
    connection: {
      application_name: "public-job-reader",
      default_transaction_read_only: true,
      idle_in_transaction_session_timeout: 5_000,
      lock_timeout: 1_000,
      statement_timeout: 2_000,
    },
  };
}

export async function createConfiguredPublicJobHandler(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PublicJobHandler> {
  const config = loadPublicJobLambdaConfig(environment);
  initializeTelemetry({
    service: "public-job-reader",
    environment: config.NODE_ENV,
    releaseSha: config.RELEASE_SHA,
    sampleRatio: config.OTEL_TRACE_SAMPLE_RATIO,
    ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
  });
  const signer = new Signer({
    hostname: config.PUBLIC_JOB_DATABASE_HOST,
    port: config.PUBLIC_JOB_DATABASE_PORT,
    username: config.PUBLIC_JOB_DATABASE_USER,
    region: config.AWS_REGION,
  });
  const client = postgres(publicJobPostgresOptions(config, () => signer.getAuthToken()));
  return createPublicJobReadHandler(
    new PublicJobReadCache(new PostgresPublicJobDetailReader(client), {
      capacity: config.PUBLIC_JOB_CACHE_CAPACITY,
      positiveTtlMs: config.PUBLIC_JOB_CACHE_TTL_MS,
      negativeTtlMs: config.PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS,
    }),
  );
}

export function createLazyPublicJobHandler(
  initialize: () => Promise<PublicJobHandler>,
): PublicJobHandler {
  let configured: PublicJobHandler | undefined;
  let initialization: Promise<PublicJobHandler> | undefined;
  return async (event, context, callback) => {
    if (!configured) {
      try {
        initialization ??= initialize();
        configured = await initialization;
      } catch {
        initialization = undefined;
        return publicJobUnavailableResponse(event.requestContext.requestId);
      }
    }
    try {
      return await configured(event, context, callback);
    } catch {
      return publicJobUnavailableResponse(event.requestContext.requestId);
    }
  };
}

export const handler = createLazyPublicJobHandler(() => createConfiguredPublicJobHandler());
