import { createHash } from "node:crypto";
import type { NormalizedContributionProposal } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import type { IngestionSourceAdapter, SourceJobObservation, SourcePollResult } from "./contract.js";
import {
  type IndependentProviderVerificationRegistration,
  RegisteredIndependentProviderVerifier,
} from "./contribution-verification.js";
import { GreenhouseJobBoardAdapter } from "./greenhouse.js";
import { SourceRegistry } from "./registry.js";

const contributionId = "018f0000-0000-7000-8000-000000000001";
const normalizationId = "018f0000-0000-7000-8000-000000000002";
const ids = [
  "018f0000-0000-7000-8000-000000000003",
  "018f0000-0000-7000-8000-000000000004",
  "018f0000-0000-7000-8000-000000000005",
] as const;
const sourceUrl = "https://boards.greenhouse.io/acme/jobs/123";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function proposal(
  overrides: Partial<NormalizedContributionProposal> = {},
): NormalizedContributionProposal {
  return {
    schemaVersion: 1,
    normalizedCompanyName: "acme",
    normalizedTitle: "engineer",
    normalizedLocations: ["new york"],
    normalizedDescriptionSha256: digest("build things"),
    provenance: {
      provider: "greenhouse",
      pageVariant: "greenhouse-board-v1",
      canonicalSourceUrl: sourceUrl,
      canonicalSourceUrlSha256: digest(sourceUrl),
      atsTenant: "acme",
      externalJobId: "123",
      adapterVersion: "d2-job-page-v1",
      contributedContentSha256: digest("contribution"),
      observedAt: "2026-09-02T12:00:00.000Z",
    },
    dedupe: { exactIdentityKeys: [], fuzzyFingerprintSha256: digest("fuzzy") },
    proposalSha256: digest("proposal"),
    ...overrides,
  };
}

function harness(
  result: SourcePollResult,
  configurations?: readonly IndependentProviderVerificationRegistration[],
  identityMatches: readonly { jobId: string; sourceId: string }[] = [
    { jobId: ids[1], sourceId: ids[2] },
  ],
) {
  const poll = vi.fn(async () => result);
  const adapter: IngestionSourceAdapter = {
    sourceId: "greenhouse-acme",
    adapterVersion: "greenhouse-v1",
    poll,
  };
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
  const findExact = vi.fn(async () => identityMatches);
  const onContentMismatch = vi.fn();
  const verifier = new RegisteredIndependentProviderVerifier(
    registry,
    { findExact },
    configurations ?? [
      {
        sourceId: adapter.sourceId,
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        atsTenant: "acme",
        sourcePolicyVersion: "provider-policy-v1",
      },
    ],
    {
      clock: () => new Date("2026-09-02T12:01:00.000Z"),
      createId: () => ids[0],
      onContentMismatch,
    },
  );
  return { verifier, poll, findExact, onContentMismatch };
}

const observation = {
  companyName: "Acme",
  title: "Engineer",
  locations: ["New York"],
  description: "Build things",
  sourceUrl,
  atsTenant: "acme",
  externalJobId: "123",
  verifiedCompanyDomain: "acme.example",
};

const providerCases = [
  ["greenhouse", "greenhouse-board-v1", "boards.greenhouse.io", "acme", "123"],
  ["lever", "lever-posting-v1", "jobs.lever.co", "acme", "posting-12345"],
  ["lever", "lever-posting-v1", "jobs.eu.lever.co", "acme", "posting-12345"],
  ["ashby", "ashby-job-board-v1", "jobs.ashbyhq.com", "AcmeBoard", "Posting-12345"],
] as const;

