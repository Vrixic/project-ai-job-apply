import { createHash } from "node:crypto";
import { type NormalizedContributionProposal, normalizeText } from "@ai-job-apply/jobs-service";
import { describe, expect, it } from "vitest";
import { AshbyJobBoardAdapter } from "./ashby.js";
import type { IngestionSourceAdapter } from "./contract.js";
import { RegisteredIndependentProviderVerifier } from "./contribution-verification.js";
import { GreenhouseJobBoardAdapter } from "./greenhouse.js";
import { LeverPostingsAdapter } from "./lever.js";
import { legacyPreviewDescription } from "./page-preview-compatibility.js";
import { SourceRegistry } from "./registry.js";

const digest = (value: string) => createHash("sha256").update(normalizeText(value)).digest("hex");
const timestamp = "2026-09-12T12:00:00.000Z";
const contributionId = "018f0000-0000-7000-8000-000000000001";
const normalizationId = "018f0000-0000-7000-8000-000000000002";
const verificationId = "018f0000-0000-7000-8000-000000000003";
const comparisons = "Require < 5 years, > 2 regions, <= 10 services and >= 3 tests.";
const tail = "Build reliable systems.";
const providers = ["ashby", "lever", "greenhouse"] as const;
type Provider = (typeof providers)[number];
const encoded = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function setup(
  provider: Provider,
  paragraphs = [comparisons, tail],
  auxiliary: "same" | "absent" | "contradictory" = "same",
) {
  const tenant = "synthetic-preview";
  const externalJobId = provider === "greenhouse" ? "123" : "12345678-abcd-4abc-8abc-1234567890ab";
  const host = {
    ashby: "jobs.ashbyhq.com",
    lever: "jobs.lever.co",
    greenhouse: "job-boards.greenhouse.io",
  }[provider];
  const sourceUrl = `https://${host}/${tenant}/${provider === "greenhouse" ? "jobs/" : ""}${externalJobId}`;
  const pageVariant = {
    ashby: "ashby-job-board-v1",
    lever: "lever-posting-v1",
    greenhouse: "greenhouse-board-v1",
  }[provider] as NormalizedContributionProposal["provenance"]["pageVariant"];
  const plain = paragraphs.join("\n");
  const html = paragraphs.map((text) => `<p>${encoded(text)}</p>`).join("");
  const auxiliaryHtml =
    auxiliary === "same"
      ? html
      : auxiliary === "contradictory"
        ? `${html}<p>Uncorroborated extra requirement.</p>`
        : undefined;
  const options = {
    sourceId: `${provider}-synthetic-preview`,
    companyName: "Example",
    verifiedCompanyDomain: "synthetic.example.test",
  };
  const fetch: typeof globalThis.fetch = async () =>
    new Response(
      JSON.stringify(
        provider === "ashby"
          ? {
              apiVersion: "1",
              jobs: [
                {
                  title: "Engineer",
                  location: "Remote",
                  isListed: true,
                  workplaceType: "Remote",
                  employmentType: "FullTime",
                  publishedAt: timestamp,
                  descriptionPlain: plain,
                  descriptionHtml: auxiliaryHtml,
                  jobUrl: sourceUrl,
                  applyUrl: `${sourceUrl}/application`,
                },
              ],
            }
          : provider === "lever"
            ? {
                id: externalJobId,
                text: "Engineer",
                categories: { location: "Remote" },
                descriptionPlain: plain,
                description: auxiliaryHtml,
                hostedUrl: sourceUrl,
                workplaceType: "remote",
              }
            : {
                id: 123,
                title: "Engineer",
                company_name: "Example",
                absolute_url: sourceUrl,
                location: { name: "Remote" },
                content: html,
              },
      ),
      { headers: { "content-type": "application/json" } },
    );
  const adapter: IngestionSourceAdapter =
    provider === "ashby"
      ? new AshbyJobBoardAdapter({ ...options, jobBoardName: tenant, fetch })
      : provider === "lever"
        ? new LeverPostingsAdapter({ ...options, site: tenant, region: "global", fetch })
        : new GreenhouseJobBoardAdapter({ ...options, boardToken: tenant, fetch });
  const verifier = new RegisteredIndependentProviderVerifier(
    new SourceRegistry(
      [
        {
          sourceId: adapter.sourceId,
          provider,
          provenance: "permitted_api",
          enabled: true,
          adapter,
        },
      ],
      () => true,
      { providerActivationAllowed: true },
    ),
    { findExact: async () => [] },
    [
      {
        sourceId: adapter.sourceId,
        provider,
        pageVariant,
        atsTenant: tenant,
        sourcePolicyVersion: "synthetic-policy-v1",
      },
    ],
    { clock: () => new Date(timestamp), createId: () => verificationId },
  );
  const verify = (description: string, adapterVersion = "d2-job-page-v1") =>
    verifier.verify({
      contributionId,
      normalizationId,
      proposal: {
        schemaVersion: 1,
        normalizedCompanyName: "example",
        normalizedTitle: "engineer",
        normalizedLocations: ["remote"],
        normalizedDescriptionSha256: digest(description),
        provenance: {
          provider,
          pageVariant,
          canonicalSourceUrl: sourceUrl,
          canonicalSourceUrlSha256: digest(sourceUrl),
          atsTenant: tenant,
          externalJobId,
          adapterVersion,
          contributedContentSha256: digest("synthetic-contribution"),
          observedAt: timestamp,
        },
        dedupe: { exactIdentityKeys: [], fuzzyFingerprintSha256: digest("synthetic-fingerprint") },
        proposalSha256: digest("synthetic-proposal"),
      },
    });
  return { verify, plain, page: paragraphs.join("") };
}

