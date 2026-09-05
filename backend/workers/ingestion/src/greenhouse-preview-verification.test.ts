import { createHash } from "node:crypto";
import { type NormalizedContributionProposal, normalizeText } from "@ai-job-apply/jobs-service";
import { describe, expect, it } from "vitest";
import { RegisteredIndependentProviderVerifier } from "./contribution-verification.js";
import { GreenhouseJobBoardAdapter } from "./greenhouse.js";
import { SourceRegistry } from "./registry.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceUrl = "https://job-boards.greenhouse.io/synthetic_preview/jobs/123";
const contributionId = "018f0000-0000-7000-8000-000000000001";
const normalizationId = "018f0000-0000-7000-8000-000000000002";
const verificationId = "018f0000-0000-7000-8000-000000000003";
const timestamp = "2026-09-05T12:00:00.000Z";
const providerHtml =
  "<h2>About Example</h2><p>Build <strong>reliable</strong> systems.</p>" +
  "<p>Deploy carefully — together.</p><ul><li>Support 12 regions.</li></ul>" +
  "<p>Compensation $123,400&mdash;$145,600 USD</p>";
// Generated paired page/API fixture. DOM textContent does not insert block separators;
// Greenhouse's displayed currency-range dash is a spaced hyphen in this v1 presentation.
const pageText =
  "About ExampleBuild reliable systems.Deploy carefully — together.Support 12 regions.Compensation $123,400 - $145,600 USD";

function setup(html = providerHtml) {
  const adapter = new GreenhouseJobBoardAdapter({
    sourceId: "greenhouse-synthetic-preview",
    boardToken: "synthetic_preview",
    companyName: "Example",
    verifiedCompanyDomain: "synthetic.example.test",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: 123,
          title: "Engineer",
          company_name: "Example",
          absolute_url: sourceUrl,
          location: { name: "Remote" },
          content: html,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const registry = new SourceRegistry(
    [
      {
        sourceId: adapter.sourceId,
        provider: "greenhouse",
        provenance: "permitted_api",
        adapter,
        enabled: true,
      },
    ],
    () => true,
    { providerActivationAllowed: true },
  );
  const verifier = new RegisteredIndependentProviderVerifier(
    registry,
    { findExact: async () => [] },
    [
      {
        sourceId: adapter.sourceId,
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        atsTenant: "synthetic_preview",
        sourcePolicyVersion: "synthetic-policy-v1",
      },
    ],
    { clock: () => new Date(timestamp), createId: () => verificationId },
  );
  function verify(description: string, adapterVersion = "d2-job-page-v1") {
    const proposal: NormalizedContributionProposal = {
      schemaVersion: 1,
      normalizedCompanyName: "example",
      normalizedTitle: "engineer",
      normalizedLocations: ["remote"],
      normalizedDescriptionSha256: sha256(normalizeText(description)),
      provenance: {
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        canonicalSourceUrl: sourceUrl,
        canonicalSourceUrlSha256: sha256(sourceUrl),
        atsTenant: "synthetic_preview",
        externalJobId: "123",
        adapterVersion,
        contributedContentSha256: sha256("synthetic-contribution"),
        observedAt: timestamp,
      },
      dedupe: { exactIdentityKeys: [], fuzzyFingerprintSha256: sha256("synthetic-fingerprint") },
      proposalSha256: sha256("synthetic-proposal"),
    };
    return verifier.verify({ contributionId, normalizationId, proposal });
  }
  return { adapter, verify };
}

describe("paired Greenhouse page/provider description verification", () => {
  it.each([
    providerHtml,
    providerHtml.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  ])("recognizes exact page text while preserving readable full provider truth", async (html) => {
    const result = await setup(html).verify(pageText);
    expect(result).toMatchObject({
      status: "verified",
      providerObservation: {
        description:
          "About Example\nBuild reliable systems.\nDeploy carefully — together.\nSupport 12 regions.\nCompensation $123,400—$145,600 USD",
      },
    });
    expect(JSON.stringify(result)).not.toContain("pagePreviewDescriptionDigests");
    expect(JSON.stringify(result)).not.toContain("<h2>");
  });

  it.each([
    pageText.replace("reliable", "unreliable"),
    pageText.replace("12", "21"),
    pageText.replace("$123,400", "$123,401"),
    pageText.replace(" — ", " - "),
    pageText.replace(" - ", ""),
    pageText.replace(" - ", " / "),
    pageText.slice(0, -1),
  ])(
    "rejects changed words, numbers, other punctuation and arbitrary excerpts",
    async (changed) => {
      expect(await setup().verify(changed)).toMatchObject({ status: "mismatch" });
    },
  );

  it("does not apply this compatibility to another page-reader version", async () => {
    expect(await setup().verify(pageText, "d2-job-page-v2")).toMatchObject({ status: "mismatch" });
  });

  it("uses the exact v1 capture limit after page conversion, not arbitrary truncation", async () => {
    const text = "Build carefully. ".repeat(900);
    const fullPage = text.replace(/\s+/gu, " ").trim();
    const { verify } = setup(`<p>${text}</p>`);
    expect(await verify(fullPage.slice(0, 12_000))).toMatchObject({ status: "verified" });
    expect(await verify(fullPage.slice(0, 11_999))).toMatchObject({ status: "mismatch" });
  });

  it("removes only the exact repeated first heading like the v1 page reader", async () => {
    const { verify } = setup("<h2>About Example</h2><p>About Example Build things.</p>");
    expect(await verify("About Example Build things.")).toMatchObject({ status: "verified" });
    expect(await verify("Build things.")).toMatchObject({ status: "mismatch" });
  });

  it("binds ephemeral digests to the exact fetched observation object and reader version", async () => {
    const { adapter } = setup();
    const response = await adapter.pollExact({
      externalJobId: "123",
      observedAt: new Date(timestamp),
      signal: new AbortController().signal,
      attempt: 1,
    });
    if (response.kind !== "success" || !response.observations[0])
      throw new Error("Missing synthetic observation");
    const observation = response.observations[0];
    expect(adapter.pagePreviewDescriptionDigests(observation, "d2-job-page-v1")).toContain(
      sha256(normalizeText(pageText)),
    );
    expect(adapter.pagePreviewDescriptionDigests({ ...observation }, "d2-job-page-v1")).toEqual([]);
    expect(adapter.pagePreviewDescriptionDigests(observation, "d2-job-page-v2")).toEqual([]);
    expect(JSON.stringify(response)).not.toContain("Digests");
  });

  it("never accepts script/form text as an independent description representation", async () => {
    const { verify } = setup(
      "<p>Build things.</p><script>SYNTHETIC_PRIVATE</script><form>SYNTHETIC_PRIVATE</form>",
    );
    expect(await verify("Build things.")).toMatchObject({ status: "verified" });
    expect(await verify("Build things.SYNTHETIC_PRIVATESYNTHETIC_PRIVATE")).toMatchObject({
      status: "mismatch",
    });
  });
});
