import { describe, expect, it } from "vitest";
import { sameDocumentPosting } from "../lib/document-url";

const OVERVIEW = "https://jobs.ashbyhq.com/Acme/f4661035-7dce-4dbe-b5f5-6f1288d5ec07";
const APPLICATION = `${OVERVIEW}/application`;

describe("sameDocumentPosting", () => {
  it("accepts the Ashby overview as the address a document on the application tab was created at", () => {
    expect(sameDocumentPosting(APPLICATION, OVERVIEW)).toBe(true);
  });

  it("accepts the application tab as the address of a document now on the overview", () => {
    expect(sameDocumentPosting(OVERVIEW, APPLICATION)).toBe(true);
  });

  it("accepts the same page with or without a tracking query", () => {
    expect(sameDocumentPosting(APPLICATION, `${APPLICATION}?utm_source=x`)).toBe(true);
    expect(sameDocumentPosting(`${OVERVIEW}?utm_source=x`, OVERVIEW)).toBe(true);
  });

  it("refuses another posting, another host, another scheme and no address", () => {
    expect(
      sameDocumentPosting(
        APPLICATION,
        "https://jobs.ashbyhq.com/Acme/00000000-0000-4000-8000-000000000000",
      ),
    ).toBe(false);
    expect(
      sameDocumentPosting(
        APPLICATION,
        "https://jobs.ashbyhq.com.evil.example/Acme/f4661035-7dce-4dbe-b5f5-6f1288d5ec07",
      ),
    ).toBe(false);
    expect(sameDocumentPosting(APPLICATION, OVERVIEW.replace("https:", "http:"))).toBe(false);
    expect(sameDocumentPosting(APPLICATION, undefined)).toBe(false);
  });

  it("does not turn an unrelated subpage into the application", () => {
    expect(sameDocumentPosting(APPLICATION, `${OVERVIEW}/other`)).toBe(false);
    expect(
      sameDocumentPosting(
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://boards.greenhouse.io/acme/jobs/1/application",
      ),
    ).toBe(false);
  });
});
