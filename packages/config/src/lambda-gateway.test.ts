import { describe, expect, it } from "vitest";
import {
  loadD2LambdaGatewayConfig,
  loadD2LambdaGatewayConfigSafely,
  loadLambdaGatewayConfig,
} from "./index.js";

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

  it("accepts a bounded Auth0 ID-token client audience and rejects malformed values", () => {
    const result = loadLambdaGatewayConfig({
      ...baseEnvironment,
      DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
      OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
      OIDC_ID_TOKEN_AUDIENCE: "auth0ClientId_1234567890",
    });
    expect(result.OIDC_ID_TOKEN_AUDIENCE).toBe("auth0ClientId_1234567890");
    expect(() =>
      loadLambdaGatewayConfig({
        ...baseEnvironment,
        DATABASE_SECRET_ID: "ai-job-apply/development/database-url",
        OUTBOX_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/000000000000/synthetic",
        OIDC_ID_TOKEN_AUDIENCE: "not valid",
      }),
    ).toThrow();
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

const signedCapabilityEnvironment = {
  JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: '{"synthetic":true}',
  JOB_CONTRIBUTION_CAPABILITY_PUBLIC_KEYS_JSON: '{"synthetic-key":"public"}',
};
const signedPolicyEnvironment = {
  UGC_CONTRIBUTION_POLICY_VERSION: "d2-synthetic-policy.v1",
  ...signedCapabilityEnvironment,
};
const trustEnvironment = {
  D2_TRUST_REVIEWER_ASSIGNMENTS_JSON: JSON.stringify([
    {
      issuer: "https://identity.example.test/",
      subject: "auth0|reviewer-synthetic",
      roles: ["case_reader", "initial_reviewer"],
      verifiedRequesterTakedown: false,
    },
  ]),
  D2_TRUST_EVIDENCE_ALLOWLIST_JSON: "[]",
  D2_TRUST_POLICY_VERSION: "d2-synthetic-trust.v1",
  D2_TRUST_APPEAL_WINDOW_MILLISECONDS: "1000",
  D2_TRUST_SYSTEM_ACTOR_ID: "019d04cf-1f80-7000-8000-000000000099",
};

describe("Phase 2 Lambda gateway configuration", () => {
  it("permits the explicit development-only contribution mode without signed-policy inputs", () => {
    const values = {
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
      D2_CONTRIBUTION_ROUTES_ENABLED: "true",
      UGC_CONTRIBUTION_POLICY_VERSION: "d2-ugc.v1",
      ...trustEnvironment,
    };
    expect(loadD2LambdaGatewayConfig(values)).toMatchObject({
      valid: true,
      developmentContributionsEnabled: true,
      contributionRoutesEnabled: true,
      contributionPolicyRouteEnabled: false,
      signedContributionPolicyConfigured: false,
    });
    for (const target of [undefined, "staging", "production", "development "]) {
      expect(() =>
        loadD2LambdaGatewayConfig({ ...values, D2_DEPLOYMENT_ENVIRONMENT: target }),
      ).toThrow();
    }
    expect(() =>
      loadD2LambdaGatewayConfig({ ...values, D2_CONTRIBUTION_POLICY_ROUTE_ENABLED: "true" }),
    ).toThrow("policy route");
    expect(() =>
      loadD2LambdaGatewayConfig({ ...values, UGC_CONTRIBUTION_POLICY_VERSION: undefined }),
    ).toThrow("consent policies");
    expect(() =>
      loadD2LambdaGatewayConfig({ ...values, D2_TRUST_POLICY_VERSION: undefined }),
    ).toThrow("Trust");
  });

  it("is independently default-dark without inventing policy, authority, or timing", () => {
    expect(loadD2LambdaGatewayConfig({})).toEqual({
      valid: true,
      developmentContributionsEnabled: false,
      privateCaptureRoutesEnabled: false,
      contributionPolicyRouteEnabled: false,
      contributionRoutesEnabled: false,
      trustReviewerRoutesEnabled: false,
      signedContributionPolicyConfigured: false,
    });
  });

  it("allows private capture independently of every public-contribution boundary", () => {
    expect(loadD2LambdaGatewayConfig({ D2_PRIVATE_CAPTURE_ROUTES_ENABLED: "true" })).toMatchObject({
      privateCaptureRoutesEnabled: true,
      contributionPolicyRouteEnabled: false,
      contributionRoutesEnabled: false,
      trustReviewerRoutesEnabled: false,
      signedContributionPolicyConfigured: false,
    });
  });

  it("keeps an explicitly enabled private-capture boundary independent of malformed contribution configuration", () => {
    expect(
      loadD2LambdaGatewayConfigSafely({
        D2_PRIVATE_CAPTURE_ROUTES_ENABLED: "true",
        D2_CONTRIBUTION_POLICY_ROUTE_ENABLED: "true",
        JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: "{}",
      }),
    ).toEqual({
      valid: false,
      developmentContributionsEnabled: false,
      privateCaptureRoutesEnabled: true,
      contributionPolicyRouteEnabled: false,
      contributionRoutesEnabled: false,
      trustReviewerRoutesEnabled: false,
      signedContributionPolicyConfigured: false,
    });
  });

  it("requires the exact signed policy pair but no mutation consent policy for the read-only policy route", () => {
    expect(() =>
      loadD2LambdaGatewayConfig({
        D2_CONTRIBUTION_POLICY_ROUTE_ENABLED: "true",
        JOB_CONTRIBUTION_CAPABILITY_POLICY_JSON: "{}",
      }),
    ).toThrow("signed contribution policy boundary must be complete");
    expect(
      loadD2LambdaGatewayConfig({
        D2_CONTRIBUTION_POLICY_ROUTE_ENABLED: "true",
        ...signedCapabilityEnvironment,
      }),
    ).toMatchObject({
      contributionPolicyRouteEnabled: true,
      signedContributionPolicyConfigured: true,
    });
  });

  it("still requires the consent policy before any contribution mutation route", () => {
    expect(() =>
      loadD2LambdaGatewayConfig({
        D2_CONTRIBUTION_ROUTES_ENABLED: "true",
        ...signedCapabilityEnvironment,
        ...trustEnvironment,
      }),
    ).toThrow("signed capability and consent policies");
  });

  it("requires a complete bounded Trust authority and policy for candidate or reviewer routes", () => {
    expect(() =>
      loadD2LambdaGatewayConfig({
        D2_CONTRIBUTION_ROUTES_ENABLED: "true",
        ...signedPolicyEnvironment,
      }),
    ).toThrow("complete Trust boundary");
    const configured = loadD2LambdaGatewayConfig({
      D2_CONTRIBUTION_ROUTES_ENABLED: "true",
      D2_TRUST_REVIEWER_ROUTES_ENABLED: "true",
      ...signedPolicyEnvironment,
      ...trustEnvironment,
    });
    expect(configured).toMatchObject({
      contributionRoutesEnabled: true,
      trustReviewerRoutesEnabled: true,
      trust: {
        policyVersion: "d2-synthetic-trust.v1",
        appealWindowMilliseconds: 1000,
        systemActorId: "019d04cf-1f80-7000-8000-000000000099",
      },
    });
  });

  it.each([
    ["invented boolean syntax", { D2_PRIVATE_CAPTURE_ROUTES_ENABLED: "yes" }],
    ["partial Trust policy", { D2_TRUST_POLICY_VERSION: "d2-synthetic-trust.v1" }],
    [
      "duplicate reviewer identity",
      {
        ...trustEnvironment,
        D2_TRUST_REVIEWER_ASSIGNMENTS_JSON: JSON.stringify([
          {
            issuer: "https://identity.example.test/",
            subject: "auth0|duplicate",
            roles: ["case_reader"],
            verifiedRequesterTakedown: false,
          },
          {
            issuer: "https://identity.example.test/",
            subject: "auth0|duplicate",
            roles: ["case_opener"],
            verifiedRequesterTakedown: false,
          },
        ]),
      },
    ],
    [
      "appeal window outside the technical bound",
      { ...trustEnvironment, D2_TRUST_APPEAL_WINDOW_MILLISECONDS: "31536000001" },
    ],
  ])("rejects %s", (_label, environment) => {
    expect(() => loadD2LambdaGatewayConfig(environment)).toThrow();
    expect(loadD2LambdaGatewayConfigSafely(environment)).toMatchObject({
      valid: false,
      privateCaptureRoutesEnabled: false,
      contributionPolicyRouteEnabled: false,
      contributionRoutesEnabled: false,
      trustReviewerRoutesEnabled: false,
    });
  });
});
