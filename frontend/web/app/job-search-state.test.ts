import { describe, expect, it } from "vitest";
import {
  appendJobSearchPage,
  buildJobSearchRequest,
  jobSearchFailureAction,
} from "./job-search-state";

const fields = {
  query: "  distributed systems  ",
  title: " Software Engineer ",
  company: " Example Corp ",
  location: " New York, NY ",
  verifiedWithinDays: "30",
  sort: "relevance" as const,
};

describe("job search browser state", () => {
  it("builds a bounded request from only supported fields", () => {
    expect(buildJobSearchRequest(fields)).toEqual({
      query: "distributed systems",
      filters: {
        title: "Software Engineer",
        company: "Example Corp",
        location: "New York, NY",
        verifiedWithinDays: 30,
      },
      sort: "relevance",
      pageSize: 10,
    });
  });

  it("omits blank optional values and carries only an opaque cursor for the next page", () => {
    expect(
      buildJobSearchRequest(
        {
          query: " ",
          title: "",
          company: "",
          location: "",
          verifiedWithinDays: "",
          sort: "freshness",
        },
        "opaque-cursor",
      ),
    ).toEqual({ sort: "freshness", pageSize: 10, cursor: "opaque-cursor" });
  });

  it("appends a stable page without duplicating an existing job", () => {
    const first = {
      id: "019c0000-0000-7000-8000-000000000001",
      company: {
        id: "019c0000-0000-7000-8000-000000000010",
        name: "Example",
      },
      title: "Engineer",
      locations: ["Remote"],
      status: "active" as const,
      firstObservedAt: "2026-08-01T00:00:00.000Z",
      lastVerifiedAt: "2026-08-12T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
    };
    const second = { ...first, id: "019c0000-0000-7000-8000-000000000002" };

    expect(appendJobSearchPage([first], { items: [first, second] })).toEqual([first, second]);
  });

  it("restarts only a changed-catalog continuation and treats other failures as errors", () => {
    expect(jobSearchFailureAction(409, "job_search_catalog_changed", true)).toBe("restart");
    expect(jobSearchFailureAction(409, "job_search_catalog_changed", false)).toBe("error");
    expect(jobSearchFailureAction(401, "authentication_required", true)).toBe("error");
    expect(jobSearchFailureAction(413, "payload_too_large", true)).toBe("error");
    expect(jobSearchFailureAction(400, "invalid_request", true)).toBe("error");
  });
});
