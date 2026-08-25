import { loadPublicJobLambdaConfig, type PublicJobLambdaConfig } from "@ai-job-apply/config";
import {
  PostgresPublicJobDetailReader,
  PostgresPublicJobSitemapReader,
  PublicJobDetailProjector,
  type PublicJobDetailResult,
  type PublicJobSitemapProjectionPage,
  PublicJobSitemapProjector,
} from "@ai-job-apply/jobs-service";
import { initializeTelemetry } from "@ai-job-apply/observability";
import { Signer } from "@aws-sdk/rds-signer";
import type { Context } from "aws-lambda";
import postgres from "postgres";

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
      application_name: "public-job-projection",
      default_transaction_read_only: true,
      idle_in_transaction_session_timeout: 5_000,
      lock_timeout: 1_000,
      statement_timeout: 2_000,
    },
  };
}

type ProjectionResult = PublicJobDetailResult | PublicJobSitemapProjectionPage;
type ProjectionHandler = (event: unknown, context: Context) => Promise<ProjectionResult>;

export function createProjectionHandler(
  projector: Pick<PublicJobDetailProjector, "get">,
  sitemapProjector?: Pick<PublicJobSitemapProjector, "list">,
): ProjectionHandler {
  return async (event) => {
    if (
      sitemapProjector &&
      event &&
      typeof event === "object" &&
      !Array.isArray(event) &&
      Object.keys(event).length === 3 &&
      (event as Record<string, unknown>).schemaVersion === 1 &&
      (event as Record<string, unknown>).operation === "sitemap"
    ) {
      const rawCursor = (event as Record<string, unknown>).cursor;
      if (
        rawCursor !== null &&
        (!rawCursor ||
          typeof rawCursor !== "object" ||
          Array.isArray(rawCursor) ||
          Object.keys(rawCursor).length !== 2 ||
          typeof (rawCursor as Record<string, unknown>).jobId !== "string" ||
          !uuidV7Pattern.test((rawCursor as Record<string, unknown>).jobId as string) ||
          typeof (rawCursor as Record<string, unknown>).lastModifiedAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
            (rawCursor as Record<string, unknown>).lastModifiedAt as string,
          ))
      ) {
        throw new Error("The public sitemap projection request is invalid");
      }
      return sitemapProjector.list(
        rawCursor === null
          ? undefined
          : {
              jobId: (rawCursor as Record<string, unknown>).jobId as string,
              lastModifiedAt: (rawCursor as Record<string, unknown>).lastModifiedAt as string,
            },
      );
    }
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.keys(event).length !== 2 ||
      (event as Record<string, unknown>).schemaVersion !== 1 ||
      typeof (event as Record<string, unknown>).jobId !== "string" ||
      !uuidV7Pattern.test((event as Record<string, unknown>).jobId as string)
    ) {
      throw new Error("The public projection request is invalid");
    }
    return projector.get((event as Record<string, unknown>).jobId as string);
  };
}

export async function createConfiguredProjectionHandler(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProjectionHandler> {
  const config = loadPublicJobLambdaConfig(environment);
  initializeTelemetry({
    service: "public-job-projection",
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
  return createProjectionHandler(
    new PublicJobDetailProjector(new PostgresPublicJobDetailReader(client)),
    new PublicJobSitemapProjector(new PostgresPublicJobSitemapReader(client)),
  );
}

export function createLazyProjectionHandler(
  initialize: () => Promise<ProjectionHandler>,
): ProjectionHandler {
  let configured: ProjectionHandler | undefined;
  let initialization: Promise<ProjectionHandler> | undefined;
  return async (event, context) => {
    if (!configured) {
      initialization ??= initialize().catch((error) => {
        initialization = undefined;
        throw error;
      });
      configured = await initialization;
    }
    return configured(event, context);
  };
}

export const projectionHandler = createLazyProjectionHandler(() =>
  createConfiguredProjectionHandler(),
);
