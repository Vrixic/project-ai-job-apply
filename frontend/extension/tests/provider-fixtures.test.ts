// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPublicJob } from "../lib/detectors";
import { captureCurrentPublicJobPage } from "../lib/page-inspection";

const fixtures = [
  {
    provider: "lever",
    variant: "lever-posting-v1",
    directory: "lever/job-page-posting-v1",
    html: "lever-posting-v1.html",
    htmlSha256: "7850364a3985f505e59db7fca9d21f3271a8e347db869e6bea15b7921bbc60eb",
    structured: "lever-job-posting.json",
    structuredSha256: "093f628c72f470eacd7d6651a49d8d01ebbf8f53de06951db7aa971a8e1a747f",
    sourceUrl: "https://jobs.lever.co/example/EXAMPLE-LEVER-001",
    postingId: "EXAMPLE-LEVER-001",
    fields: {
      company: "Example Organization",
      location: "Example City",
      title: "Example Platform Engineer",
      workMode: "remote",
    },
  },
  {
    provider: "ashby",
    variant: "ashby-job-board-v1",
    directory: "ashby/job-page-board-v1",
    html: "ashby-job-board-v1.html",
    htmlSha256: "62a46c935c942811ed454ef624bc7921be03b141edb5f16faf5be49c5b70ec48",
    structured: "ashby-job-posting.json",
    structuredSha256: "31e06f3dcce2330899f98f618978d0056f712eca936b24645b0593b174521454",
    sourceUrl: "https://jobs.ashbyhq.com/example/019d04cf-1f80-7000-8000-000000000061",
    postingId: "019d04cf-1f80-7000-8000-000000000061",
    fields: {
      company: "Synthetic Employer",
      externalJobId: "019d04cf-1f80-7000-8000-000000000060",
      location: "Example City, Example Region, Example Country",
      title: "Synthetic Platform Engineer",
      workMode: "remote",
    },
  },
] as const;

const forbiddenContent = "script,iframe,object,embed,form,input,link,style,base";
const networkAttributes = "[src],[srcset],[href],[action],[formaction],[style]";
const networkRequest = vi.fn(() => {
  throw new Error("Network forbidden in fixture tests");
});

function readApprovedPayload(directory: string, name: string, sha256: string): string {
  const payload = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../packages/test-fixtures/ats",
      directory,
      name,
    ),
  );
  expect(createHash("sha256").update(payload).digest("hex")).toBe(sha256);
  return payload.toString("utf8");
}

function normalizedText(value: string | null): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function loadFixture(fixture: (typeof fixtures)[number]): void {
  const html = readApprovedPayload(fixture.directory, fixture.html, fixture.htmlSha256);
  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    "text/html",
  ).documentElement.innerHTML;
  vi.stubGlobal("location", { href: fixture.sourceUrl });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", networkRequest);
});

