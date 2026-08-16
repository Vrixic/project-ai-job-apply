import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { createLazyPublicJobHandler, publicJobPostgresOptions } from "./public-job-lambda.js";

describe("public job Lambda module", () => {
  it("exports a lazy handler without requiring runtime secrets at import", async () => {
    const module = await import("./public-job-lambda.js");
    expect(module.handler).toBeTypeOf("function");
    expect(module.createConfiguredPublicJobHandler).toBeTypeOf("function");
  });

  it("maps initialization failures privately and retries initialization", async () => {
    const initialize = vi
      .fn()
      .mockRejectedValueOnce(new Error("secret value"))
      .mockResolvedValueOnce(async () => ({ statusCode: 200, body: "{}" }));
    const handler = createLazyPublicJobHandler(initialize);
    const event = {
      requestContext: { requestId: "request-id" },
    } as APIGatewayProxyEventV2;
    const failed = await handler(event, {} as never, vi.fn());
    expect(failed).toMatchObject({
      statusCode: 503,
      headers: { "cache-control": "no-store", "retry-after": "5" },
    });
    expect(failed.body).not.toContain("secret");
    await expect(handler(event, {} as never, vi.fn())).resolves.toMatchObject({ statusCode: 200 });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("maps configured handler rejection without reinitializing", async () => {
    const configured = vi.fn().mockRejectedValue(new Error("runtime secret"));
    const initialize = vi.fn(async () => configured);
    const handler = createLazyPublicJobHandler(initialize);
    const event = { requestContext: { requestId: "request-id" } } as APIGatewayProxyEventV2;
    await expect(handler(event, {} as never, vi.fn())).resolves.toMatchObject({ statusCode: 503 });
    await expect(handler(event, {} as never, vi.fn())).resolves.toMatchObject({ statusCode: 503 });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(configured).toHaveBeenCalledTimes(2);
  });

  it("binds dynamic IAM authentication to exact verified-host TLS", () => {
    const password = vi.fn(async () => "short-lived-token");
    const options = publicJobPostgresOptions(
      {
        NODE_ENV: "production",
        RELEASE_SHA: "a".repeat(64),
        LOG_LEVEL: "info",
        AWS_REGION: "us-east-2",
        PUBLIC_JOB_DATABASE_HOST: "database.cluster.us-east-2.rds.amazonaws.com",
        PUBLIC_JOB_DATABASE_PORT: 5432,
        PUBLIC_JOB_DATABASE_NAME: "ai_job_apply",
        PUBLIC_JOB_DATABASE_USER: "ai_job_apply_public_job_reader",
        PUBLIC_JOB_CACHE_CAPACITY: 128,
        PUBLIC_JOB_CACHE_TTL_MS: 15_000,
        PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS: 2_000,
        OTEL_TRACE_SAMPLE_RATIO: 1,
      },
      password,
    );
    expect(options).toMatchObject({
      host: "database.cluster.us-east-2.rds.amazonaws.com",
      username: "ai_job_apply_public_job_reader",
      ssl: "verify-full",
      max: 1,
      connect_timeout: 2,
      password,
      connection: {
        application_name: "public-job-reader",
        default_transaction_read_only: true,
        idle_in_transaction_session_timeout: 5_000,
        lock_timeout: 1_000,
        statement_timeout: 2_000,
      },
    });
  });
});
