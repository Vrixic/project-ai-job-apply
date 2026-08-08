import { describe, expect, it } from "vitest";
import { loadLambdaGatewayConfig } from "./index.js";

const baseEnvironment = {
  NODE_ENV: "production",
  OIDC_ISSUER: "https://identity.example.test/",
  OIDC_AUDIENCE: "ai-job-apply-api",
};

describe("Lambda gateway configuration", () => {
  it("accepts one managed database secret identifier", () => {
    const result = loadLambdaGatewayConfig({
      ...baseEnvironment,
      DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
      OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
    });

    expect(result.DATABASE_SECRET_ID).toBe("ai-job-apply/development/database-url");
    expect(result.DATABASE_URL).toBeUndefined();
    expect(result.OUTBOX_DISPATCH_TARGET).toBe("lambda_durable");
  });

  it("requires an exact queue URL for Lambda durable dispatch", () => {
    expect(() =>
      loadLambdaGatewayConfig({
        ...baseEnvironment,
        DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
      }),
    ).toThrow();

    expect(
      loadLambdaGatewayConfig({
        ...baseEnvironment,
        DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
        OUTBOX_DISPATCH_TARGET: "lambda_durable",
        OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
      }).OUTBOX_DISPATCH_TARGET,
    ).toBe("lambda_durable");
  });

  it("accepts a direct database URL for local conformance", () => {
    const result = loadLambdaGatewayConfig({
      ...baseEnvironment,
      DATABASE_URL: "postgres://candidate:local@localhost:5432/ai_job_apply",
      OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
    });

    expect(result.DATABASE_URL).toContain("postgres://");
  });

  it.each([
    ["neither source", {}],
    [
      "both sources",
      {
        DATABASE_URL: "postgres://candidate:local@localhost:5432/ai_job_apply",
        DATABASE_SECRET_ID: "database-secret",
      },
    ],
  ])("rejects %s", (_label, databaseEnvironment) => {
    expect(() =>
      loadLambdaGatewayConfig({
        ...baseEnvironment,
        ...databaseEnvironment,
        OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
      }),
    ).toThrow("Exactly one of DATABASE_URL or DATABASE_SECRET_ID is required");
  });
});
