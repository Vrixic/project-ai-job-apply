import { afterEach, describe, expect, it, vi } from "vitest";
import { extensionConfiguration } from "../lib/config";
import { sanitizeSnapshot } from "../lib/job-capture";
import {
  ContributionRequestTooLargeError,
  createConsentGrantRequest,
  createContributionRequest,
  MAXIMUM_CONTRIBUTION_REQUEST_BYTES,
  prepareContribution,
  preparePrivateSavedPageCapture,
  sendJobIntent,
} from "../lib/job-intent-api";
import { createPendingIntent, restartStoppedIntent, settleDispatch } from "../lib/pending-queue";

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
  it("accepts exactly 65,536 serialized bytes and rejects one more byte before consent", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const pending = intent();
    pending.capture.description = "x";
    pending.approvedFields = ["description"];
    const base = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
    const available =
      MAXIMUM_CONTRIBUTION_REQUEST_BYTES -
      new TextEncoder().encode(JSON.stringify(base.body)).byteLength +
      1;
    // A quotation mark occupies two escaped JSON bytes, independently of its string length.
    pending.capture.description = `${'"'.repeat(Math.floor(available / 2))}${"x".repeat(available % 2)}`;
    const exact = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
    expect(new TextEncoder().encode(JSON.stringify(exact.body)).byteLength).toBe(65_536);
    const consent = {
      id: pending.id,
      grantedAt: pending.capture.capturedAt,
      previewDigestSha256: exact.previewDigestSha256,
    };
    expect(
      new TextEncoder().encode(
        String(
          createContributionRequest(
            pending,
            exact.body,
            consent,
            "synthetic-token",
            "https://api.example.test",
          ).init.body,
        ),
      ).byteLength,
    ).toBe(65_536);
    pending.capture.description += "x";
    const unchanged = JSON.stringify(pending);
    await expect(
      prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0"),
    ).rejects.toBeInstanceOf(ContributionRequestTooLargeError);
    const fetcher = vi.fn<typeof fetch>();
    await expect(sendJobIntent(pending, "synthetic-token", fetcher, "0.2.0")).resolves.toEqual({
      outcome: "terminal",
      failureCode: "request_too_large",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(pending)).toBe(unchanged);
    exact.body.posting.description += "x";
    expect(() =>
      createContributionRequest(
        pending,
        exact.body,
        consent,
        "synthetic-token",
        "https://api.example.test",
      ),
    ).toThrow(ContributionRequestTooLargeError);
  });

  it("retains complete Unicode locally but refuses an oversized UTF-8 delivery until deselected", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const pending = intent();
    pending.capture.description = "漢".repeat(50_000);
    pending.approvedFields = ["description"];
    const fetcher = vi.fn<typeof fetch>();
    await expect(sendJobIntent(pending, "synthetic-token", fetcher, "0.2.0")).resolves.toEqual({
      outcome: "terminal",
      failureCode: "request_too_large",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(pending.capture.description).toBe("漢".repeat(50_000));
    pending.approvedFields = [];
    const prepared = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
    expect(prepared.body.posting).not.toHaveProperty("description");
    expect(pending.capture.description).toBe("漢".repeat(50_000));
  });

  it.each([12_000, 18_185, 50_000])(
    "retains the exact %i-character description and its tail across persistence and digest preparation",
    async (length) => {
      const pending = intent();
      const tail = " complete synthetic tail >= 5";
      pending.capture.description = `${"x".repeat(length - tail.length)}${tail}`;
      pending.approvedFields = ["description"];
      const original = JSON.stringify(pending);
      const reloaded = JSON.parse(original) as typeof pending;
      const prepared = await prepareContribution(reloaded, "d2-synthetic-policy.v1", "0.2.0");
      expect(prepared.body.posting.description).toBe(pending.capture.description);
      expect(prepared.body.posting.description?.endsWith(tail)).toBe(true);
      const retry = await prepareContribution(reloaded, "d2-synthetic-policy.v1", "0.2.0");
      expect(retry).toEqual(prepared);
      expect(JSON.stringify(reloaded)).toBe(original);
      const changed = structuredClone(reloaded);
      changed.capture.description = `${changed.capture.description?.slice(0, -1)}6`;
      const edited = await prepareContribution(changed, "d2-synthetic-policy.v1", "0.2.0");
      expect(edited.body.observation.contentSha256).not.toBe(
        prepared.body.observation.contentSha256,
      );
      expect(edited.previewDigestSha256).not.toBe(prepared.previewDigestSha256);
    },
  );

  it.each(["too_long", "source_too_large"] as const)(
    "never sends or digests the local %s explanation",
    async (reason) => {
      const pending = intent();
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: pending.capture.sourceUrl,
          title: "Engineer",
          descriptionUnavailableReason: reason,
        },
        "lever",
        "lever-posting-v1",
        pending.capture.capturedAt,
      );
      if (!capture) throw new Error("Expected synthetic capture");
      pending.capture = capture;
      pending.approvedFields = ["description"];
      const prepared = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
      expect(prepared.body.posting).not.toHaveProperty("description");
      expect(JSON.stringify(prepared.body)).not.toContain("descriptionUnavailableReason");
      const withoutDiagnostic = structuredClone(pending);
      delete withoutDiagnostic.capture.descriptionUnavailableReason;
      expect(
        await prepareContribution(withoutDiagnostic, "d2-synthetic-policy.v1", "0.2.0"),
      ).toEqual(prepared);
      expect(preparePrivateSavedPageCapture(pending)).toEqual(
        preparePrivateSavedPageCapture(withoutDiagnostic),
      );
    },
  );

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

  it("never rewrites an already approved stopped capture when retrying after sanitizer changes", async () => {
    extensionConfiguration.apiOrigin = "https://api.example.test";
    extensionConfiguration.ugcContributionPolicyVersion = "d2-synthetic-policy.v1";
    const pending = intent();
    pending.approvedFields = ["company", "location", "description"];
    pending.capture.company = "x".repeat(201);
    pending.capture.location = "x".repeat(241);
    pending.capture.description = "Synthetic threshold > 10 ";
    const prepared = await prepareContribution(pending, "d2-synthetic-policy.v1", "0.2.0");
    const consent = {
      grantedAt: "2026-09-01T12:00:01.000Z",
      id: "018f0000-0000-7000-8000-000000000099",
      previewDigestSha256: prepared.previewDigestSha256,
    };
    const stopped = settleDispatch(pending, { outcome: "terminal", consent });
    if (!stopped) throw new Error("Expected a generated stopped intent");
    const before = structuredClone(stopped);
    const expectedBody = createContributionRequest(
      pending,
      prepared.body,
      consent,
      "synthetic-token",
      "https://api.example.test",
    ).init.body;
    const restarted = restartStoppedIntent(stopped);
    expect(restarted.capture).toEqual(before.capture);
    expect(restarted.approvedFields).toEqual(before.approvedFields);
    expect(restarted.consent).toEqual(before.consent);
    expect(restarted.id).toBe(before.id);
    expect(restarted.idempotencyKey).toBe(before.idempotencyKey);
    expect(restarted.consentIdempotencyKey).toBe(before.consentIdempotencyKey);
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.test/v1/jobs/contributions");
      expect(init?.body).toBe(expectedBody);
      expect(init?.headers).toMatchObject({ "idempotency-key": before.idempotencyKey });
      return jsonResponse(400, { code: "invalid_request" });
    });
    await expect(
      sendJobIntent(restarted, "synthetic-token", fetcher as typeof fetch, "0.2.0"),
    ).resolves.toMatchObject({ outcome: "terminal", consent });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(stopped).toEqual(before);
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
