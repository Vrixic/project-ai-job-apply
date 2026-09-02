import { createHash } from "node:crypto";
import type { NormalizedContributionProposal } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import type { IngestionSourceAdapter, SourcePollResult } from "./contract.js";
import { RegisteredIndependentProviderVerifier, type IndependentProviderVerificationRegistration } from "./contribution-verification.js";
import { SourceRegistry } from "./registry.js";

const contributionId = "018f0000-0000-7000-8000-000000000001";
const normalizationId = "018f0000-0000-7000-8000-000000000002";
const ids = ["018f0000-0000-7000-8000-000000000003", "018f0000-0000-7000-8000-000000000004", "018f0000-0000-7000-8000-000000000005"];
const sourceUrl = "https://boards.greenhouse.io/acme/jobs/123";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function proposal(overrides: Partial<NormalizedContributionProposal> = {}): NormalizedContributionProposal {
  return { schemaVersion: 1, normalizedCompanyName: "acme", normalizedTitle: "engineer", normalizedLocations: ["new york"], normalizedDescriptionSha256: digest("build things"), provenance: { provider: "greenhouse", pageVariant: "greenhouse-board-v1", canonicalSourceUrl: sourceUrl, canonicalSourceUrlSha256: digest(sourceUrl), atsTenant: "acme", externalJobId: "123", adapterVersion: "d2-job-page-v1", contributedContentSha256: digest("contribution"), observedAt: "2026-09-02T12:00:00.000Z" }, dedupe: { exactIdentityKeys: [], fuzzyFingerprintSha256: digest("fuzzy") }, proposalSha256: digest("proposal"), ...overrides };
}

function harness(result: SourcePollResult, configurations?: readonly IndependentProviderVerificationRegistration[], identityMatches = [{ jobId: ids[1]!, sourceId: ids[2]! }]) {
  const poll = vi.fn(async () => result);
  const adapter: IngestionSourceAdapter = { sourceId: "greenhouse-acme", adapterVersion: "greenhouse-v1", poll };
  const registry = new SourceRegistry([{ sourceId: adapter.sourceId, provider: "greenhouse", provenance: "permitted_api", adapter, enabled: true }], () => true, { providerActivationAllowed: true });
  const findExact = vi.fn(async () => identityMatches);
  const verifier = new RegisteredIndependentProviderVerifier(registry, { findExact }, configurations ?? [{ sourceId: adapter.sourceId, provider: "greenhouse", pageVariant: "greenhouse-board-v1", atsTenant: "acme", sourcePolicyVersion: "provider-policy-v1" }], { clock: () => new Date("2026-09-02T12:01:00.000Z"), createId: () => ids[0]! });
  return { verifier, poll, findExact };
}

const observation = { companyName: "Acme", title: "Engineer", locations: ["New York"], description: "Build things", sourceUrl, atsTenant: "acme", externalJobId: "123", verifiedCompanyDomain: "acme.example" };

