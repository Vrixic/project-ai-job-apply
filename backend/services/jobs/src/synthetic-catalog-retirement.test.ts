import { describe, expect, it } from "vitest";
import { canonicalizeObservation } from "./domain/canonical-job.js";
import {
  inspectSyntheticCatalogRetirementRows,
  parseSyntheticCatalogRetirementEnvironment,
  type SyntheticCatalogRetirementRow,
} from "./synthetic-catalog-retirement.js";

function row(reliability = false): SyntheticCatalogRetirementRow {
  const seed = "foundation01";
  const observation = canonicalizeObservation({
    provider: "other",
    provenance: "authorized_fixture",
    companyName: `Generated Synthetic Company ${seed}`,
    title: reliability ? "Generated Reliability Engineer" : "Generated Systems Engineer",
    locations: [reliability ? "Synthetic City, NY" : "Remote - US"],
    description: reliability
      ? "Generated synthetic reliability content with no provider, employer, or candidate data."
      : "Generated synthetic job content for deterministic source-neutral ingestion verification.",
    department: reliability ? "Synthetic Reliability" : "Synthetic Engineering",
    sourceUrl: `https://jobs.example.test/source-neutral/${seed}/${reliability ? "reliability-engineer" : "systems-engineer"}`,
    observedAt: new Date("2026-09-11T12:00:00.000Z"),
  });
  const jobId = reliability
    ? "00000000-0000-4000-8000-000000000002"
    : "00000000-0000-4000-8000-000000000001";
  const companyId = "00000000-0000-4000-8000-000000000003";
  return {
    job: {
      id: jobId,
      company_id: companyId,
      title: observation.title,
      normalized_title: observation.normalizedTitle,
      locations: observation.locations,
      normalized_locations: observation.normalizedLocations,
      department: observation.department,
      normalized_department: observation.normalizedDepartment,
      work_mode: reliability ? "hybrid" : "remote",
      employment_type: "full_time",
      description: observation.description,
      description_hash: observation.contentHash,
      dedupe_fingerprint: observation.fuzzyFingerprint,
      status: "active",
      status_reason: "first_positive_verification",
      date_posted: null,
      application_url: null,
      structured_locations: null,
      updated_at: "2026-09-11T12:00:00.123456+00:00",
    },
    company: {
      id: companyId,
      display_name: observation.companyName,
      normalized_name: observation.normalizedCompanyName,
      verified_domain: `${seed}.example.test`,
    },
    sources: [
      {
        id: reliability
          ? "00000000-0000-4000-8000-000000000005"
          : "00000000-0000-4000-8000-000000000004",
        job_id: jobId,
        provider: "other",
        provenance: "authorized_fixture",
        ats_tenant: `synthetic-${seed}`,
        external_job_id: `generated-job-${reliability ? 2 : 1}`,
        employer_requisition_id: `generated-${seed}-${reliability ? 2 : 1}`,
        verified_company_domain: `${seed}.example.test`,
        source_url: observation.canonicalUrl,
        canonical_url: observation.canonicalUrl,
        canonical_url_hash: observation.canonicalUrlHash,
        content_hash: observation.contentHash,
        adapter_version: "synthetic-ingestion-v1",
        date_posted: null,
        application_url: null,
        structured_locations: null,
        raw_snapshot: { generated: true, sentinel: "private-payload-not-in-result" },
      },
    ],
    sourceCount: 1,
    duplicateBinding: false,
    contributionBinding: false,
  };
}

const environment = {
  SYNTHETIC_CATALOG_RETIREMENT_ENVIRONMENT: "development",
  SYNTHETIC_CATALOG_RETIREMENT_CONFIRMATION: "retain-generated-source-neutral-history",
  SYNTHETIC_CATALOG_RETIREMENT_ACTION: "inspect",
};