function providerHarness(
  [provider, pageVariant, host, tenant, externalJobId]: readonly [
    (typeof providerCases)[number][0],
    (typeof providerCases)[number][1],
    string,
    string,
    string,
  ],
  fields: Partial<SourceJobObservation> = {},
  pagePreviewDescriptionDigests?: IngestionSourceAdapter["pagePreviewDescriptionDigests"],
) {
  const canonicalSourceUrl = `https://${host}/${tenant}/${provider === "greenhouse" ? "jobs/" : ""}${externalJobId}`;
  const independent = {
    ...observation,
    sourceUrl: canonicalSourceUrl,
    atsTenant: tenant,
    externalJobId,
    ...fields,
  };
  const poll = vi.fn(
    async (): Promise<SourcePollResult> => ({ kind: "success", observations: [independent] }),
  );
  const pollExact = vi.fn(
    async (): Promise<SourcePollResult> => ({ kind: "success", observations: [independent] }),
  );
  const adapter: IngestionSourceAdapter = {
    sourceId: `${provider}-synthetic`,
    adapterVersion: "synthetic-v1",
    poll,
    pollExact,
    ...(pagePreviewDescriptionDigests ? { pagePreviewDescriptionDigests } : {}),
  };
  const findExact = vi.fn(async () => []);
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
    { findExact },
    [
      {
        sourceId: adapter.sourceId,
        provider,
        pageVariant,
        atsTenant: tenant.toLowerCase(),
        sourcePolicyVersion: "synthetic-v1",
      },
    ],
    { clock: () => new Date("2026-09-02T12:01:00.000Z"), createId: () => ids[0] },
  );
  const input = proposal({
    provenance: {
      ...proposal().provenance,
      provider,
      pageVariant,
      canonicalSourceUrl,
      canonicalSourceUrlSha256: digest(canonicalSourceUrl),
      atsTenant: tenant.toLowerCase(),
      externalJobId: externalJobId.toLowerCase(),
    },
  });
  return { adapter, verifier, poll, pollExact, findExact, input, independent, externalJobId };
}

