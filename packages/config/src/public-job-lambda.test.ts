import { describe, expect, it } from "vitest";
import { loadPublicJobEdgeLambdaConfig, loadPublicJobLambdaConfig } from "./index.js";

describe("loadPublicJobLambdaConfig", () => {
  it("loads the bounded public-reader defaults without OIDC or candidate configuration", () => {
    expect(
      loadPublicJobLambdaConfig({
        NODE_ENV: "production",
        RELEASE_SHA: "source-sha",
        AWS_REGION: "us-east-2",
        PUBLIC_JOB_DATABASE_HOST: "database.cluster.us-east-2.rds.amazonaws.com",
        PUBLIC_JOB_DATABASE_NAME: "ai_job_apply",
        PUBLIC_JOB_DATABASE_USER: "ai_job_apply_public_job_reader",
      }),
    ).toEqual(
      expect.objectContaining({
        NODE_ENV: "production",
        RELEASE_SHA: "source-sha",
        PUBLIC_JOB_DATABASE_USER: "ai_job_apply_public_job_reader",
        PUBLIC_JOB_CACHE_CAPACITY: 128,
        PUBLIC_JOB_CACHE_TTL_MS: 15_000,
        PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS: 2_000,
      }),
    );
  });

  it("requires the exact IAM database identity and bounded cache limits", () => {
    expect(() => loadPublicJobLambdaConfig({ NODE_ENV: "production" })).toThrow();
    expect(() =>
      loadPublicJobLambdaConfig({
        AWS_REGION: "us-east-2",
        PUBLIC_JOB_DATABASE_HOST: "database.cluster.us-east-2.rds.amazonaws.com",
        PUBLIC_JOB_DATABASE_NAME: "ai_job_apply",
        PUBLIC_JOB_DATABASE_USER: "platform",
      }),
    ).toThrow();
    expect(() =>
      loadPublicJobLambdaConfig({
        AWS_REGION: "us-east-2",
        PUBLIC_JOB_DATABASE_HOST: "database.cluster.us-east-2.rds.amazonaws.com",
        PUBLIC_JOB_DATABASE_NAME: "ai_job_apply",
        PUBLIC_JOB_DATABASE_USER: "ai_job_apply_public_job_reader",
        PUBLIC_JOB_CACHE_CAPACITY: "257",
      }),
    ).toThrow();
    expect(() =>
      loadPublicJobLambdaConfig({
        AWS_REGION: "us-east-2",
        PUBLIC_JOB_DATABASE_HOST: "database.cluster.us-east-2.rds.amazonaws.com",
        PUBLIC_JOB_DATABASE_NAME: "ai_job_apply",
        PUBLIC_JOB_DATABASE_USER: "ai_job_apply_public_job_reader",
        PUBLIC_JOB_CACHE_TTL_MS: "30001",
      }),
    ).toThrow();
  });
});

describe("loadPublicJobEdgeLambdaConfig", () => {
  it("requires one exact qualified private projection and has no database configuration", () => {
    const config = loadPublicJobEdgeLambdaConfig({
      NODE_ENV: "production",
      RELEASE_SHA: "source-sha",
      AWS_REGION: "us-east-2",
      PUBLIC_JOB_PROJECTION_ARN:
        "arn:aws:lambda:us-east-2:111122223333:function:platform-development-public-job-projection:development",
    });
    expect(config).toMatchObject({
      PUBLIC_JOB_CACHE_CAPACITY: 128,
      PUBLIC_JOB_CACHE_TTL_MS: 15_000,
      PUBLIC_JOB_NEGATIVE_CACHE_TTL_MS: 2_000,
    });
    expect(config).not.toHaveProperty("PUBLIC_JOB_DATABASE_HOST");
    expect(() =>
      loadPublicJobEdgeLambdaConfig({
        NODE_ENV: "production",
        AWS_REGION: "us-east-2",
        PUBLIC_JOB_PROJECTION_ARN:
          "arn:aws:lambda:us-east-2:111122223333:function:platform-development-public-job-projection",
      }),
    ).toThrow();
  });
});
