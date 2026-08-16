import "reflect-metadata";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { JobReportServiceUnavailableError } from "@ai-job-apply/jobs-service";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type D1ApiAssuranceReceipt,
  type D1ApiAssuranceResponse,
  type D1ApiAssuranceScenario,
  MAXIMUM_D1_API_ASSURANCE_CONCURRENCY,
  MAXIMUM_D1_API_ASSURANCE_SCENARIOS,
  runD1ApiAssurance,
} from "./d1-api-assurance-harness.js";
import {
  createSyntheticAssuranceApplication,
  SYNTHETIC_JOB_ID,
  SYNTHETIC_OWNER_A,
  SYNTHETIC_OWNER_B,
  SYNTHETIC_PRIVATE_CANARY,
  type SyntheticAssuranceCatalog,
  type SyntheticAssuranceJobReports,
} from "./d1-api-assurance-test-support.js";

const CONCURRENCY = 8;
const validateHealth = compileComponentValidator("Health");
const validateCurrentUser = compileComponentValidator("CurrentUser");
const validateJobSearchPage = compileComponentValidator("JobSearchPage");
const validateJobReport = compileComponentValidator("JobReport");
const validateProblemDetails = compileComponentValidator("ProblemDetails");

function json(response: D1ApiAssuranceResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function noStore(response: D1ApiAssuranceResponse): boolean {
  return response.headers["cache-control"] === "no-store";
}

function problem(code: string, title: string) {
  return (response: D1ApiAssuranceResponse): boolean => {
    const body = json(response);
    return (
      noStore(response) &&
      validateProblemDetails(body) &&
      body.type === `urn:ai-job-apply:problem:${code}` &&
      body.title === title &&
      body.code === code &&
      body.status === response.statusCode
    );
  };
}

function expectedOwner(ownerId: string, otherOwnerId: string) {
  return (response: D1ApiAssuranceResponse): boolean =>
    validateCurrentUser(json(response)) &&
    response.body === JSON.stringify({ id: ownerId }) &&
    !response.body.includes(otherOwnerId);
}

function expectedSearch(response: D1ApiAssuranceResponse): boolean {
  const body = json(response);
  const items = body.items as Array<Record<string, unknown>> | undefined;
  return (
    noStore(response) &&
    validateJobSearchPage(body) &&
    Array.isArray(items) &&
    items.length === 1 &&
    items[0]?.id === SYNTHETIC_JOB_ID &&
    !response.body.includes("description") &&
    !response.body.includes("sources") &&
    !response.body.includes(SYNTHETIC_OWNER_A) &&
    !response.body.includes(SYNTHETIC_OWNER_B)
  );
}

function expectedReport(response: D1ApiAssuranceResponse): boolean {
  const body = json(response);
  return (
    noStore(response) &&
    validateJobReport(body) &&
    body.requestedJobId === SYNTHETIC_JOB_ID &&
    body.canonicalJobId === SYNTHETIC_JOB_ID &&
    body.reason === "job_inaccurate" &&
    !Object.hasOwn(body, "ownerUserId")
  );
}

function expectedHealth(response: D1ApiAssuranceResponse): boolean {
  const body = json(response);
  return validateHealth(body) && body.status === "ok" && body.service === "gateway";
}

function repeatedScenarios(
  repetitions: number,
  create: (index: number) => readonly D1ApiAssuranceScenario[],
): D1ApiAssuranceScenario[] {
  return Array.from({ length: repetitions }, (_, index) => create(index)).flat();
}

describe("D1 mixed API assurance", () => {
  let app: NestFastifyApplication;
  let catalog: SyntheticAssuranceCatalog;
  let jobReports: SyntheticAssuranceJobReports;
  let readTokenA: string;
  let readTokenB: string;
  let writeTokenA: string;
  let writeTokenB: string;
  let profileTokenA: string;
  let profileTokenB: string;

  beforeAll(async () => {
    const setup = await createSyntheticAssuranceApplication();
    app = setup.app;
    catalog = setup.catalog;
    jobReports = setup.jobReports;
    [readTokenA, readTokenB, writeTokenA, writeTokenB, profileTokenA, profileTokenB] =
      await Promise.all([
        setup.issuer.issue("synthetic-candidate-a", { scope: "jobs:read" }),
        setup.issuer.issue("synthetic-candidate-b", { scope: "jobs:read" }),
        setup.issuer.issue("synthetic-candidate-a", { scope: "jobs:write" }),
        setup.issuer.issue("synthetic-candidate-b", { scope: "jobs:write" }),
        setup.issuer.issue("synthetic-candidate-a", { scope: "profile:read" }),
        setup.issuer.issue("synthetic-candidate-b", { scope: "profile:read" }),
      ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps the aggregate runner bounded and detects contract and privacy failures", async () => {
    const receipt = await runD1ApiAssurance({
      concurrency: 1,
      forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
      scenarios: [
        {
          stage: "steady",
          expectedStatus: 200,
          execute: async () => ({
            statusCode: 503,
            headers: {},
            body: SYNTHETIC_PRIVATE_CANARY,
          }),
          validate: () => false,
        },
        {
          stage: "steady",
          expectedStatus: 200,
          execute: async () => ({
            statusCode: 200,
            headers: {},
            body: `not-json ${SYNTHETIC_PRIVATE_CANARY}`,
          }),
          validate: (response) => Boolean(json(response)),
        },
      ],
    });

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      dataClassification: "synthetic",
      requests: 2,
      expectedResponses: 1,
      unexpectedStatuses: 1,
      contractFailures: 2,
      privacyLeaks: 2,
      transportFailures: 0,
      maximumInFlight: 1,
      configuredConcurrency: 1,
    });
    expect(JSON.stringify(receipt)).not.toContain(SYNTHETIC_PRIVATE_CANARY);
  });

  it("scans an immutable response snapshot before an adversarial validator runs", async () => {
    const receipt = await runD1ApiAssurance({
      concurrency: 1,
      forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
      scenarios: [
        {
          stage: "fault",
          expectedStatus: 503,
          execute: async () => ({
            statusCode: 503,
            headers: { "x-private-canary": [SYNTHETIC_PRIVATE_CANARY] },
            body: SYNTHETIC_PRIVATE_CANARY,
          }),
          validate: (response) => {
            const mutable = response as {
              body: string;
              headers: Record<string, string | string[]>;
            };
            mutable.body = "redacted";
            mutable.headers["x-private-canary"] = ["redacted"];
            return true;
          },
        },
      ],
    });

    expect(receipt).toMatchObject({
      requests: 1,
      expectedResponses: 1,
      contractFailures: 1,
      privacyLeaks: 1,
      transportFailures: 0,
    });
    expect(JSON.stringify(receipt)).not.toContain(SYNTHETIC_PRIVATE_CANARY);
  });

  it("refuses unbounded scenario and concurrency inputs before dispatch", async () => {
    const execute = vi.fn(async () => ({ statusCode: 200, headers: {}, body: "{}" }));
    const scenario: D1ApiAssuranceScenario = {
      stage: "steady",
      expectedStatus: 200,
      execute,
      validate: () => true,
    };

    await expect(
      runD1ApiAssurance({
        scenarios: [scenario],
        concurrency: MAXIMUM_D1_API_ASSURANCE_CONCURRENCY + 1,
        forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
      }),
    ).rejects.toThrow("between 1 and 32");
    await expect(
      runD1ApiAssurance({
        scenarios: Array.from({ length: MAXIMUM_D1_API_ASSURANCE_SCENARIOS + 1 }, () => scenario),
        concurrency: 1,
        forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
      }),
    ).rejects.toThrow("between 1 and 1000 scenarios");
    await expect(
      runD1ApiAssurance({ scenarios: [scenario], concurrency: 1, forbiddenValues: [] }),
    ).rejects.toThrow("at least one non-empty forbidden value");
    await expect(
      runD1ApiAssurance({ scenarios: [scenario], concurrency: 1, forbiddenValues: [" "] }),
    ).rejects.toThrow("at least one non-empty forbidden value");
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes the synthetic steady, injected-fault, and recovery matrix", async () => {
    const steady = repeatedScenarios(10, (index) => [
      {
        stage: "steady",
        expectedStatus: 200,
        execute: () => app.inject({ method: "GET", url: "/health/live" }),
        validate: expectedHealth,
      },
      {
        stage: "steady",
        expectedStatus: 200,
        execute: () => app.inject({ method: "GET", url: "/health/ready" }),
        validate: expectedHealth,
      },
      {
        stage: "steady",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "GET",
            url: "/v1/me",
            headers: { authorization: `Bearer ${profileTokenA}` },
          }),
        validate: expectedOwner(SYNTHETIC_OWNER_A, SYNTHETIC_OWNER_B),
      },
      {
        stage: "steady",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "GET",
            url: "/v1/me",
            headers: { authorization: `Bearer ${profileTokenB}` },
          }),
        validate: expectedOwner(SYNTHETIC_OWNER_B, SYNTHETIC_OWNER_A),
      },
      {
        stage: "steady",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: { authorization: `Bearer ${readTokenA}`, "content-type": "application/json" },
            payload: { query: "synthetic platform", pageSize: 10 },
          }),
        validate: expectedSearch,
      },
      {
        stage: "steady",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: { authorization: `Bearer ${readTokenB}`, "content-type": "application/json" },
            payload: { filters: { location: "Remote - US" }, pageSize: 10 },
          }),
        validate: expectedSearch,
      },
      {
        stage: "steady",
        expectedStatus: 201,
        execute: () =>
          app.inject({
            method: "POST",
            url: `/v1/jobs/${SYNTHETIC_JOB_ID}/reports`,
            headers: {
              authorization: `Bearer ${writeTokenA}`,
              "content-type": "application/json",
              "idempotency-key": `d1-assurance-steady-report-${index.toString().padStart(4, "0")}`,
            },
            payload: { reason: "job_inaccurate" },
          }),
        validate: expectedReport,
      },
      {
        stage: "steady",
        expectedStatus: 401,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: { "content-type": "application/json" },
            payload: { pageSize: 10 },
          }),
        validate: problem("authentication_required", "Authentication required"),
      },
      {
        stage: "steady",
        expectedStatus: 403,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: {
              authorization: `Bearer ${profileTokenA}`,
              "content-type": "application/json",
            },
            payload: { pageSize: 10 },
          }),
        validate: problem("forbidden", "FORBIDDEN"),
      },
      {
        stage: "steady",
        expectedStatus: 400,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: { authorization: `Bearer ${readTokenA}`, "content-type": "application/json" },
            payload: { query: SYNTHETIC_PRIVATE_CANARY, pageSize: 99 },
          }),
        validate: problem("invalid_request", "BAD_REQUEST"),
      },
    ]);
    const steadyReceipt = await runD1ApiAssurance({
      scenarios: steady,
      concurrency: CONCURRENCY,
      forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
    });

    expect(steadyReceipt).toMatchObject({
      requests: 100,
      expectedResponses: 100,
      unexpectedStatuses: 0,
      contractFailures: 0,
      privacyLeaks: 0,
      transportFailures: 0,
      maximumInFlight: CONCURRENCY,
      configuredConcurrency: CONCURRENCY,
    });

    catalog.searchFailure = new Error(SYNTHETIC_PRIVATE_CANARY);
    catalog.pingFailure = new Error(SYNTHETIC_PRIVATE_CANARY);
    jobReports.reportFailure = new JobReportServiceUnavailableError();
    const fault = repeatedScenarios(6, (index) => [
      {
        stage: "fault",
        expectedStatus: 503,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: { authorization: `Bearer ${readTokenA}`, "content-type": "application/json" },
            payload: { pageSize: 10 },
          }),
        validate: problem("job_search_unavailable", "Job search is unavailable"),
      },
      {
        stage: "fault",
        expectedStatus: 503,
        execute: () =>
          app.inject({
            method: "POST",
            url: `/v1/jobs/${SYNTHETIC_JOB_ID}/reports`,
            headers: {
              authorization: `Bearer ${writeTokenB}`,
              "content-type": "application/json",
              "idempotency-key": `d1-assurance-fault-report-${index.toString().padStart(4, "0")}`,
            },
            payload: { reason: "job_inaccurate" },
          }),
        validate: problem("job_reporting_unavailable", "Job reporting unavailable"),
      },
      {
        stage: "fault",
        expectedStatus: 503,
        execute: () => app.inject({ method: "GET", url: "/health/ready" }),
        validate: problem("request_error", "SERVICE_UNAVAILABLE"),
      },
      {
        stage: "fault",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "GET",
            url: "/v1/me",
            headers: { authorization: `Bearer ${profileTokenB}` },
          }),
        validate: expectedOwner(SYNTHETIC_OWNER_B, SYNTHETIC_OWNER_A),
      },
    ]);

    let faultReceipt: D1ApiAssuranceReceipt;
    try {
      faultReceipt = await runD1ApiAssurance({
        scenarios: fault,
        concurrency: CONCURRENCY,
        forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
      });
    } finally {
      catalog.searchFailure = undefined;
      catalog.pingFailure = undefined;
      jobReports.reportFailure = undefined;
    }

    expect(faultReceipt).toMatchObject({
      requests: 24,
      expectedResponses: 24,
      unexpectedStatuses: 0,
      contractFailures: 0,
      privacyLeaks: 0,
      transportFailures: 0,
      maximumInFlight: CONCURRENCY,
      configuredConcurrency: CONCURRENCY,
    });

    const recovery = repeatedScenarios(6, (index) => [
      {
        stage: "recovery",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "POST",
            url: "/v1/jobs/search",
            headers: { authorization: `Bearer ${readTokenA}`, "content-type": "application/json" },
            payload: { pageSize: 10 },
          }),
        validate: expectedSearch,
      },
      {
        stage: "recovery",
        expectedStatus: 201,
        execute: () =>
          app.inject({
            method: "POST",
            url: `/v1/jobs/${SYNTHETIC_JOB_ID}/reports`,
            headers: {
              authorization: `Bearer ${writeTokenB}`,
              "content-type": "application/json",
              "idempotency-key": `d1-assurance-recovery-report-${index.toString().padStart(4, "0")}`,
            },
            payload: { reason: "job_inaccurate" },
          }),
        validate: expectedReport,
      },
      {
        stage: "recovery",
        expectedStatus: 200,
        execute: () => app.inject({ method: "GET", url: "/health/ready" }),
        validate: expectedHealth,
      },
      {
        stage: "recovery",
        expectedStatus: 200,
        execute: () =>
          app.inject({
            method: "GET",
            url: "/v1/me",
            headers: { authorization: `Bearer ${profileTokenA}` },
          }),
        validate: expectedOwner(SYNTHETIC_OWNER_A, SYNTHETIC_OWNER_B),
      },
    ]);
    const recoveryReceipt = await runD1ApiAssurance({
      scenarios: recovery,
      concurrency: CONCURRENCY,
      forbiddenValues: [SYNTHETIC_PRIVATE_CANARY],
    });

    expect(recoveryReceipt).toMatchObject({
      requests: 24,
      expectedResponses: 24,
      unexpectedStatuses: 0,
      contractFailures: 0,
      privacyLeaks: 0,
      transportFailures: 0,
      maximumInFlight: CONCURRENCY,
      configuredConcurrency: CONCURRENCY,
    });

    expect(steadyReceipt.requests + faultReceipt.requests + recoveryReceipt.requests).toBe(148);
  });
});