describe("RegisteredIndependentProviderVerifier", () => {
  it("is default-dark and never polls without explicit registration", async () => {
    const { verifier, poll } = harness({ kind: "success", observations: [observation] }, []);
    await expect(verifier.verify({ contributionId, normalizationId, proposal: proposal() })).resolves.toMatchObject({ status: "unavailable" });
    expect(poll).not.toHaveBeenCalled();
  });

  it("verifies exact independently fetched identity/content with digest-only evidence", async () => {
    const { verifier, poll, findExact } = harness({ kind: "success", observations: [observation] });
    const result = await verifier.verify({ contributionId, normalizationId, proposal: proposal() });
    expect(result).toMatchObject({ status: "verified", origin: "independent_provider_fetch", sourcePolicyVersion: "provider-policy-v1", canonicalSourceUrlSha256: digest(sourceUrl) });
    expect(poll).toHaveBeenCalledOnce();
    expect(findExact).toHaveBeenCalledWith({ provider: "greenhouse", atsTenant: "acme", externalJobId: "123", canonicalSourceUrl: sourceUrl });
    expect(result).toMatchObject({ jobId: ids[1], sourceId: ids[2], verificationId: ids[0] });
    expect(JSON.stringify(result)).not.toContain("Acme");
    expect(JSON.stringify(result)).not.toContain(sourceUrl);
  });

  it("returns mismatch, closed, and unavailable without treating contribution as truth", async () => {
    await expect(harness({ kind: "success", observations: [{ ...observation, title: "Other" }] }).verifier.verify({ contributionId, normalizationId, proposal: proposal() })).resolves.toMatchObject({ status: "mismatch" });
    await expect(harness({ kind: "retry", reason: "source_unavailable" }).verifier.verify({ contributionId, normalizationId, proposal: proposal() })).resolves.toMatchObject({ status: "unavailable" });
  });

  it("reports closed only for an exact provider withdrawal", async () => {
    const ashbyUrl = "https://jobs.ashbyhq.com/acme/abcdefgh";
    const poll = vi.fn(async (): Promise<SourcePollResult> => ({ kind: "success", observations: [], withdrawals: [{ sourceUrl: ashbyUrl, atsTenant: "acme", externalJobId: "abcdefgh" }] }));
    const adapter: IngestionSourceAdapter = { sourceId: "ashby-acme", adapterVersion: "ashby-v1", poll };
    const registry = new SourceRegistry([{ sourceId: adapter.sourceId, provider: "ashby", provenance: "permitted_api", adapter, enabled: true }], () => true, { providerActivationAllowed: true });
    const verifier = new RegisteredIndependentProviderVerifier(registry, { findExact: async () => [] }, [{ sourceId: adapter.sourceId, provider: "ashby", pageVariant: "ashby-job-board-v1", atsTenant: "acme", sourcePolicyVersion: "provider-policy-v1" }], { clock: () => new Date("2026-09-02T12:01:00.000Z") });
    const ashby = proposal({ provenance: { ...proposal().provenance, provider: "ashby", pageVariant: "ashby-job-board-v1", canonicalSourceUrl: ashbyUrl, canonicalSourceUrlSha256: digest(ashbyUrl), externalJobId: "abcdefgh" } });
    await expect(verifier.verify({ contributionId, normalizationId, proposal: ashby })).resolves.toMatchObject({ status: "closed" });
  });

  it.each([
    ["variant", { provenance: { ...proposal().provenance, pageVariant: "lever-posting-v1" as const } }],
    ["tenant", { provenance: { ...proposal().provenance, atsTenant: "other" } }],
    ["external ID", { provenance: { ...proposal().provenance, externalJobId: "999" } }],
    ["canonical URL", { provenance: { ...proposal().provenance, canonicalSourceUrl: "https://boards.greenhouse.io/acme/jobs/999", canonicalSourceUrlSha256: digest("https://boards.greenhouse.io/acme/jobs/999") } }],
  ])("fails closed for unsupported %s", async (_label, override) => {
    const { verifier } = harness({ kind: "success", observations: [observation] });
    await expect(verifier.verify({ contributionId, normalizationId, proposal: proposal(override as Partial<NormalizedContributionProposal>) })).resolves.not.toMatchObject({ status: "verified" });
  });

  it("maps malformed independently fetched data to unavailable", async () => {
    const { verifier } = harness({ kind: "success", observations: [{ ...observation, sourceUrl: "http://invalid.test" }] });
    await expect(verifier.verify({ contributionId, normalizationId, proposal: proposal() })).resolves.toMatchObject({ status: "unavailable" });
  });

  it.each([
    { label: "absent", matches: [] },
    { label: "ambiguous", matches: [{ jobId: ids[1]!, sourceId: ids[2]! }, { jobId: ids[2]!, sourceId: ids[1]! }] },
  ])("denies $label catalog identities", async ({ matches }) => {
    const { verifier } = harness({ kind: "success", observations: [observation] }, undefined, matches);
    await expect(verifier.verify({ contributionId, normalizationId, proposal: proposal() })).resolves.toMatchObject({ status: "unavailable" });
  });
});
