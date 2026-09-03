import { describe, expect, it } from "vitest";
import { detectPublicJob, PROVIDER_DETECTORS } from "../lib/detectors";
import {
  canonicalizePublicJobUrl,
  sanitizeSnapshot,
  selectContributionFields,
} from "../lib/job-capture";

describe("strict public job capture", () => {
  it.each([
    ["greenhouse", "https://boards.greenhouse.io/example/jobs/123", "123"],
    ["lever", "https://jobs.lever.co/example/lever-posting-id", "lever-posting-id"],
    ["ashby", "https://jobs.ashbyhq.com/example/ashby-posting-id", "ashby-posting-id"],
  ] as const)(
    "detects a synthetic %s-shaped public URL",
    (provider, canonicalUrl, externalJobId) => {
      expect(
        detectPublicJob(
          {
            canonicalUrl: `${canonicalUrl}?utm_source=test#private-fragment`,
            company: " Example Company ",
            description: "Build <b>safe</b> systems\u0000",
            location: "Remote",
            title: "Software Engineer",
            workMode: "remote",
          },
          "2026-09-01T12:00:00.000Z",
        ),
      ).toEqual({
        adapterVersion: "d2-job-page-v1",
        capturedAt: "2026-09-01T12:00:00.000Z",
        company: "Example Company",
        description: "Build safe systems",
        externalJobId,
        location: "Remote",
        pageVariant:
          provider === "greenhouse"
            ? "greenhouse-board-v1"
            : provider === "lever"
              ? "lever-posting-v1"
              : "ashby-job-board-v1",
        provider,
        sourceUrl: canonicalUrl,
        title: "Software Engineer",
        workMode: "remote",
      });
    },
  );

  it("keeps an explicit provider identifier instead of replacing it with the URL identity", () => {
    expect(
      detectPublicJob(
        {
          canonicalUrl: "https://boards.greenhouse.io/example/jobs/url-identity",
          externalJobId: "requisition-identity",
          title: "Platform Engineer",
        },
        "2026-09-01T12:00:00.000Z",
      )?.externalJobId,
    ).toBe("requisition-identity");
  });

  it("uses exact supported hosts and refuses lookalikes", () => {
    expect(PROVIDER_DETECTORS).toHaveLength(3);
    expect(
      detectPublicJob({
        canonicalUrl: "https://jobs.lever.co.attacker.example/job",
        title: "Do not capture",
      }),
    ).toBeUndefined();
    expect(
      detectPublicJob({
        canonicalUrl: "https://jobs.lever.co/not-a-supported-job-path",
        title: "Do not capture",
      }),
    ).toBeUndefined();
    expect(
      detectPublicJob({
        canonicalUrl: "https://boards.greenhouse.io/example/not-jobs/123",
        title: "Do not capture",
      }),
    ).toBeUndefined();
  });

  it("rejects unsafe targets and removes credentials, fragments, and all query data", () => {
    expect(canonicalizePublicJobUrl("http://jobs.example.test/job")).toBeUndefined();
    expect(canonicalizePublicJobUrl("https://127.0.0.1/job")).toBeUndefined();
    expect(canonicalizePublicJobUrl("https://user:secret@example.test/job")).toBeUndefined();
    expect(
      canonicalizePublicJobUrl(
        "https://EXAMPLE.test/job?utm_campaign=x&keep=yes&token=secret#fragment",
      ),
    ).toBe("https://example.test/job");
  });

  it("removes markup, extended controls, and bidirectional controls locally", () => {
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.lever.co/example/123",
        title: "Safe\u200b\u200d\ufeff\u202e misleading\u2066 title\u0085 <script>ignored</script>",
        workMode: "remote<script>",
      },
      "lever",
      "lever-posting-v1",
      "2026-09-01T12:00:00.000Z",
    );
    expect(capture?.title).toBe("Safe misleading title ignored");
    expect(capture?.workMode).toBeUndefined();
  });

  it("requires URL and title and sends only selected removable fields", () => {
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.lever.co/example/123",
        company: "Example",
        description: "Public description",
        location: "Remote",
        title: "Engineer",
        workMode: "remote",
      },
      "lever",
      "lever-posting-v1",
      "2026-09-01T12:00:00.000Z",
    );
    expect(capture).toBeDefined();
    if (!capture) throw new Error("Expected a sanitized capture");
    expect(selectContributionFields(capture, ["location", "workMode"])).toEqual({
      adapterVersion: "d2-job-page-v1",
      capturedAt: "2026-09-01T12:00:00.000Z",
      location: "Remote",
      pageVariant: "lever-posting-v1",
      provider: "lever",
      sourceUrl: "https://jobs.lever.co/example/123",
      title: "Engineer",
      workMode: "remote",
    });
    expect(
      sanitizeSnapshot({ canonicalUrl: "https://example.test/job" }, "lever", "lever-posting-v1"),
    ).toBeUndefined();
  });
});
