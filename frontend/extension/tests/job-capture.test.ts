import { describe, expect, it } from "vitest";
import { detectPublicJob, PROVIDER_DETECTORS } from "../lib/detectors";
import {
  canonicalizePublicJobUrl,
  sanitizeSnapshot,
  selectContributionFields,
} from "../lib/job-capture";

describe("strict public job capture", () => {
  it.each([
    ["greenhouse", "https://boards.greenhouse.io/example/jobs/123"],
    ["lever", "https://jobs.lever.co/example/123"],
    ["ashby", "https://jobs.ashbyhq.com/example/123"],
  ] as const)("detects a synthetic %s-shaped public URL", (provider, canonicalUrl) => {
    expect(
      detectPublicJob(
        {
          canonicalUrl: `${canonicalUrl}?utm_source=test#private-fragment`,
          company: " Example Company ",
          description: "Build <b>safe</b> systems\u0000",
          location: "Remote",
          title: "Software Engineer",
        },
        "2026-09-01T12:00:00.000Z",
      ),
    ).toEqual({
      adapterVersion: "d2-job-page-v1",
      capturedAt: "2026-09-01T12:00:00.000Z",
      company: "Example Company",
      description: "Build safe systems",
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
    });
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
    expect(
      sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.lever.co/example/123",
          title: "Safe\u202e misleading\u2066 title\u0085 <script>ignored</script>",
        },
        "lever",
        "lever-posting-v1",
        "2026-09-01T12:00:00.000Z",
      )?.title,
    ).toBe("Safe misleading title ignored");
  });

  it("requires URL and title and sends only selected removable fields", () => {
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.lever.co/example/123",
        company: "Example",
        description: "Public description",
        location: "Remote",
        title: "Engineer",
      },
      "lever",
      "lever-posting-v1",
      "2026-09-01T12:00:00.000Z",
    );
    expect(capture).toBeDefined();
    if (!capture) throw new Error("Expected a sanitized capture");
    expect(selectContributionFields(capture, ["location"])).toEqual({
      adapterVersion: "d2-job-page-v1",
      capturedAt: "2026-09-01T12:00:00.000Z",
      location: "Remote",
      pageVariant: "lever-posting-v1",
      provider: "lever",
      sourceUrl: "https://jobs.lever.co/example/123",
      title: "Engineer",
    });
    expect(
      sanitizeSnapshot({ canonicalUrl: "https://example.test/job" }, "lever", "lever-posting-v1"),
    ).toBeUndefined();
  });
});
