import { describe, expect, it } from "vitest";
import { loadBackendConfig } from "./index.js";

const requiredEnvironment = {
  DATABASE_URL: "postgres://candidate:local@localhost:5432/ai_job_apply",
  OIDC_ISSUER: "https://issuer.example.test/",
};

describe("observability configuration", () => {
  it("accepts a bounded trace sampling ratio", () => {
    expect(
      loadBackendConfig({
        ...requiredEnvironment,
        OTEL_TRACE_SAMPLE_RATIO: "0.25",
      }).OTEL_TRACE_SAMPLE_RATIO,
    ).toBe(0.25);
  });

  it.each([
    "-0.1",
    "1.1",
    "not-a-number",
  ])("rejects an invalid trace sampling ratio: %s", (value) => {
    expect(() =>
      loadBackendConfig({
        ...requiredEnvironment,
        OTEL_TRACE_SAMPLE_RATIO: value,
      }),
    ).toThrow();
  });
});
