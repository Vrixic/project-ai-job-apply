import { afterEach, describe, expect, it, vi } from "vitest";
import { extensionConfiguration } from "../lib/config";
import {
  createConsentGrantRequest,
  createContributionRequest,
  prepareContribution,
  preparePrivateSavedPageCapture,
  sendJobIntent,
} from "../lib/job-intent-api";
import { createPendingIntent, settleDispatch } from "../lib/pending-queue";

function intent() {
  return createPendingIntent({
    approvedFields: ["location", "workMode"],
    capture: {
      adapterVersion: "d2-job-page-v1",
      capturedAt: "2026-09-01T12:00:00.000Z",
      company: "Removed Company",
      location: "Remote",
      pageVariant: "lever-posting-v1",
      provider: "lever",
      sourceUrl: "https://jobs.lever.co/example/123",
      title: "Engineer",
      workMode: "remote",
    },
    identityFence: "account-a",
    intent: "contribute",
    randomId: () => "018f0000-0000-7000-8000-000000000004",
    retentionMilliseconds: 24 * 60 * 60 * 1_000,
  });
}

function privateIntent() {
  const pending = intent();
  return { ...pending, intent: "private_save" as const };
}

function jsonResponse(status: number, value: unknown, noStore = true): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...(noStore ? { "cache-control": "no-store" } : {}),
    },
  });
}

const previousApiOrigin = extensionConfiguration.apiOrigin;
const previousPolicy = extensionConfiguration.ugcContributionPolicyVersion;

afterEach(() => {
  if (previousApiOrigin) extensionConfiguration.apiOrigin = previousApiOrigin;
  else delete extensionConfiguration.apiOrigin;
  if (previousPolicy) extensionConfiguration.ugcContributionPolicyVersion = previousPolicy;
  else delete extensionConfiguration.ugcContributionPolicyVersion;
});

describe("background-only contribution consent transport", () => {
  it("maps selected capture fields to the exact generated request and canonical order", async () => {
    const pending = intent();
    const prepared = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
    expect(prepared.body).toMatchObject({
      contributionId: pending.id,
      client: { surface: "browser_extension", version: "0.2.0" },
      source: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        sourceUrl: "https://jobs.lever.co/example/123",
      },
      posting: { title: "Engineer", locations: ["Remote"], workMode: "remote" },
      observation: { observedAt: "2026-09-01T12:00:00.000Z" },
      approval: {
        consentVersion: "ugc-contribution-preview.v1",
        policyVersion: "d2-synthetic-policy.v1",
        approvedFields: ["provider", "pageVariant", "sourceUrl", "title", "locations", "workMode"],
      },
    });
    expect(prepared.body.posting).not.toHaveProperty("companyName");
    expect(prepared.body.observation.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.previewDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses separate stable keys and accepts only exact no-store consent and contribution responses", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const pending = intent();
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ ...(init ? { init } : {}), url: String(input) });
      if (calls.length === 1) {
        return jsonResponse(201, {
          documentVersion: "ugc-contribution-preview.v1",
          grantedAt: "2026-09-01T12:00:01.000Z",
          id: "018f0000-0000-7000-8000-000000000099",
          policyVersion: "d2-synthetic-policy.v1",
          schemaVersion: 1,
          state: "granted",
        });
      }
      return jsonResponse(202, {
        id: pending.id,
        state: "queued",
        submittedAt: "2026-09-01T12:00:02.000Z",
        updatedAt: "2026-09-01T12:00:02.000Z",
      });
    });

    await expect(
      sendJobIntent(pending, "short-lived-token", fetcher as typeof fetch, "0.2.0"),
    ).resolves.toEqual({
      contribution: {
        id: pending.id,
        state: "queued",
        submittedAt: "2026-09-01T12:00:02.000Z",
        updatedAt: "2026-09-01T12:00:02.000Z",
      },
      outcome: "accepted",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.example.test/v1/profile/ugc-contribution-consents",
      "https://api.example.test/v1/jobs/contributions",
    ]);
    expect(calls[0]?.init?.headers).toMatchObject({
      "idempotency-key": pending.consentIdempotencyKey,
    });
    expect(calls[1]?.init?.headers).toMatchObject({ "idempotency-key": pending.idempotencyKey });
    const grantBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(grantBody).not.toHaveProperty("consentId");
    expect(grantBody).not.toHaveProperty("grantedAt");
    const contribution = JSON.parse(String(calls[1]?.init?.body)) as {
      approval: { approvedAt: string; consentId: string };
      client: { surface: string; version: string };
      posting: Record<string, unknown>;
    };
    expect(contribution.client).toEqual({ surface: "browser_extension", version: "0.2.0" });
    expect(contribution.approval).toMatchObject({
      approvedAt: "2026-09-01T12:00:01.000Z",
      consentId: "018f0000-0000-7000-8000-000000000099",
    });
    expect(contribution.posting).not.toHaveProperty("companyName");
  });

  it("persists a server-issued consent across an ambiguous contribution response", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const pending = intent();
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse(201, {
          documentVersion: "ugc-contribution-preview.v1",
          grantedAt: "2026-09-01T12:00:01.000Z",
          id: "018f0000-0000-7000-8000-000000000099",
          policyVersion: "d2-synthetic-policy.v1",
          schemaVersion: 1,
          state: "granted",
        });
      }
      throw new TypeError("ambiguous network result");
    });
    const result = await sendJobIntent(
      pending,
      "short-lived-token",
      fetcher as typeof fetch,
      "0.2.0",
    );
    expect(result).toMatchObject({
      failureCode: "network_error",
      outcome: "retryable",
      consent: { id: expect.any(String) },
    });
    expect(settleDispatch(pending, result)?.consent).toEqual(result.consent);
  });

  it("retains only an allowlisted privacy-safe server failure code", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const pending = intent();
    const safeFailure = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "ugc_contribution_consent_unavailable",
            detail: "must not be retained",
            status: 503,
            title: "Unavailable",
            traceId: "must-not-be-retained",
            type: "urn:example",
          }),
          { status: 503, headers: { "content-type": "application/problem+json" } },
        ),
    );
    await expect(
      sendJobIntent(pending, "token", safeFailure as typeof fetch, "0.2.0"),
    ).resolves.toEqual({
      failureCode: "ugc_contribution_consent_unavailable",
      outcome: "retryable",
    });
    const arbitraryFailure = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "secret_database_detail" }), {
          status: 503,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    await expect(
      sendJobIntent(pending, "token", arbitraryFailure as typeof fetch, "0.2.0"),
    ).resolves.toEqual({ failureCode: "http_5xx", outcome: "retryable" });
  });

  it("fails closed on missing policy, malformed grants, and digest drift", async () => {
    const pending = intent();
    await expect(prepareContribution(pending, undefined)).rejects.toThrow("policy");
    extensionConfiguration.apiOrigin = "https://api.example.test";
    delete extensionConfiguration.ugcContributionPolicyVersion;
    const disabled = vi.fn();
    await expect(sendJobIntent(pending, "token", disabled as typeof fetch)).resolves.toEqual({
      outcome: "terminal",
    });
    expect(disabled).not.toHaveBeenCalled();
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const malformed = vi.fn(async () =>
      jsonResponse(201, {
        grantedAt: "2026-09-01T12:00:01.000Z",
        id: pending.id,
        policyVersion: "different-policy.v1",
        schemaVersion: 1,
        state: "granted",
      }),
    );
    await expect(
      sendJobIntent(pending, "token", malformed as typeof fetch, "0.2.0"),
    ).resolves.toEqual({
      failureCode: "invalid_response",
      outcome: "terminal",
    });
    const prepared = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
    const consent = {
      grantedAt: "2026-09-01T12:00:01.000Z",
      id: "018f0000-0000-7000-8000-000000000099",
      previewDigestSha256: "f".repeat(64),
    };
    expect(() =>
      createContributionRequest(
        pending,
        prepared.body,
        consent,
        "token",
        "https://api.example.test",
      ),
    ).not.toThrow();
    const drifted = { ...pending, consent };
    const notCalled = vi.fn();
    await expect(
      sendJobIntent(drifted, "token", notCalled as typeof fetch, "0.2.0"),
    ).resolves.toEqual({
      outcome: "terminal",
    });
    expect(notCalled).not.toHaveBeenCalled();
    const grant = createConsentGrantRequest(
      pending,
      prepared.previewDigestSha256,
      "token",
      "https://api.example.test",
      "d2-synthetic-policy.v1",
    );
    expect(grant.url.pathname).toBe("/v1/profile/ugc-contribution-consents");
  });
});

