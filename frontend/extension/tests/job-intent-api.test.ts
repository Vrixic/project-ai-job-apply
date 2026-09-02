import { describe, expect, it } from "vitest";
import { createJobIntentRequest } from "../lib/job-intent-api";
import { createPendingIntent } from "../lib/pending-queue";

describe("background-only job intent transport", () => {
  it("uses the ADR-028 contribution route and stable idempotency without omitted fields", () => {
    const intent = createPendingIntent({
      approvedFields: ["location"],
      capture: {
        adapterVersion: "d2-job-page-v1",
        capturedAt: "2026-09-01T12:00:00.000Z",
        company: "Removed Company",
        location: "Remote",
        pageVariant: "lever-posting-v1",
        provider: "lever",
        sourceUrl: "https://jobs.lever.co/example/123",
        title: "Engineer",
      },
      identityFence: "account-a",
      intent: "contribute",
      randomId: () => "018f0000-0000-7000-8000-000000000004",
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    const capture = {
      adapterVersion: intent.capture.adapterVersion,
      capturedAt: intent.capture.capturedAt,
      location: "Remote",
      pageVariant: intent.capture.pageVariant,
      provider: intent.capture.provider,
      sourceUrl: intent.capture.sourceUrl,
      title: intent.capture.title,
    } as const;
    const request = createJobIntentRequest(
      intent,
      capture,
      "short-lived-token",
      "https://api.example.test",
    );
    expect(request.url.href).toBe("https://api.example.test/v1/jobs/contributions");
    expect(request.init.headers).toMatchObject({
      authorization: "Bearer short-lived-token",
      "idempotency-key": intent.idempotencyKey,
    });
    expect(request.init.body).not.toContain("Removed Company");
  });
});
