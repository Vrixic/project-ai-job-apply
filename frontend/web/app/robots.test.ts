import { afterEach, describe, expect, it } from "vitest";
import robots, { dynamic } from "./robots.js";

const previousOrigin = process.env.APP_BASE_URL;
const previousIndexing = process.env.PUBLIC_JOB_INDEXING_ENABLED;

afterEach(() => {
  process.env.APP_BASE_URL = previousOrigin;
  process.env.PUBLIC_JOB_INDEXING_ENABLED = previousIndexing;
});

describe("robots", () => {
  it("evaluates the server-only indexing gate at request time", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("disallows public job pages by default", () => {
    process.env.APP_BASE_URL = "https://jobs.acme-careers.com";
    delete process.env.PUBLIC_JOB_INDEXING_ENABLED;
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("allows the route only behind the exact approved gate", () => {
    process.env.APP_BASE_URL = "https://jobs.acme-careers.com";
    process.env.PUBLIC_JOB_INDEXING_ENABLED = "true";
    expect(robots()).toEqual({
      rules: { userAgent: "*", disallow: "/", allow: "/jobs/" },
    });
  });
});
