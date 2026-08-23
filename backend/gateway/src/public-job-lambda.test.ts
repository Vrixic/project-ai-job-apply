import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  createLazyPublicJobHandler,
  LambdaPublicJobDetailReader,
  parseProjectionResult,
} from "./public-job-lambda.js";
import { publicJobPostgresOptions } from "./public-job-projection-lambda.js";

const jobId = "019c0000-0000-7000-8000-000000000001";
const availableProjection = {
  kind: "available",
  requestedJobId: jobId,
  canonicalJobId: jobId,
  isAlias: false,
  job: {
    id: jobId,
    companyName: "Company",
    title: "Engineer",
    locations: ["Remote"],
    description: "Build reliable systems.",
    firstObservedAt: "2026-08-20T00:00:00.000Z",
    lastVerifiedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-09-21T00:00:00.000Z",
  },
} as const;

describe("public job Lambda module", () => {
  it("exports a lazy handler without requiring runtime secrets at import", async () => {
    const module = await import("./public-job-lambda.js");
    expect(module.handler).toBeTypeOf("function");
    expect(module.handler).toHaveLength(2);
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
    const failed = await handler(event, {} as never);
    expect(failed).toMatchObject({
      statusCode: 503,
      headers: { "cache-control": "no-store", "retry-after": "5" },
    });
    expect(failed.body).not.toContain("secret");
    await expect(handler(event, {} as never)).resolves.toMatchObject({ statusCode: 200 });
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it("maps configured handler rejection without reinitializing", async () => {
    const configured = vi.fn().mockRejectedValue(new Error("runtime secret"));
    const initialize = vi.fn(async () => configured);
    const handler = createLazyPublicJobHandler(initialize);
    const event = { requestContext: { requestId: "request-id" } } as APIGatewayProxyEventV2;
    await expect(handler(event, {} as never)).resolves.toMatchObject({ statusCode: 503 });
    await expect(handler(event, {} as never)).resolves.toMatchObject({ statusCode: 503 });
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
        application_name: "public-job-projection",
        default_transaction_read_only: true,
        idle_in_transaction_session_timeout: 5_000,
        lock_timeout: 1_000,
        statement_timeout: 2_000,
      },
    });
  });

  it("invokes only the qualified private projection with an identifier-only payload", async () => {
    const send = vi.fn(async (_command: unknown) => ({
      StatusCode: 200,
      ExecutedVersion: "3",
      Payload: new TextEncoder().encode(JSON.stringify({ kind: "absent" })),
    }));
    const reader = new LambdaPublicJobDetailReader(
      { send } as never,
      "arn:aws:lambda:us-east-2:111122223333:function:projection:development",
    );
    await expect(reader.get(jobId)).resolves.toEqual({ kind: "absent" });
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    if (!command) throw new Error("Expected one projection invocation");
    const input = (
      command as {
        input: { FunctionName: string; InvocationType: string; Payload: Uint8Array };
      }
    ).input;
    expect(input).toMatchObject({
      FunctionName: "arn:aws:lambda:us-east-2:111122223333:function:projection:development",
      InvocationType: "RequestResponse",
    });
    expect(JSON.parse(new TextDecoder().decode(input.Payload))).toEqual({
      schemaVersion: 1,
      jobId,
    });
  });

  it("rejects malformed, oversized, errored, and mutable projection responses", async () => {
    expect(() =>
      parseProjectionResult(new TextEncoder().encode('{"kind":"absent","extra":true}')),
    ).toThrow();
    expect(() => parseProjectionResult(new Uint8Array(256_001))).toThrow();
    expect(() =>
      parseProjectionResult(
        new TextEncoder().encode(
          JSON.stringify({
            ...availableProjection,
            isAlias: true,
          }),
        ),
      ),
    ).toThrow();
    expect(() =>
      parseProjectionResult(
        new TextEncoder().encode(
          JSON.stringify({
            ...availableProjection,
            job: { ...availableProjection.job, locations: [] },
          }),
        ),
      ),
    ).toThrow();
    expect(
      parseProjectionResult(new TextEncoder().encode(JSON.stringify(availableProjection))),
    ).toEqual(availableProjection);
    const failed = new LambdaPublicJobDetailReader(
      { send: vi.fn(async () => ({ StatusCode: 200, FunctionError: "Unhandled" })) } as never,
      "arn:aws:lambda:us-east-2:111122223333:function:projection:development",
    );
    await expect(failed.get(jobId)).rejects.toThrow("invocation failed");
    const latest = new LambdaPublicJobDetailReader(
      {
        send: vi.fn(async () => ({
          StatusCode: 200,
          ExecutedVersion: "$LATEST",
          Payload: new TextEncoder().encode(JSON.stringify({ kind: "absent" })),
        })),
      } as never,
      "arn:aws:lambda:us-east-2:111122223333:function:projection:development",
    );
    await expect(latest.get(jobId)).rejects.toThrow("invocation failed");
  });
});
