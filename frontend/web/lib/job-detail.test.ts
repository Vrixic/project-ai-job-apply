import type { CanonicalJobDetail } from "@ai-job-apply/api-contracts";
import { describe, expect, it } from "vitest";
import { parseJobDetail } from "./job-detail";

const detail: CanonicalJobDetail = {
  id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c1",
  company: {
    id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c2",
    name: "Synthetic Company",
    verifiedDomain: "example.test",
  },
  title: "Synthetic Software Engineer",
  locations: ["Remote - US"],
  department: "Engineering",
  description: "Synthetic employer description.\n<script>untrusted text, not markup</script>",
  status: "active",
  firstObservedAt: "2026-09-01T12:00:00.000Z",
  lastVerifiedAt: "2026-09-10T12:00:00.000Z",
  expiresAt: "2026-10-10T12:00:00.000Z",
  validThrough: "2026-10-10T12:00:00.000Z",
  sources: [
    {
      provider: "greenhouse",
      provenance: "permitted_api",
      canonicalUrl: "https://boards.example.test/synthetic/jobs/42?gh_jid=42",
      firstObservedAt: "2026-09-01T12:00:00.000Z",
      lastVerifiedAt: "2026-09-10T12:00:00.000Z",
      validThrough: "2026-10-10T12:00:00.000Z",
    },
  ],
};

describe("browser-safe authenticated job-detail parser", () => {
  it("accepts the existing contract without rewriting description, provenance, or canonical ID", () => {
    const before = JSON.stringify(detail);
    expect(parseJobDetail(detail)).toBe(detail);
    expect(JSON.stringify(detail)).toBe(before);
    const canonicalAliasResult = {
      ...detail,
      id: "018f92b0-4ad7-7b1d-8f44-b7ae694c85c3",
    };
    expect(parseJobDetail(canonicalAliasResult)).toBe(canonicalAliasResult);
  });

  it("accepts optional omissions and multiple existing source provenance types", () => {
    const { department: _department, validThrough: _validThrough, ...minimum } = detail;
    const { verifiedDomain: _domain, ...company } = minimum.company;
    const { validThrough: _sourceThrough, ...source } = minimum.sources[0] ?? {};
    const value = {
      ...minimum,
      company,
      sources: [
        source,
        {
          ...source,
          provider: "ugc",
          provenance: "explicit_ugc",
          canonicalUrl: "https://careers.example.test/synthetic/42",
        },
      ],
    };
    expect(parseJobDetail(value)).toEqual(value);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { ...detail, id: "private-invalid-identifier" },
    { ...detail, status: "expired" },
    { ...detail, description: "" },
    { ...detail, description: "x".repeat(200_001) },
    { ...detail, locations: [] },
    { ...detail, lastVerifiedAt: "not-a-date" },
    { ...detail, ownerId: "private-owner-canary" },
    { ...detail, company: { ...detail.company, ownerId: "private-owner-canary" } },
    { ...detail, sources: [] },
    { ...detail, sources: [{ ...detail.sources[0], provider: "private-provider" }] },
    { ...detail, sources: [{ ...detail.sources[0], provenance: "automatically_trusted" }] },
    { ...detail, sources: [{ ...detail.sources[0], contributorId: "private-owner-canary" }] },
  ])("rejects invalid or additional fields without returning a partial projection", (value) => {
    expect(parseJobDetail(value)).toBeUndefined();
  });

  it.each([
    "http://careers.example.test/synthetic/42",
    "javascript:alert(1)",
    "data:text/html,private-source-canary",
    "file:///private-source-canary",
    "//careers.example.test/synthetic/42",
    "https://private-user:private-password@careers.example.test/synthetic/42",
    "https://private-user@careers.example.test/synthetic/42",
    "https://careers.example.test/synthetic/42#private-source-canary",
    "https://careers.example.test/synthetic/42#",
    " https://careers.example.test/synthetic/42",
    "https://careers.example.test/synthetic/42\n",
    "https://careers.example.test/synthetic/\t42",
  ])("rejects an unsafe or noncanonical source URL", (canonicalUrl) => {
    const value = { ...detail, sources: [{ ...detail.sources[0], canonicalUrl }] };
    expect(parseJobDetail(value)).toBeUndefined();
  });
});
