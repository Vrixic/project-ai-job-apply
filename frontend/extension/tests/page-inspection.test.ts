import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureCurrentPublicJobPage } from "../lib/page-inspection";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("explicit current-page inspection", () => {
  it("reads the accepted sanitized Greenhouse board fixture", () => {
    const fixture = readFileSync(
      new URL(
        "../../../packages/test-fixtures/ats/greenhouse/job-page-board-v1/job-page.html",
        import.meta.url,
      ),
      "utf8",
    );
    const visibleText = (pattern: RegExp): string | undefined => {
      const value = fixture.match(pattern)?.[1];
      return value
        ?.replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
    };
    const values = new Map<string, string | undefined>([
      ["h1", visibleText(/<h1[^>]*>([\s\S]*?)<\/h1>/u)],
      [
        ".job__location",
        visibleText(/<[^>]+class="[^"]*job__location[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/u),
      ],
      [
        ".job__description",
        visibleText(/<[^>]+class="[^"]*job__description[^"]*"[^>]*>([\s\S]*?)<\/div>/u),
      ],
    ]);
    vi.stubGlobal("location", {
      href: "https://job-boards.greenhouse.io/example/jobs/12345",
    });
    vi.stubGlobal("document", {
      querySelector(selector: string) {
        const textContent = values.get(selector);
        return textContent ? { firstElementChild: null, textContent } : null;
      },
      querySelectorAll() {
        return [];
      },
    });

    expect(captureCurrentPublicJobPage()).toEqual({
      canonicalUrl: "https://job-boards.greenhouse.io/example/jobs/12345",
      description:
        "About Example Organization Example Organization builds dependable software for reserved-example customers. This paragraph contains synthetic public-job text only. What you bring Experience building and operating production software. Clear written communication and careful technical judgment.",
      location: "EXAMPLE-REGION",
      title: "Example Platform Engineer",
      workMode: "remote",
    });
  });

  it("uses the authorized HTTPS tab instead of a page-owned insecure canonical URL", () => {
    const values = new Map<string, string>([
      ['link[rel="canonical"]', "http://job-boards.greenhouse.io/remotecom/jobs/7774935003"],
      ["h1", "Senior Forward Deployed Engineer (Remote Build)"],
      [".job__description", "Public job description"],
      [".job__location", "Remote-NORAM"],
    ]);
    vi.stubGlobal("location", {
      href: "https://job-boards.greenhouse.io/remotecom/jobs/7774935003?source=test#apply",
    });
    vi.stubGlobal("document", {
      querySelector(selector: string) {
        const textContent = values.get(selector);
        return textContent ? { href: textContent, textContent } : null;
      },
      querySelectorAll() {
        return [];
      },
    });

    expect(captureCurrentPublicJobPage()).toEqual({
      canonicalUrl: "https://job-boards.greenhouse.io/remotecom/jobs/7774935003?source=test#apply",
      description: "Public job description",
      location: "NORAM",
      title: "Senior Forward Deployed Engineer (Remote Build)",
      workMode: "remote",
    });
  });

  it("reads grounded organization and PropertyValue identity from graph structured data", () => {
    vi.stubGlobal("location", {
      href: "https://jobs.ashbyhq.com/example/ashby-posting-id",
    });
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return {
            body: {
              firstElementChild: { tagName: "H2", textContent: "About Example" },
              textContent: "About Example About Example Public job description",
            },
          };
        }
      },
    );
    vi.stubGlobal("document", {
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [
          {
            textContent: JSON.stringify({
              "@graph": [
                { "@type": "WebPage", name: "Synthetic page" },
                {
                  "@type": ["Thing", "JobPosting"],
                  description: "<h2>About Example</h2><p>About Example Public job description</p>",
                  hiringOrganization: { name: "Example Incorporated" },
                  identifier: { "@type": "PropertyValue", value: "REQ-42" },
                  jobLocationType: "TELECOMMUTE",
                  title: "Systems Engineer",
                },
              ],
            }),
          },
        ];
      },
    });

    expect(captureCurrentPublicJobPage()).toEqual({
      canonicalUrl: "https://jobs.ashbyhq.com/example/ashby-posting-id",
      company: "Example Incorporated",
      description: "About Example Public job description",
      externalJobId: "REQ-42",
      title: "Systems Engineer",
      workMode: "remote",
    });
  });

  it("uses provider-specific visible company text without inferring it from the URL", () => {
    vi.stubGlobal("location", {
      href: "https://job-boards.greenhouse.io/example/jobs/123",
    });
    vi.stubGlobal("document", {
      querySelector(selector: string) {
        if (selector === "h1") return { textContent: "Security Engineer" };
        if (selector === "#logo img[alt]") {
          return { getAttribute: (name: string) => (name === "alt" ? "Example Company" : null) };
        }
        return null;
      },
      querySelectorAll() {
        return [];
      },
    });

    expect(captureCurrentPublicJobPage()).toEqual({
      canonicalUrl: "https://job-boards.greenhouse.io/example/jobs/123",
      company: "Example Company",
      title: "Security Engineer",
    });
  });
});