describe("synthetic catalog retirement scope", () => {
  it("accepts only the explicit development inspect/retire environment", () => {
    expect(parseSyntheticCatalogRetirementEnvironment(environment)).toEqual({ action: "inspect" });
    expect(
      parseSyntheticCatalogRetirementEnvironment({
        ...environment,
        SYNTHETIC_CATALOG_RETIREMENT_ACTION: "retire",
        SYNTHETIC_CATALOG_RETIREMENT_EXPECTED_MANIFEST_SHA256: "a".repeat(64),
      }),
    ).toEqual({ action: "retire", expectedManifestSha256: "a".repeat(64) });
  });
  it.each([
    { SYNTHETIC_CATALOG_RETIREMENT_ENVIRONMENT: "production" },
    { SYNTHETIC_CATALOG_RETIREMENT_CONFIRMATION: "yes" },
    { SYNTHETIC_CATALOG_RETIREMENT_ACTION: "delete" },
    { SYNTHETIC_CATALOG_RETIREMENT_ACTION: "retire" },
    { SYNTHETIC_CATALOG_RETIREMENT_EXPECTED_MANIFEST_SHA256: "a".repeat(64) },
    { SYNTHETIC_CATALOG_RETIREMENT_SQL: "private-sentinel" },
    { SYNTHETIC_CATALOG_RETIREMENT_JOB_ID: "private-sentinel" },
    {
      SYNTHETIC_CATALOG_RETIREMENT_ACTION: "retire",
      SYNTHETIC_CATALOG_RETIREMENT_EXPECTED_MANIFEST_SHA256: "A".repeat(64),
    },
  ])("rejects an unsafe environment without reflecting inputs (%#)", (override) => {
    expect(() =>
      parseSyntheticCatalogRetirementEnvironment({ ...environment, ...override }),
    ).toThrow("SyntheticCatalogRetirementRejected");
  });
  it("validates both exact generated templates and emits only a deterministic aggregate", () => {
    const rows = [row(), row(true)];
    const result = inspectSyntheticCatalogRetirementRows(rows);
    expect(result).toMatchObject({
      schemaVersion: 1,
      namespace: "synthetic-foundation-v1",
      matchingJobs: 2,
      matchingSources: 2,
      retirableJobs: 2,
      alreadyHiddenJobs: 0,
    });
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(inspectSyntheticCatalogRetirementRows([...rows].reverse())).toEqual(result);
    const output = JSON.stringify(result);
    for (const secret of [
      "foundation01",
      "private-payload-not-in-result",
      "example.test",
      String(rows[0]?.job.id),
    ])
      expect(output).not.toContain(secret);
  });
  it.each([
    ["provider", "greenhouse"],
    ["provenance", "permitted_api"],
    ["provenance", "explicit_ugc"],
    ["adapter_version", "d1-search-acceptance-v1"],
    ["adapter_version", "unknown"],
    ["ats_tenant", "synthetic-otherseed"],
    ["external_job_id", "real-job"],
    ["employer_requisition_id", "real-requisition"],
    ["verified_company_domain", "real.example"],
    [
      "canonical_url",
      "https://jobs.example.test/source-neutral/foundation01/systems-engineer?extra=1",
    ],
    ["canonical_url", "https://jobs.example.test/d1-search-acceptance/foundation01/alpha"],
    ["source_url", "https://real.example/job"],
    ["content_hash", "f".repeat(64)],
    ["application_url", "https://real.example/apply"],
    ["date_posted", "2026-01-01"],
  ])("rejects changed source identity %s (%#)", (key, value) => {
    const fixture = row();
    const source = fixture.sources[0];
    if (!source) throw new Error("Missing generated fixture");
    source[key] = value;
    expect(() => inspectSyntheticCatalogRetirementRows([fixture])).toThrow(
      "SyntheticCatalogRetirementRejected",
    );
  });
  it.each(["title", "description", "department", "company_id", "work_mode", "dedupe_fingerprint"])(
    "rejects a modified canonical %s",
    (key) => {
      const fixture = row();
      fixture.job[key] = "private-real-job-sentinel";
      expect(() => inspectSyntheticCatalogRetirementRows([fixture])).toThrow(
        "SyntheticCatalogRetirementRejected",
      );
    },
  );
  it.each(["duplicateBinding", "contributionBinding"] as const)(
    "refuses %s even when the generated fields match",
    (key) => {
      const fixture = row();
      fixture[key] = true;
      expect(() => inspectSyntheticCatalogRetirementRows([fixture])).toThrow(
        "SyntheticCatalogRetirementRejected",
      );
    },
  );
  it("refuses mixed sources, duplicate rows, excess inventory and malformed company identity", () => {
    const fixture = row();
    expect(() => inspectSyntheticCatalogRetirementRows([{ ...fixture, sourceCount: 2 }])).toThrow();
    expect(() => inspectSyntheticCatalogRetirementRows([fixture, fixture])).toThrow();
    expect(() =>
      inspectSyntheticCatalogRetirementRows(Array.from({ length: 101 }, () => row())),
    ).toThrow();
    fixture.company.verified_domain = "real.example";
    expect(() => inspectSyntheticCatalogRetirementRows([fixture])).toThrow();
  });
  it("binds full private payloads and submillisecond clocks without returning them", () => {
    const fixture = row();
    const before = inspectSyntheticCatalogRetirementRows([fixture]);
    fixture.job.updated_at = "2026-09-11T12:00:00.123457+00:00";
    expect(inspectSyntheticCatalogRetirementRows([fixture]).manifestSha256).not.toBe(
      before.manifestSha256,
    );
    const source = fixture.sources[0];
    if (!source) throw new Error("Missing generated fixture");
    source.raw_snapshot = { changed: true };
    expect(inspectSyntheticCatalogRetirementRows([fixture]).manifestSha256).not.toBe(
      before.manifestSha256,
    );
  });
  it.each(["blocked", "expired", "withdrawn"])(
    "counts already-hidden %s rows without requesting another terminal transition",
    (status) => {
      const fixture = row();
      fixture.job.status = status;
      fixture.job.description = null;
      fixture.job.description_hash = null;
      expect(inspectSyntheticCatalogRetirementRows([fixture])).toMatchObject({
        matchingJobs: 1,
        retirableJobs: 0,
        alreadyHiddenJobs: 1,
      });
    },
  );
  it("supports an empty inventory without inventing a target", () => {
    expect(inspectSyntheticCatalogRetirementRows([])).toMatchObject({
      matchingJobs: 0,
      matchingSources: 0,
      retirableJobs: 0,
    });
  });
});