describe("background-only private saved-page transport", () => {
  it("honors the same explicit optional-field removal without contribution consent coupling", () => {
    const pending = privateIntent();
    expect(preparePrivateSavedPageCapture(pending)).toEqual({
      schemaVersion: 1,
      captureId: pending.id,
      source: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        sourceUrl: "https://jobs.lever.co/example/123",
        adapterVersion: "d2-job-page-v1",
      },
      snapshot: {
        title: "Engineer",
        location: "Remote",
      },
      capturedAt: "2026-09-01T12:00:00.000Z",
    });
  });

  it("uses the stable private key and accepts only an exact no-store owner response", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    const pending = privateIntent();
    const expected = preparePrivateSavedPageCapture(pending);
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "idempotency-key": pending.idempotencyKey });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual(expected);
      expect(body).not.toHaveProperty("approval");
      expect(body).not.toHaveProperty("consent");
      expect(body).not.toHaveProperty("clientSurface");
      return jsonResponse(201, {
        schemaVersion: 1,
        id: pending.id,
        source: expected.source,
        snapshot: expected.snapshot,
        capturedAt: expected.capturedAt,
        savedAt: "2026-09-01T12:00:01.000Z",
      });
    });

    await expect(
      sendJobIntent(pending, "short-lived-token", fetcher as typeof fetch),
    ).resolves.toEqual({ outcome: "accepted" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://api.example.test/v1/saved-job-captures",
    );
  });

  it("keeps private-save retry classification independent of contribution policy", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    delete extensionConfiguration.ugcContributionPolicyVersion;
    const pending = privateIntent();
    const expected = preparePrivateSavedPageCapture(pending);
    const unavailable = vi.fn(async () => jsonResponse(503, { code: "unavailable" }));
    await expect(sendJobIntent(pending, "token", unavailable as typeof fetch)).resolves.toEqual({
      failureCode: "http_5xx",
      outcome: "retryable",
    });

    const malformed = vi.fn(async () =>
      jsonResponse(201, {
        schemaVersion: 1,
        id: pending.id,
        source: expected.source,
        snapshot: { ...expected.snapshot, privateNote: "must not be accepted" },
        capturedAt: expected.capturedAt,
        savedAt: "2026-09-01T12:00:01.000Z",
      }),
    );
    await expect(sendJobIntent(pending, "token", malformed as typeof fetch)).resolves.toEqual({
      failureCode: "invalid_response",
      outcome: "terminal",
    });
  });
});