describe.each(providers)("%s comparator page/provider verification", (provider) => {
  it("accepts repaired and frozen historical previews without modifying complete provider truth", async () => {
    const { verify, page, plain } = setup(provider);
    for (const submitted of [page, legacyPreviewDescription(page)]) {
      const result = await verify(submitted);
      expect(result).toMatchObject({
        status: "verified",
        providerObservation: { description: plain },
      });
      expect(JSON.stringify(result)).not.toMatch(/descriptionHtml|PreviewDescriptionDigests|<p>/u);
    }
  });

  it.each([
    (text: string) => text.replace("< 5", "<= 5"),
    (text: string) => text.replace("> 2", ">= 2"),
    (text: string) => text.replace("<= 10", ">= 10"),
    (text: string) => text.replace(">= 3", "> 3"),
    (text: string) => text.replace("< 5", "< 6"),
    (text: string) => text.replace("> 2", "> 3"),
  ])("rejects changed operators or numbers", async (change) => {
    const { verify, page } = setup(provider);
    expect(await verify(change(page))).toMatchObject({ status: "mismatch" });
  });

  it("does not apply repaired page aliases to an unrecognized reader version", async () => {
    const { verify, page } = setup(provider);
    expect(await verify(page, "d2-job-page-v2")).toMatchObject({ status: "mismatch" });
  });

  it("accepts only exact repaired 12000-character truncation, including trailing-space trim", async () => {
    const prefix = `${comparisons} `;
    const text = `${prefix}${"x".repeat(11_999 - prefix.length)} tail to retain in provider truth`;
    const { verify, plain } = setup(provider, [text]);
    const trimmed = text.slice(0, 12_000).trim();
    expect(trimmed).toHaveLength(11_999);
    expect(await verify(trimmed)).toMatchObject({
      status: "verified",
      providerObservation: { description: plain },
    });
    expect(await verify(trimmed.slice(0, -1))).toMatchObject({ status: "mismatch" });
    expect(await verify(text.slice(0, 12_001))).toMatchObject({ status: "mismatch" });
  });
});

describe.each(["ashby", "lever"] as const)("%s auxiliary-HTML corroboration", (provider) => {
  it.each(["absent", "contradictory"] as const)(
    "cannot derive repaired page aliases from %s auxiliary HTML",
    async (auxiliary) => {
      const { verify, page, plain } = setup(provider, [comparisons, tail], auxiliary);
      expect(await verify(page)).toMatchObject({ status: "mismatch" });
      expect(await verify(legacyPreviewDescription(page))).toMatchObject({ status: "mismatch" });
      expect(await verify(plain)).toMatchObject({
        status: "verified",
        providerObservation: { description: plain },
      });
    },
  );
});
