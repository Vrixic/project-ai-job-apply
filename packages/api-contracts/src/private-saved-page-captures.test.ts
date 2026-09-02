import { describe, expect, it } from "vitest";
import { compileComponentValidator, contract } from "./index.js";

const captureId = "019d04cf-1f80-7000-8000-000000000041";
const request = {
  schemaVersion: 1,
  captureId,
  source: {
    provider: "lever",
    pageVariant: "lever-posting-v1",
    sourceUrl: "https://jobs.eu.lever.co/synthetic/engineering-123",
    adapterVersion: "d2-job-page-v1",
  },
  snapshot: {
    title: "Software Engineer",
    company: "Synthetic Company",
    location: "Remote",
    description: "Generated synthetic posting text.",
    externalJobId: "engineering-123",
  },
  capturedAt: "2026-09-01T12:00:00.000Z",
} as const;

describe("private saved-page capture contracts", () => {
  const validateRequest = compileComponentValidator("CreatePrivateSavedPageCaptureRequest");
  const validateCapture = compileComponentValidator("PrivateSavedPageCapture");

  it("accepts the exact bounded private capture and redacted owner response", () => {
    expect(validateRequest(request)).toBe(true);
    expect(
      validateCapture({
        schemaVersion: 1,
        id: captureId,
        source: request.source,
        snapshot: request.snapshot,
        capturedAt: request.capturedAt,
        savedAt: "2026-09-01T12:00:01.000Z",
        resolution: {
          canonicalJobId: "019d04cf-1f80-7000-8000-000000000042",
          resolvedAt: "2026-09-01T12:05:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("rejects owner injection, raw page data, query-bearing URLs, and provider drift", () => {
    expect(validateRequest({ ...request, ownerUserId: captureId })).toBe(false);
    expect(validateRequest({ ...request, rawDom: "<html />" })).toBe(false);
    expect(
      validateRequest({
        ...request,
        source: { ...request.source, sourceUrl: `${request.source.sourceUrl}?token=private` },
      }),
    ).toBe(false);
    expect(
      validateRequest({
        ...request,
        source: { ...request.source, provider: "ashby" },
      }),
    ).toBe(false);
    expect(
      validateCapture({
        schemaVersion: 1,
        id: captureId,
        ownerUserId: captureId,
        source: request.source,
        snapshot: request.snapshot,
        capturedAt: request.capturedAt,
        savedAt: request.capturedAt,
      }),
    ).toBe(false);
  });

  it("uses separate owner read/write scopes and non-cacheable exact responses", () => {
    const create = contract.paths["/saved-job-captures"].post;
    const resource = contract.paths["/saved-job-captures/{captureId}"];
    expect(create.security).toEqual([{ oidc: ["jobs:write"] }]);
    expect(resource.get.security).toEqual([{ oidc: ["jobs:read"] }]);
    expect(resource.delete.security).toEqual([{ oidc: ["jobs:write"] }]);
    expect(create.responses["201"].headers["Cache-Control"].schema.enum).toEqual(["no-store"]);
    expect(resource.get.responses["200"].headers["Cache-Control"].schema.enum).toEqual([
      "no-store",
    ]);
    expect(resource.delete.responses["204"].headers["Cache-Control"].schema.enum).toEqual([
      "no-store",
    ]);
    expect(resource).not.toHaveProperty("post");
    expect(resource).not.toHaveProperty("patch");
    expect(resource).not.toHaveProperty("put");
  });
});