describe("RegisteredIndependentProviderVerifier", () => {
  it.each(providerCases)(
    "consumes only bounded source-object-associated v1 digests for %s on %s / %s",
    async (...providerCase) => {
      let expectedSource: SourceJobObservation | undefined;
      const selectedDigest = digest("a synthetic page representation");
      const pageDigests = vi.fn((source: SourceJobObservation) =>
        source === expectedSource ? [selectedDigest] : [],
      );
      const { verifier, input, independent, pollExact } = providerHarness(
        providerCase,
        {},
        pageDigests,
      );
      expectedSource = independent;
      const selected = { ...input, normalizedDescriptionSha256: selectedDigest };
      await expect(
        verifier.verify({ contributionId, normalizationId, proposal: selected }),
      ).resolves.toMatchObject({ status: "verified", providerObservation: independent });
      expect(pageDigests).toHaveBeenCalledWith(independent, "d2-job-page-v1");
      pollExact.mockResolvedValueOnce({ kind: "success", observations: [{ ...independent }] });
      await expect(
        verifier.verify({ contributionId, normalizationId, proposal: selected }),
      ).resolves.toMatchObject({ status: "mismatch" });
      pageDigests.mockClear();
      await expect(
        verifier.verify({
          contributionId,
          normalizationId,
          proposal: {
            ...selected,
            provenance: { ...selected.provenance, adapterVersion: "d2-job-page-v2" },
          },
        }),
      ).resolves.toMatchObject({ status: "mismatch" });
      expect(pageDigests).not.toHaveBeenCalled();
      pageDigests.mockReturnValueOnce([
        ...Array.from({ length: 11 }, (_, index) => digest(`synthetic-layout-${index}`)),
        selectedDigest,
      ]);
      await expect(
        verifier.verify({ contributionId, normalizationId, proposal: selected }),
      ).resolves.toMatchObject({ status: "verified" });
      for (const values of [
        ["not-a-digest"],
        [selectedDigest.toUpperCase()],
        Array.from({ length: 13 }, () => selectedDigest),
      ]) {
        pageDigests.mockReturnValueOnce(values);
        await expect(
          verifier.verify({ contributionId, normalizationId, proposal: selected }),
        ).resolves.toMatchObject({ status: "unavailable" });
      }
    },
  );

  it.each(providerCases)(
    "rejects unrelated independent results when %s optional identity was omitted on %s / %s",
    async (...providerCase) => {
      const { verifier, input, independent, pollExact, findExact } = providerHarness(providerCase);
      const { externalJobId: _omitted, ...provenance } = input.provenance;
      const selected = { ...input, provenance };
      for (const changed of [
        { ...independent, atsTenant: "another-tenant" },
        { ...independent, externalJobId: "different-posting" },
        {
          ...independent,
          sourceUrl: independent.sourceUrl.replace(
            providerCase[2],
            `${providerCase[2]}.example.test`,
          ),
        },
      ]) {
        pollExact.mockResolvedValueOnce({ kind: "success", observations: [changed] });
        await expect(
          verifier.verify({ contributionId, normalizationId, proposal: selected }),
        ).resolves.toMatchObject({ status: "unavailable" });
      }
      expect(findExact).not.toHaveBeenCalled();
    },
  );

  it.each(providerCases)(
    "derives an omitted optional posting identity from the exact %s URL on %s / %s",
    async (...providerCase) => {
      const { verifier, poll, pollExact, findExact, input, independent, externalJobId } =
        providerHarness(providerCase);
      const { externalJobId: _omitted, ...provenance } = input.provenance;
      const unchanged = Object.freeze({ ...input, provenance: Object.freeze(provenance) });
      const before = JSON.stringify(unchanged);
      await expect(
        verifier.verify({ contributionId, normalizationId, proposal: unchanged }),
      ).resolves.toMatchObject({
        status: "verified",
        providerObservation: independent,
      });
      expect(pollExact).toHaveBeenCalledWith(expect.objectContaining({ externalJobId }));
      expect(poll).not.toHaveBeenCalled();
      expect(findExact).toHaveBeenCalledWith({
        provider: providerCase[0],
        atsTenant: providerCase[3].toLowerCase(),
        externalJobId: externalJobId.toLowerCase(),
        canonicalSourceUrl: input.provenance.canonicalSourceUrl,
      });
      expect(JSON.stringify(unchanged)).toBe(before);
      expect(unchanged.provenance).not.toHaveProperty("externalJobId");
    },
  );

  it.each(providerCases)(
    "denies wrong URL/tenant/digest/explicit identity before polling %s on %s / %s",
    async (...providerCase) => {
      const { verifier, poll, pollExact, input } = providerHarness(providerCase);
      const original = input.provenance;
      const paths = [
        original.canonicalSourceUrl.replace("https:", "http:"),
        original.canonicalSourceUrl.replace("https://", "https://secret@"),
        original.canonicalSourceUrl.replace(providerCase[2], `${providerCase[2]}:444`),
        original.canonicalSourceUrl.replace(providerCase[2], `${providerCase[2]}.example.test`),
        original.canonicalSourceUrl.replace(`/${providerCase[3]}/`, "/another-tenant/"),
        original.canonicalSourceUrl.replace(`/${providerCase[3]}/`, `/${providerCase[3]}//`),
        `${original.canonicalSourceUrl}/application`,
        `${original.canonicalSourceUrl}/`,
        `${original.canonicalSourceUrl}?tracking=1`,
        `${original.canonicalSourceUrl}#application`,
        original.canonicalSourceUrl.replace(providerCase[4], "%2e%2e"),
      ];
      const changes = [
        ...paths.map((canonicalSourceUrl) => ({
          canonicalSourceUrl,
          canonicalSourceUrlSha256: digest(canonicalSourceUrl),
        })),
        { atsTenant: "another-tenant" },
        { externalJobId: "different-posting" },
        { externalJobId: "" },
        { canonicalSourceUrlSha256: "f".repeat(64) },
        {
          pageVariant:
            providerCase[0] === "lever"
              ? ("ashby-job-board-v1" as const)
              : ("lever-posting-v1" as const),
        },
      ];
      for (const change of changes) {
        await expect(
          verifier.verify({
            contributionId,
            normalizationId,
            proposal: {
              ...input,
              provenance: { ...original, ...change },
            },
          }),
        ).resolves.toMatchObject({ status: "unavailable" });
      }
      expect(pollExact).not.toHaveBeenCalled();
      expect(poll).not.toHaveBeenCalled();
    },
  );

  it.each(providerCases)(
    "accepts only exact legacy singleton location projections for %s on %s / %s",
    async (...providerCase) => {
      const fields = {
        locations: ["Remote-NORAM", "South City"],
        structuredLocations: [
          {
            address: {
              addressLocality: "North City",
              addressRegion: "North Region",
              addressCountry: "EX",
            },
          },
        ],
        workMode: "remote" as const,
      };
      const { verifier, input, independent } = providerHarness(providerCase, fields);
      for (const location of [
        "remote-noram",
        "noram",
        "south city",
        "north city, north region, ex",
      ]) {
        const selected = Object.freeze({
          ...input,
          normalizedLocations: Object.freeze([location]),
          workMode: "remote" as const,
        });
        const before = JSON.stringify(selected);
        await expect(
          verifier.verify({ contributionId, normalizationId, proposal: selected }),
        ).resolves.toMatchObject({ status: "verified", providerObservation: independent });
        expect(JSON.stringify(selected)).toBe(before);
      }
      for (const normalizedLocations of [
        ["unknown city"],
        ["north city"],
        ["north city, north region"],
        ["north city, north region, exx"],
        ["noram", "unknown city"],
        ["noram", "remote-noram"],
      ]) {
        await expect(
          verifier.verify({
            contributionId,
            normalizationId,
            proposal: {
              ...input,
              normalizedLocations,
            },
          }),
        ).resolves.toMatchObject({ status: "mismatch" });
      }
      await expect(
        verifier.verify({
          contributionId,
          normalizationId,
          proposal: {
            ...input,
            normalizedLocations: ["south city"],
            workMode: "hybrid",
          },
        }),
      ).resolves.toMatchObject({ status: "mismatch" });
      await expect(
        verifier.verify({
          contributionId,
          normalizationId,
          proposal: {
            ...input,
            normalizedLocations: ["south city"],
            provenance: { ...input.provenance, adapterVersion: "d2-job-page-v2" },
          },
        }),
      ).resolves.toMatchObject({ status: "mismatch" });
    },
  );

  it.each(providerCases)(
    "allows omitted optional preview fields without discarding %s independent truth on %s / %s",
    async (...providerCase) => {
      const { verifier, input, independent } = providerHarness(providerCase);
      const {
        normalizedCompanyName: _company,
        normalizedDescriptionSha256: _description,
        ...required
      } = input;
      const { externalJobId: _externalJobId, ...provenance } = required.provenance;
      const selected = Object.freeze({
        ...required,
        normalizedLocations: Object.freeze([]),
        provenance: Object.freeze(provenance),
      });
      const before = JSON.stringify(selected);
      await expect(
        verifier.verify({ contributionId, normalizationId, proposal: selected }),
      ).resolves.toMatchObject({ status: "verified", providerObservation: independent });
      expect(JSON.stringify(selected)).toBe(before);
    },
  );

  it.each(["acme logo", "acme company logo"])(
    "recognizes only the exact provider name plus legacy logo-label suffix",
    async (company) => {
      const { verifier } = harness({ kind: "success", observations: [observation] });
      await expect(
        verifier.verify({
          contributionId,
          normalizationId,
          proposal: proposal({ normalizedCompanyName: company }),
        }),
      ).resolves.toMatchObject({
        status: "verified",
        providerObservation: { companyName: "Acme" },
      });
      await expect(
        verifier.verify({
          contributionId,
          normalizationId,
          proposal: proposal({ normalizedCompanyName: "other company logo" }),
        }),
      ).resolves.toMatchObject({ status: "mismatch" });
    },
  );

  it("recognizes the exact 12000-character v1 capture boundary, never an arbitrary or edited excerpt", async () => {
    const description = "a".repeat(12_050);
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, description }],
    });
    const input = {
      contributionId,
      normalizationId,
      proposal: proposal({ normalizedDescriptionSha256: digest("a".repeat(12_000)) }),
    };
    await expect(verifier.verify(input)).resolves.toMatchObject({
      status: "verified",
      providerObservation: { description },
    });
    for (const excerpt of ["a".repeat(11_999), `b${"a".repeat(11_999)}`]) {
      await expect(
        verifier.verify({
          ...input,
          proposal: proposal({ normalizedDescriptionSha256: digest(excerpt) }),
        }),
      ).resolves.toMatchObject({ status: "mismatch" });
    }
  });

  it("recognizes the exact repeated leading heading removed by the v1 preview while preserving provider text", async () => {
    const description = "About Acme\nAbout Acme Build things";
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, description }],
    });
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedDescriptionSha256: digest("about acme build things") }),
      }),
    ).resolves.toMatchObject({ status: "verified", providerObservation: { description } });
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedDescriptionSha256: digest("build things") }),
      }),
    ).resolves.toMatchObject({ status: "mismatch" });
  });

  it("does not extend frozen preview compatibility to another adapter version", async () => {
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, description: "a".repeat(12_050) }],
    });
    const original = proposal();
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({
          normalizedCompanyName: "acme logo",
          normalizedDescriptionSha256: digest("a".repeat(12_000)),
          provenance: { ...original.provenance, adapterVersion: "d2-job-page-v2" },
        }),
      }),
    ).resolves.toMatchObject({ status: "mismatch" });
  });

  it("retains repaired long repeated-heading previews without changing independent plaintext", async () => {
    const heading = "About Acme";
    const deduplicated = `${heading} Require < 5 and > 2 years. ${"z".repeat(12_050)}`;
    const description = `${heading}\n${deduplicated}`;
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, description }],
    });
    const preview = deduplicated.slice(0, 12_000).trim().toLowerCase();
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedDescriptionSha256: digest(preview) }),
      }),
    ).resolves.toMatchObject({ status: "verified", providerObservation: { description } });
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedDescriptionSha256: digest(preview.replace("< 5", "<= 5")) }),
      }),
    ).resolves.toMatchObject({ status: "mismatch" });
  });

  it("mirrors v1 control removal before truncation without modifying independent evidence", async () => {
    const description = "Build\u200bthings <literal> safely";
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, description }],
    });
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedDescriptionSha256: digest("build things safely") }),
      }),
    ).resolves.toMatchObject({ status: "verified", providerObservation: { description } });
  });

  it("verifies the complete selected preview against encoded exact-job provider truth", async () => {
    const adapter = new GreenhouseJobBoardAdapter({
      sourceId: "greenhouse-acme",
      boardToken: "acme",
      companyName: "Configured fallback",
      verifiedCompanyDomain: "acme.example",
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 123,
            company_name: "Acme",
            title: "Engineer",
            absolute_url: sourceUrl,
            location: { name: "Remote-NORAM" },
            content: "&lt;p&gt;Build things&lt;/p&gt;",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const response = await adapter.pollExact({
      externalJobId: "123",
      observedAt: new Date("2026-09-02T12:01:00.000Z"),
      signal: new AbortController().signal,
      attempt: 1,
    });
    const { verifier, onContentMismatch } = harness(response);
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedLocations: ["noram"], workMode: "remote" }),
      }),
    ).resolves.toMatchObject({
      status: "verified",
      providerObservation: {
        companyName: "Acme",
        description: "Build things",
        locations: ["Remote-NORAM"],
      },
    });
    expect(onContentMismatch).not.toHaveBeenCalled();
  });
  it("emits only eight fixed mismatch counts and never changes disposition on diagnostic failure", async () => {
    const { verifier, onContentMismatch } = harness({
      kind: "success",
      observations: [{ ...observation, title: "Another title", companyName: "Other company" }],
    });
    const input = { contributionId, normalizationId, proposal: proposal() };
    await expect(verifier.verify(input)).resolves.toMatchObject({ status: "mismatch" });
    expect(onContentMismatch).toHaveBeenCalledWith({
      VerificationMismatchTitle: 1,
      VerificationMismatchCompany: 1,
      VerificationMismatchLocation: 0,
      VerificationMismatchDescription: 0,
      VerificationMismatchDepartment: 0,
      VerificationMismatchApplicationUrl: 0,
      VerificationMismatchEmploymentType: 0,
      VerificationMismatchWorkMode: 0,
    });
    onContentMismatch.mockImplementation(() => {
      throw new Error("SYNTHETIC_DIAGNOSTIC_FAILURE");
    });
    await expect(verifier.verify(input)).resolves.toMatchObject({ status: "mismatch" });
    const successful = harness({ kind: "success", observations: [observation] });
    await expect(successful.verifier.verify(input)).resolves.toMatchObject({ status: "verified" });
    expect(successful.onContentMismatch).not.toHaveBeenCalled();
  });
  it("is default-dark and never polls without explicit registration", async () => {
    const { verifier, poll } = harness({ kind: "success", observations: [observation] }, []);
    await expect(
      verifier.verify({ contributionId, normalizationId, proposal: proposal() }),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(poll).not.toHaveBeenCalled();
  });

  it("verifies exact independently fetched identity/content with a bounded provider projection", async () => {
    const { verifier, poll, findExact } = harness({ kind: "success", observations: [observation] });
    const result = await verifier.verify({ contributionId, normalizationId, proposal: proposal() });
    expect(result).toMatchObject({
      status: "verified",
      origin: "independent_provider_fetch",
      sourcePolicyVersion: "provider-policy-v1",
      canonicalSourceUrlSha256: digest(sourceUrl),
    });
    expect(poll).toHaveBeenCalledOnce();
    expect(findExact).toHaveBeenCalledWith({
      provider: "greenhouse",
      atsTenant: "acme",
      externalJobId: "123",
      canonicalSourceUrl: sourceUrl,
    });
    expect(result).toMatchObject({ jobId: ids[1], sourceId: ids[2], verificationId: ids[0] });
    expect(result).toMatchObject({ providerObservation: { companyName: "Acme", sourceUrl } });
    expect(result).not.toHaveProperty("providerObservation.rawSnapshot");
  });

  it("prefers an adapter's exact-job fetch for independent verification", async () => {
    const poll = vi.fn(
      async (): Promise<SourcePollResult> => ({
        kind: "retry",
        reason: "source_unavailable",
      }),
    );
    const pollExact = vi.fn(
      async (): Promise<SourcePollResult> => ({
        kind: "success",
        observations: [observation],
      }),
    );
    const adapter: IngestionSourceAdapter = {
      sourceId: "greenhouse-acme",
      adapterVersion: "greenhouse-v1",
      poll,
      pollExact,
    };
    const verifier = new RegisteredIndependentProviderVerifier(
      new SourceRegistry(
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
      ),
      { findExact: async () => [] },
      [
        {
          sourceId: adapter.sourceId,
          provider: "greenhouse",
          pageVariant: "greenhouse-board-v1",
          atsTenant: "acme",
          sourcePolicyVersion: "provider-policy-v1",
        },
      ],
      { clock: () => new Date("2026-09-02T12:01:00.000Z"), createId: () => ids[0] },
    );

    await expect(
      verifier.verify({ contributionId, normalizationId, proposal: proposal() }),
    ).resolves.toMatchObject({ status: "verified" });
    expect(pollExact).toHaveBeenCalledWith(
      expect.objectContaining({ externalJobId: "123", attempt: 1 }),
    );
    expect(poll).not.toHaveBeenCalled();
  });

  it("verifies a preview that omits the optional location without discarding provider truth", async () => {
    const { verifier } = harness({ kind: "success", observations: [observation] });
    const result = await verifier.verify({
      contributionId,
      normalizationId,
      proposal: proposal({ normalizedLocations: [] }),
    });
    expect(result).toMatchObject({
      status: "verified",
      providerObservation: { locations: ["New York"] },
    });
  });

  it.each(["Remote-NORAM", "Remote — NORAM", "remote | NORAM"])(
    "matches the exact preview location/work-type split for %s",
    async (location) => {
      const { verifier } = harness({
        kind: "success",
        observations: [{ ...observation, locations: [location] }],
      });
      const result = await verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal({ normalizedLocations: ["noram"], workMode: "remote" }),
      });
      expect(result).toMatchObject({
        status: "verified",
        providerObservation: { locations: [location] },
      });
    },
  );

  it.each([
    { normalizedLocations: ["emea"], workMode: "remote" as const },
    { normalizedLocations: ["noram"], workMode: "hybrid" as const },
  ])("does not hide a conflicting selected location or work type", async (override) => {
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, locations: ["Remote-NORAM"] }],
    });
    await expect(
      verifier.verify({ contributionId, normalizationId, proposal: proposal(override) }),
    ).resolves.toMatchObject({ status: "mismatch" });
  });

  it("returns mismatch, closed, and unavailable without treating contribution as truth", async () => {
    await expect(
      harness({
        kind: "success",
        observations: [{ ...observation, title: "Other" }],
      }).verifier.verify({ contributionId, normalizationId, proposal: proposal() }),
    ).resolves.toMatchObject({ status: "mismatch" });
    await expect(
      harness({ kind: "retry", reason: "source_unavailable" }).verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal(),
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it.each([
    { locations: ["Remote-NORAM", "Hybrid-EMEA"] },
    { locations: ["Remote-NORAM", "EMEA"] },
    { locations: ["Remote-NORAM"], workMode: "hybrid" as const },
  ])(
    "does not infer agreement from ambiguous or conflicting provider work modes",
    async (fields) => {
      const { verifier } = harness({
        kind: "success",
        observations: [{ ...observation, ...fields }],
      });
      await expect(
        verifier.verify({
          contributionId,
          normalizationId,
          proposal: proposal({ normalizedLocations: [], workMode: "remote" }),
        }),
      ).resolves.toMatchObject({ status: "mismatch" });
    },
  );

  it("reports closed only for an exact provider withdrawal", async () => {
    const ashbyUrl = "https://jobs.ashbyhq.com/acme/abcdefgh";
    const poll = vi.fn(
      async (): Promise<SourcePollResult> => ({
        kind: "success",
        observations: [],
        withdrawals: [{ sourceUrl: ashbyUrl, atsTenant: "acme", externalJobId: "abcdefgh" }],
      }),
    );
    const adapter: IngestionSourceAdapter = {
      sourceId: "ashby-acme",
      adapterVersion: "ashby-v1",
      poll,
    };
    const registry = new SourceRegistry(
      [
        {
          sourceId: adapter.sourceId,
          provider: "ashby",
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
          provider: "ashby",
          pageVariant: "ashby-job-board-v1",
          atsTenant: "acme",
          sourcePolicyVersion: "provider-policy-v1",
        },
      ],
      { clock: () => new Date("2026-09-02T12:01:00.000Z") },
    );
    const ashby = proposal({
      provenance: {
        ...proposal().provenance,
        provider: "ashby",
        pageVariant: "ashby-job-board-v1",
        canonicalSourceUrl: ashbyUrl,
        canonicalSourceUrlSha256: digest(ashbyUrl),
        externalJobId: "abcdefgh",
      },
    });
    await expect(
      verifier.verify({ contributionId, normalizationId, proposal: ashby }),
    ).resolves.toMatchObject({ status: "closed" });
  });

  it.each([
    [
      "variant",
      { provenance: { ...proposal().provenance, pageVariant: "lever-posting-v1" as const } },
    ],
    ["tenant", { provenance: { ...proposal().provenance, atsTenant: "other" } }],
    ["external ID", { provenance: { ...proposal().provenance, externalJobId: "999" } }],
    [
      "canonical URL",
      {
        provenance: {
          ...proposal().provenance,
          canonicalSourceUrl: "https://boards.greenhouse.io/acme/jobs/999",
          canonicalSourceUrlSha256: digest("https://boards.greenhouse.io/acme/jobs/999"),
        },
      },
    ],
  ])("fails closed for unsupported %s", async (_label, override) => {
    const { verifier } = harness({ kind: "success", observations: [observation] });
    await expect(
      verifier.verify({
        contributionId,
        normalizationId,
        proposal: proposal(override as Partial<NormalizedContributionProposal>),
      }),
    ).resolves.not.toMatchObject({ status: "verified" });
  });

  it("maps malformed independently fetched data to unavailable", async () => {
    const { verifier } = harness({
      kind: "success",
      observations: [{ ...observation, sourceUrl: "http://invalid.test" }],
    });
    await expect(
      verifier.verify({ contributionId, normalizationId, proposal: proposal() }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });

  it("permits independently verified provider truth before a catalog identity exists", async () => {
    const { verifier } = harness({ kind: "success", observations: [observation] }, undefined, []);
    const result = await verifier.verify({ contributionId, normalizationId, proposal: proposal() });
    expect(result).toMatchObject({ status: "verified", verificationId: ids[0] });
    expect(result).not.toHaveProperty("jobId");
    expect(result).not.toHaveProperty("sourceId");
  });

  it("denies ambiguous catalog identities", async () => {
    const matches = [
      { jobId: ids[1], sourceId: ids[2] },
      { jobId: ids[2], sourceId: ids[1] },
    ];
    const { verifier } = harness(
      { kind: "success", observations: [observation] },
      undefined,
      matches,
    );
    await expect(
      verifier.verify({ contributionId, normalizationId, proposal: proposal() }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });
});
