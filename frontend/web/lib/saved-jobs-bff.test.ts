import { describe, expect, it } from "vitest";
import { forwardIdempotencyKey, readSavedJobBody, savedJobIdentifier } from "./saved-jobs-bff";

describe("saved-jobs BFF boundary", () => {
  it("accepts bounded JSON, safe identifiers, and bounded idempotency keys", async () => {
    const request = new Request("https://web.example.test/api/platform/saved-jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "saved-job-create-0001",
      },
      body: JSON.stringify({ jobId: "019d04cf-1f80-7000-8000-000000000012" }),
    });
    await expect(readSavedJobBody(request.clone())).resolves.toEqual({
      body: '{"jobId":"019d04cf-1f80-7000-8000-000000000012"}',
    });
    expect(forwardIdempotencyKey(request)).toBe("saved-job-create-0001");
    expect(savedJobIdentifier("019d04cf-1f80-7000-8000-000000000012")).toBeDefined();
  });

  it("rejects query values, invalid identifiers, missing keys, and unbounded bodies", async () => {
    const query = await readSavedJobBody(
      new Request("https://web.example.test/api/platform/saved-jobs?owner=private", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect("failure" in query && query.failure.status).toBe(400);
    const oversized = await readSavedJobBody(
      new Request("https://web.example.test/api/platform/saved-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"value":"${"x".repeat(16 * 1024)}"}`,
      }),
    );
    expect("failure" in oversized && oversized.failure.status).toBe(413);
    expect(savedJobIdentifier("../other-owner")).toBeUndefined();
    expect(forwardIdempotencyKey(new Request("https://web.example.test"))).toBeUndefined();
  });
});
