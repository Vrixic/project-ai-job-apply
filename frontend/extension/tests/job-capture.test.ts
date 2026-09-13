import { describe, expect, it } from "vitest";
import { detectPublicJob, PROVIDER_DETECTORS } from "../lib/detectors";
import {
  canonicalizePublicJobUrl,
  sanitizeSnapshot,
  sanitizeText,
  selectContributionFields,
} from "../lib/job-capture";

describe("strict public job capture", () => {
  it.each([
    ["greenhouse", "https://boards.greenhouse.io/example/jobs/123", "123"],
    ["greenhouse", "https://job-boards.greenhouse.io/example/jobs/123", "123"],
    ["lever", "https://jobs.lever.co/example/lever-posting-id", "lever-posting-id"],
    ["lever", "https://jobs.eu.lever.co/example/lever-posting-id", "lever-posting-id"],
    ["ashby", "https://jobs.ashbyhq.com/example/ashby-posting-id", "ashby-posting-id"],
  ] as const)(
    "detects a synthetic %s-shaped public URL",
    (provider, canonicalUrl, externalJobId) => {
      expect(
        detectPublicJob(
          {
            canonicalUrl: `${canonicalUrl}?utm_source=test#private-fragment`,
            company: " Example Company ",
            description: "Build safe systems\u0000",
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

  it.each([
    "https://boards.greenhouse.io/example/jobs/posting-42",
    "https://job-boards.greenhouse.io/example/jobs/posting-42",
    "https://jobs.lever.co/example/posting-42",
    "https://jobs.eu.lever.co/example/posting-42",
    "https://jobs.ashbyhq.com/example/posting-42",
  ])(
    "uses the exact public URL posting identity instead of a requisition on %s",
    (canonicalUrl) => {
      expect(
        detectPublicJob(
          {
            canonicalUrl: `${canonicalUrl}/?source=example#apply`,
            externalJobId: "REQ-42",
            title: "Platform Engineer",
          },
          "2026-09-01T12:00:00.000Z",
        )?.externalJobId,
      ).toBe("posting-42");
    },
  );

  it("still removes the derived posting identity when the optional field is deselected", () => {
    const capture = detectPublicJob({
      canonicalUrl: "https://jobs.lever.co/example/posting-42",
      externalJobId: "REQ-42",
      title: "Platform Engineer",
    });
    expect(capture?.externalJobId).toBe("posting-42");
    if (!capture) throw new Error("Expected a detected capture");
    expect(selectContributionFields(capture, [])).not.toHaveProperty("externalJobId");
    expect(selectContributionFields(capture, ["externalJobId"]).externalJobId).toBe("posting-42");
  });

  it.each([
    "https://boards.greenhouse.io/example/jobs/posting-42",
    "https://job-boards.greenhouse.io/example/jobs/posting-42",
    "https://jobs.lever.co/example/posting-42",
    "https://jobs.eu.lever.co/example/posting-42",
    "https://jobs.ashbyhq.com/example/posting-42",
  ])(
    "normalizes only the allowed provider trailing slash and refuses non-default ports on %s",
    (canonicalUrl) => {
      expect(
        detectPublicJob({
          canonicalUrl: `${canonicalUrl}/?source=example#apply`,
          title: "Engineer",
        })?.sourceUrl,
      ).toBe(canonicalUrl);
      const nonDefaultPort = new URL(canonicalUrl);
      nonDefaultPort.port = "8443";
      expect(
        detectPublicJob({ canonicalUrl: nonDefaultPort.href, title: "Engineer" }),
      ).toBeUndefined();
      expect(
        detectPublicJob({ canonicalUrl: `${canonicalUrl}//`, title: "Engineer" }),
      ).toBeUndefined();
      expect(
        detectPublicJob({
          canonicalUrl: canonicalUrl.replace("/example/", "/example//"),
          title: "Engineer",
        }),
      ).toBeUndefined();
    },
  );

  it.each([
    "not a URL",
    "https://unknown.example/example/posting-42",
    "https://jobs.lever.co.attacker.example/example/posting-42",
    "http://jobs.lever.co/example/posting-42",
    "https://user:secret@jobs.lever.co/example/posting-42",
    "https://jobs.lever.co/example",
    "https://jobs.lever.co/example/posting-42/apply",
    "https://jobs.eu.lever.co/example/posting%2F42",
    "https://jobs.ashbyhq.com/example/posting-42/extra",
    "https://boards.greenhouse.io/example/not-jobs/posting-42",
  ])(
    "cannot use a page-owned requisition to accept unsupported or invalid URL %s",
    (canonicalUrl) => {
      expect(
        detectPublicJob({ canonicalUrl, externalJobId: "REQ-42", title: "Platform Engineer" }),
      ).toBeUndefined();
    },
  );

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

  it.each([
    ["company", 200],
    ["location", 240],
  ] as const)("omits an over-limit %s without inventing a shortened identity", (field, maximum) => {
    const snapshot = { canonicalUrl: "https://jobs.lever.co/example/123", title: "Engineer" };
    const exact = sanitizeSnapshot(
      { ...snapshot, [field]: ` ${"x".repeat(maximum)} ` },
      "lever",
      "lever-posting-v1",
    );
    expect(exact?.[field]).toBe("x".repeat(maximum));
    for (const value of ["x".repeat(maximum + 1), `${"x".repeat(maximum - 1)} tail`]) {
      const oversized = sanitizeSnapshot(
        { ...snapshot, [field]: value },
        "lever",
        "lever-posting-v1",
      );
      expect(oversized).toMatchObject({ title: "Engineer" });
      expect(oversized).not.toHaveProperty(field);
    }
  });

  it.each([
    ["title", 240],
    ["externalJobId", 200],
  ] as const)("bounds %s to the sharing limit and trims after truncation", (field, maximum) => {
    const snapshot = { canonicalUrl: "https://jobs.lever.co/example/123", title: "Engineer" };
    const exact = sanitizeSnapshot(
      { ...snapshot, [field]: "x".repeat(maximum) },
      "lever",
      "lever-posting-v1",
    );
    expect(exact?.[field]).toBe("x".repeat(maximum));
    const overflow = sanitizeSnapshot(
      { ...snapshot, [field]: "x".repeat(maximum + 1) },
      "lever",
      "lever-posting-v1",
    );
    expect(overflow?.[field]).toBe("x".repeat(maximum));
    const cutAtSpace = sanitizeSnapshot(
      { ...snapshot, [field]: `${"x".repeat(maximum - 1)} tail` },
      "lever",
      "lever-posting-v1",
    );
    expect(cutAtSpace?.[field]).toBe("x".repeat(maximum - 1));
  });

  it.each([
    `${"x".repeat(12_001)} complete synthetic tail`,
    "x".repeat(50_000),
    `  ${"x".repeat(50_000)} \n\t`,
    "😀".repeat(25_000),
    `${"x".repeat(49_997)}\u0000\u200bZ`,
  ])("preserves the complete normalized description within 50,000 UTF-16 units", (description) => {
    const normalized = description
      .replaceAll("\u0000", " ")
      .replaceAll("\u200b", " ")
      .replace(/\s+/gu, " ")
      .trim();
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
        title: "Engineer",
        description,
      },
      "ashby",
      "ashby-job-board-v1",
    );
    expect(capture?.description).toBe(normalized);
    expect(capture).not.toHaveProperty("descriptionUnavailableReason");
    if (!capture) throw new Error("Expected a sanitized capture");
    expect(selectContributionFields(capture, ["description"]).description).toBe(normalized);
  });

  it.each(["x".repeat(50_001), `${"x".repeat(49_999)} tail`, `${"😀".repeat(25_000)}Z`])(
    "omits oversized descriptions with a local diagnostic instead of saving a prefix",
    (description) => {
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
          title: "Engineer",
          description,
        },
        "ashby",
        "ashby-job-board-v1",
      );
      expect(capture).toMatchObject({
        title: "Engineer",
        descriptionUnavailableReason: "too_long",
      });
      expect(capture).not.toHaveProperty("description");
      if (!capture) throw new Error("Expected a sanitized capture");
      const selected = selectContributionFields(capture, ["description"]);
      expect(selected).not.toHaveProperty("description");
      expect(selected).not.toHaveProperty("descriptionUnavailableReason");
    },
  );

  it.each(["too_long", "source_too_large"] as const)(
    "honors the fixed inspector %s diagnostic without accepting a prefix",
    (descriptionUnavailableReason) => {
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
          title: "Engineer",
          description: "An incomplete prefix must never be shared",
          descriptionUnavailableReason,
        },
        "ashby",
        "ashby-job-board-v1",
      );
      expect(capture).toMatchObject({ descriptionUnavailableReason });
      expect(capture).not.toHaveProperty("description");
    },
  );

  it.each(["<", ">", "<=", ">="])(
    "preserves description comparator %s without changing other field guards",
    (bracket) => {
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.lever.co/example/123",
          title: "Engineer",
          description: `Synthetic threshold ${bracket} 10`,
          company: "Example Company",
        },
        "lever",
        "lever-posting-v1",
      );
      expect(capture).toMatchObject({ title: "Engineer", company: "Example Company" });
      expect(capture?.description).toBe(`Synthetic threshold ${bracket} 10`);
      expect(sanitizeText(`safe prefix ${bracket} threshold`, 4)).toBeUndefined();
    },
  );

  it.each([
    "Synthetic threshold < 10 and > 5",
    "Synthetic threshold <=10 and >=5",
    "Synthetic x < y and y > z",
    `${"x".repeat(11_995)} < 10 and > 5`,
    `${"x".repeat(12_000)} > 5`,
  ])("preserves bounded plaintext comparisons", (description) => {
    const capture = sanitizeSnapshot(
      {
        canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
        title: "Engineer",
        description,
      },
      "ashby",
      "ashby-job-board-v1",
    );
    expect(capture?.description).toBe(description);
  });

  it.each([
    "<p>Raw HTML</p>",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)",
    "</div",
    "<!-- comment",
    "<!DOCTYPE html>",
    "<?instruction",
    "＜script＞alert(1)＜/script＞",
    `${"x".repeat(12_001)}<img`,
  ])(
    "omits a raw-markup description instead of converting it to different prose",
    (description) => {
      const capture = sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.ashbyhq.com/example/posting-42",
          title: "Engineer",
          description,
        },
        "ashby",
        "ashby-job-board-v1",
      );
      expect(capture).toMatchObject({ title: "Engineer" });
      expect(capture).not.toHaveProperty("description");
    },
  );

  it.each(["<", ">"])("refuses a required title containing residual %s", (bracket) => {
    expect(
      sanitizeSnapshot(
        {
          canonicalUrl: "https://jobs.lever.co/example/123",
          title: `Engineer ${bracket} threshold`,
        },
        "lever",
        "lever-posting-v1",
      ),
    ).toBeUndefined();
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
