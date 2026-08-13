import { describe, expect, it } from "vitest";
import { readJobSearchBffBody } from "./job-search-bff";

describe("job-search BFF boundary", () => {
  it("accepts one bounded JSON body without placing search text in a URL", async () => {
    const result = await readJobSearchBffBody(
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ query: "synthetic engineer" }),
      }),
    );
    expect(result).toEqual({ body: '{"query":"synthetic engineer"}' });
  });

  it.each([
    [
      "raw query values",
      new Request("https://web.example.test/api/platform/jobs/search?query=private", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      400,
    ],
    [
      "non-JSON media",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "query=private",
      }),
      415,
    ],
    [
      "empty bodies",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
      400,
    ],
    [
      "malformed JSON",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"query":"private"',
      }),
      400,
    ],
    [
      "oversized bodies",
      new Request("https://web.example.test/api/platform/jobs/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(64 * 1024 + 1),
      }),
      413,
    ],
  ])("rejects %s with a value-free problem", async (_label, request, expectedStatus) => {
    const result = await readJobSearchBffBody(request);
    expect("failure" in result && result.failure.status).toBe(expectedStatus);
    if ("failure" in result) {
      expect(await result.failure.text()).not.toContain("private");
    }
  });
});