afterEach(() => {
  expect(networkRequest).not.toHaveBeenCalled();
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("accepted provider-derived job fixtures", () => {
  it.each([12_001, 18_185, 50_000, 50_001])(
    "keeps or explicitly omits the complete %i-character synthetic Ashby description",
    (length) => {
      const tail = " complete synthetic tail >= 5";
      const description = `${"x".repeat(length - tail.length)}${tail}`;
      const encoded = description.replaceAll(">", "&gt;");
      const structured = document.createElement("script");
      structured.type = "application/ld+json";
      structured.textContent = JSON.stringify({
        "@type": "JobPosting",
        title: "Synthetic Platform Engineer",
        description: `<p> \n${encoded}\t </p>`,
      });
      document.head.append(structured);
      vi.stubGlobal("location", { href: fixtures[1].sourceUrl });
      const snapshot = captureCurrentPublicJobPage();
      const capture = detectPublicJob(snapshot);
      if (length <= 50_000) {
        expect(snapshot.description).toBe(description);
        expect(capture?.description).toBe(description);
        expect(capture).not.toHaveProperty("descriptionUnavailableReason");
      } else {
        expect(snapshot).not.toHaveProperty("description");
        expect(capture).not.toHaveProperty("description");
        expect(capture?.descriptionUnavailableReason).toBe("too_long");
      }
    },
  );

  it.each([50_000, 50_001])(
    "checks the full %i-character DOM description before duplicate-heading removal",
    (length) => {
      const root = document.createElement("article");
      root.dataset.jobDescription = "";
      const heading = document.createElement("h2");
      heading.textContent = "Synthetic heading ";
      const rest = `Synthetic heading ${"x".repeat(length - 36)}`;
      root.append(heading, document.createTextNode(rest));
      const title = document.createElement("h1");
      title.textContent = "Synthetic Engineer";
      document.body.append(title, root);
      vi.stubGlobal("location", { href: fixtures[1].sourceUrl });
      expect(root.textContent?.length).toBe(length);
      const snapshot = captureCurrentPublicJobPage();
      if (length === 50_000) {
        expect(snapshot.description).toBe(rest);
      } else {
        expect(snapshot).not.toHaveProperty("description");
        expect(snapshot.descriptionUnavailableReason).toBe("too_long");
      }
    },
  );

  it("does not parse or share a prefix of oversized structured source", () => {
    const structured = document.createElement("script");
    structured.type = "application/ld+json";
    structured.textContent = JSON.stringify({
      "@type": "JobPosting",
      title: "Synthetic Engineer",
      description: `<p>${"x".repeat(200_001)} tail</p>`,
    });
    const title = document.createElement("h1");
    title.textContent = "Synthetic Engineer";
    document.head.append(structured);
    document.body.append(title);
    vi.stubGlobal("location", { href: fixtures[1].sourceUrl });
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    const snapshot = captureCurrentPublicJobPage();
    expect(parse).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveProperty("description");
    expect(snapshot.descriptionUnavailableReason).toBe("source_too_large");
    expect(detectPublicJob(snapshot)?.descriptionUnavailableReason).toBe("source_too_large");
    parse.mockRestore();
  });

  it.each(["< 10 and > 5", "<=10 and >=5", "x < y and y > z"])(
    "keeps entity-decoded synthetic Ashby comparisons in the actual capture path: %s",
    (comparison) => {
      const description = `Synthetic workload ${comparison}. `;
      const encoded = description.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const structured = document.createElement("script");
      structured.type = "application/ld+json";
      structured.textContent = JSON.stringify({
        "@type": "JobPosting",
        title: "Synthetic Platform Engineer",
        description: `<p>${encoded}</p><p>Public responsibilities.</p>`,
      });
      document.head.append(structured);
      vi.stubGlobal("location", { href: fixtures[1].sourceUrl });

      const capture = detectPublicJob(captureCurrentPublicJobPage());

      expect(capture?.description).toBe(`${description}Public responsibilities.`);
      expect(capture?.provider).toBe("ashby");
    },
  );

  it.each(fixtures)(
    "keeps the approved $provider payloads inert and integrity-pinned",
    (fixture) => {
      loadFixture(fixture);
      expect(document.querySelector(forbiddenContent)).toBeNull();
      expect(document.querySelector(networkAttributes)).toBeNull();
      const structured = JSON.parse(
        readApprovedPayload(fixture.directory, fixture.structured, fixture.structuredSha256),
      ) as { "@type": string; description: string };
      expect(structured["@type"]).toBe("JobPosting");
      const description = new DOMParser().parseFromString(structured.description, "text/html");
      expect(description.querySelector(forbiddenContent)).toBeNull();
      expect(description.querySelector(networkAttributes)).toBeNull();
      expect(normalizedText(description.body.textContent)).not.toBe("");
    },
  );

  it.each(fixtures)(
    "extracts the accepted $provider structured fields in an offline DOM",
    (fixture) => {
      loadFixture(fixture);
      const source = readApprovedPayload(
        fixture.directory,
        fixture.structured,
        fixture.structuredSha256,
      );
      const structured = JSON.parse(source) as { description: string };
      const description = normalizedText(
        new DOMParser().parseFromString(structured.description, "text/html").body.textContent,
      );
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.textContent = source;
      document.head.append(script);

      const snapshot = captureCurrentPublicJobPage();
      expect(snapshot).toEqual({
        canonicalUrl: fixture.sourceUrl,
        ...fixture.fields,
        description,
      });
      expect(detectPublicJob(snapshot, "2026-09-11T00:00:00.000Z")).toEqual({
        ...fixture.fields,
        description,
        externalJobId: fixture.postingId,
        adapterVersion: "d2-job-page-v1",
        capturedAt: "2026-09-11T00:00:00.000Z",
        pageVariant: fixture.variant,
        provider: fixture.provider,
        sourceUrl: fixture.sourceUrl,
      });
    },
  );

  it("reads Lever's observed DOM fallback without claiming structured-prose equivalence", () => {
    const fixture = fixtures[0];
    loadFixture(fixture);
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(captureCurrentPublicJobPage()).toEqual({
      canonicalUrl: fixture.sourceUrl,
      company: "Example Organization",
      description: normalizedText(document.querySelector(".content")?.textContent ?? null),
      location: "Example City, EXAMPLE-REGION",
      title: "Example Platform Engineer",
      workMode: "remote",
    });
  });

  it("does not invent job fields from the observed Ashby loading shell", () => {
    const fixture = fixtures[1];
    loadFixture(fixture);
    expect(document.querySelector("#root .center .fade-in .spinner")).not.toBeNull();
    const snapshot = captureCurrentPublicJobPage();
    expect(snapshot).toEqual({ canonicalUrl: fixture.sourceUrl });
    expect(detectPublicJob(snapshot)).toBeUndefined();
  });
});
