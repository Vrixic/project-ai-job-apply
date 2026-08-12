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

  it("accepts a complete candidate-document upload boundary", () => {
    const result = loadLambdaGatewayConfig({
      ...baseEnvironment,
      DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
      OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
      DOCUMENT_UPLOAD_BUCKET: "ai-job-apply-development-candidate-documents",
      DOCUMENT_UPLOAD_KMS_KEY_ARN:
        "arn:aws:kms:us-east-2:000000000000:key/00000000-0000-4000-8000-000000000000",
    });

    expect(result.DOCUMENT_UPLOAD_BUCKET).toBe("ai-job-apply-development-candidate-documents");
  });

  it("rejects a partial candidate-document upload boundary", () => {
    expect(() =>
      loadLambdaGatewayConfig({
        ...baseEnvironment,
        DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
        OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
        DOCUMENT_UPLOAD_BUCKET: "ai-job-apply-development-candidate-documents",
      }),
    ).toThrow("DOCUMENT_UPLOAD_BUCKET and DOCUMENT_UPLOAD_KMS_KEY_ARN must be configured together");
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
