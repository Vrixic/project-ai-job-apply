import { createHash } from "node:crypto";
import type { NormalizedContributionProposal } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import { RegisteredIndependentProviderVerifier } from "./contribution-verification.js";
import { LeverPostingsAdapter } from "./lever.js";
import { SourceRegistry } from "./registry.js";

const context = () => ({
  observedAt: new Date("2026-08-23T00:00:00.000Z"),
  signal: new AbortController().signal,
  attempt: 1,
});

function posting(overrides: Record<string, unknown> = {}) {
  return {
    id: "5ac21346-8e0c-4494-8e7a-3eb92ff77902",
    text: "Platform Engineer",
    categories: {
      location: "Remote",
      allLocations: ["Remote", "New York, NY"],
      department: "Engineering",
    },
    descriptionPlain: "Build and maintain systems.",
    hostedUrl:
      "https://jobs.lever.co/reviewed-site/5ac21346-8e0c-4494-8e7a-3eb92ff77902?lever-source=tracking",
    workplaceType: "remote",
    ...overrides,
  };
}

function adapter(fetch: typeof globalThis.fetch, region: "global" | "eu" = "global") {
  return new LeverPostingsAdapter({
    sourceId: "lever-reviewed-site",
    site: "reviewed-site",
    companyName: "Reviewed Company",
    verifiedCompanyDomain: "company.example",
    region,
    fetch,
  });
}

const postingId = "5ac21346-8e0c-4494-8e7a-3eb92ff77902";
const exactContext = () => ({ ...context(), externalJobId: postingId });
const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const previewDigest = (value: string) =>
  createHash("sha256")
    .update(value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase())
    .digest("hex");

function fullPosting(overrides: Record<string, unknown> = {}) {
  return posting({
    descriptionPlain: "Build & maintain systems.\nOwn services.",
    description: "<p>Build &amp; maintain systems.</p><p>Own <b>services</b>.</p>",
    openingPlain: "Do not duplicate the opening.",
    descriptionBodyPlain: "Do not duplicate the body.",
    lists: [
      { text: "Requirements", content: "<li>Ship truthful work.</li><li>Protect privacy.</li>" },
    ],
    salaryDescriptionPlain: "$100,000—$120,000 annually.",
    salaryDescription: "<p>$100,000—$120,000 annually.</p>",
    additionalPlain: "Everyone welcome.",
    additional: "<p>Everyone welcome.</p>",
    ...overrides,
  });
}

describe("LeverPostingsAdapter", () => {
  it.each(["global", "eu"] as const)(
    "fetches only the exact %s posting without a board request",
    async (region) => {
      const jobsHost = region === "eu" ? "jobs.eu.lever.co" : "jobs.lever.co";
      const apiHost = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse(
          posting({
            hostedUrl: `https://${jobsHost}/reviewed-site/${postingId}?tracking=value`,
          }),
        ),
      );
      await expect(adapter(fetch, region).pollExact(exactContext())).resolves.toMatchObject({
        kind: "success",
        observations: [
          { externalJobId: postingId, sourceUrl: `https://${jobsHost}/reviewed-site/${postingId}` },
        ],
        withdrawals: [],
      });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `https://${apiHost}/v0/postings/reviewed-site/${postingId}`,
        expect.objectContaining({
          method: "GET",
          redirect: "error",
          headers: { accept: "application/json" },
        }),
      );
    },
  );

  it("retains every description section without duplicating opening or body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(fullPosting()));
    const selected = adapter(fetch);
    const result = await selected.pollExact(exactContext());
    if (result.kind !== "success" || !result.observations[0])
      throw new Error("Expected observation");
    const observation = result.observations[0];
    expect(observation.description).toBe(
      "Build & maintain systems.\nOwn services.\n\nRequirements\nShip truthful work.\nProtect privacy.\n\n$100,000—$120,000 annually.\n\nEveryone welcome.",
    );
    expect(observation.description).not.toContain("Do not duplicate");
    const expectedChunks = [
      "Build & maintain systems.Own services.",
      "Requirements",
      "Ship truthful work.Protect privacy.",
      "$100,000—$120,000 annually.",
      "Everyone welcome.",
    ];
    const digests = selected.pagePreviewDescriptionDigests(observation, "d2-job-page-v1");
    expect(digests).toEqual(
      expect.arrayContaining([
        previewDigest(expectedChunks.join("")),
        previewDigest(expectedChunks.join("\n")),
      ]),
    );
    expect(digests.length).toBeLessThanOrEqual(4);
    expect(Object.isFrozen(digests)).toBe(true);
    expect(digests).not.toContain(
      previewDigest(expectedChunks.join("\n").replace("$100,000—$120,000", "$100,000 - $120,000")),
    );
    expect(digests).not.toContain(previewDigest(expectedChunks.slice(0, -1).join("\n")));
    expect(selected.pagePreviewDescriptionDigests({ ...observation }, "d2-job-page-v1")).toEqual(
      [],
    );
    expect(selected.pagePreviewDescriptionDigests(observation, "d2-job-page-v2")).toEqual([]);
    expect(adapter(fetch).pagePreviewDescriptionDigests(observation, "d2-job-page-v1")).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("<p>");
  });

  it("uses the same complete description for ingestion without issuing page compatibility", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse([fullPosting()]));
    const selected = adapter(fetch);
    const result = await selected.poll(context());
    if (result.kind !== "success" || !result.observations[0])
      throw new Error("Expected observation");
    expect(result.observations[0].description).toContain(
      "Requirements\nShip truthful work.\nProtect privacy.",
    );
    expect(result.observations[0].description).toContain("Everyone welcome.");
    expect(
      selected.pagePreviewDescriptionDigests(result.observations[0], "d2-job-page-v1"),
    ).toEqual([]);
  });

  it("converts list HTML inertly without collecting form values or executing resources", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse(
        fullPosting({
          lists: [
            {
              text: "Requirements",
              content:
                '<li>Build <b>truthful</b> tools &amp; systems.</li><script>SYNTHETIC_SECRET</script><form>SYNTHETIC_SECRET<input value="SYNTHETIC_SECRET"></form><iframe src="https://evil.example">SYNTHETIC_SECRET</iframe>',
            },
          ],
        }),
      ),
    );
    const result = await adapter(fetch).pollExact(exactContext());
    expect(result).toMatchObject({
      kind: "success",
      observations: [{ description: expect.stringContaining("Build truthful tools & systems.") }],
    });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { description: undefined },
    { description: [] },
    { description: "<p>Changed words.</p>" },
    { description: "<p>build &amp; maintain systems.</p><p>Own services.</p>" },
    { salaryDescription: "<p>$100,000—$130,000 annually.</p>" },
    { additional: undefined },
    { additional: "<p>Not everyone welcome.</p>" },
  ])(
    "suppresses page compatibility when auxiliary HTML is absent or contradictory: %j",
    async (override) => {
      const selected = adapter(
        vi.fn<typeof globalThis.fetch>(async () => jsonResponse(fullPosting(override))),
      );
      const result = await selected.pollExact(exactContext());
      if (result.kind !== "success" || !result.observations[0])
        throw new Error("Expected observation");
      expect(result.observations[0].description).toContain("$100,000—$120,000 annually.");
      expect(result.observations[0].description).toContain("Everyone welcome.");
      expect(
        selected.pagePreviewDescriptionDigests(result.observations[0], "d2-job-page-v1"),
      ).toEqual([]);
    },
  );

  it("accepts optional absent/empty sections and a nonempty lists-only description", async () => {
    const selected = adapter(
      vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse(
          posting({
            descriptionPlain: "",
            lists: [{ text: "Requirements", content: "<li>Truthful work.</li>" }],
            salaryDescriptionPlain: null,
            additionalPlain: "",
          }),
        ),
      ),
    );
    const result = await selected.pollExact(exactContext());
    expect(result).toMatchObject({
      kind: "success",
      observations: [{ description: "Requirements\nTruthful work." }],
    });
  });

  it.each(
    ["descriptionPlain", "salaryDescriptionPlain", "additionalPlain"].flatMap((field) =>
      [undefined, null, "", " \n\t "].map((value, index) => ({
        field,
        value,
        label: `${field}-${index}`,
      })),
    ),
  )("preserves a complete HTML-only provider section: $label", async ({ field, value }) => {
    const selected = adapter(
      vi.fn<typeof globalThis.fetch>(async () => jsonResponse(fullPosting({ [field]: value }))),
    );
    const result = await selected.pollExact(exactContext());
    if (result.kind !== "success" || !result.observations[0])
      throw new Error("Expected observation");
    const observation = result.observations[0];
    expect(observation.description).toBe(
      "Build & maintain systems.\nOwn services.\n\nRequirements\nShip truthful work.\nProtect privacy.\n\n$100,000—$120,000 annually.\n\nEveryone welcome.",
    );
    const digests = selected.pagePreviewDescriptionDigests(observation, "d2-job-page-v1");
    expect(digests).toContain(
      previewDigest(
        "Build & maintain systems.Own services.RequirementsShip truthful work.Protect privacy.$100,000—$120,000 annually.Everyone welcome.",
      ),
    );
    expect(selected.pagePreviewDescriptionDigests({ ...observation }, "d2-job-page-v1")).toEqual(
      [],
    );
    expect(JSON.stringify(result)).not.toContain("<p>");
  });

  it.each(
    [undefined, null, "", " \n\t "].flatMap((plain, plainIndex) =>
      [undefined, null, "", " \n\t "].map((html, htmlIndex) => ({
        plain,
        html,
        label: `${plainIndex}-${htmlIndex}`,
      })),
    ),
  )("omits genuinely absent or empty optional representations: $label", async ({ plain, html }) => {
    const selected = adapter(
      vi.fn<typeof globalThis.fetch>(async () =>
        jsonResponse(
          posting({
            description: "<p>Build and maintain systems.</p>",
            salaryDescriptionPlain: plain,
            salaryDescription: html,
            additionalPlain: plain,
            additional: html,
          }),
        ),
      ),
    );
    await expect(selected.pollExact(exactContext())).resolves.toMatchObject({
      kind: "success",
      observations: [{ description: "Build and maintain systems." }],
    });
  });

  it.each(
    [
      ["descriptionPlain", "description"],
      ["salaryDescriptionPlain", "salaryDescription"],
      ["additionalPlain", "additional"],
    ].flatMap(([plainField, htmlField]) =>
      [
        { label: "object", html: {} },
        { label: "array", html: [] },
        { label: "script-only", html: "<script>untrusted()</script>" },
        { label: "form-only", html: "<form><input value=secret>private</form>" },
        { label: "oversize", html: "x".repeat(100_001) },
        { label: "oversize-empty", html: " ".repeat(100_001) },
      ].map(({ label, html }) => ({
        plainField: plainField as string,
        htmlField: htmlField as string,
        label: `${plainField}-${label}`,
        html,
      })),
    ),
  )(
    "rejects malformed or excessive HTML fallback instead of dropping it: $label",
    async ({ plainField, htmlField, html }) => {
      const selected = adapter(
        vi.fn<typeof globalThis.fetch>(async () =>
          jsonResponse(fullPosting({ [plainField]: undefined, [htmlField]: html })),
        ),
      );
      await expect(selected.pollExact(exactContext())).rejects.toThrow();
    },
  );

  it.each(["descriptionPlain", "salaryDescriptionPlain", "additionalPlain"])(
    "does not excuse a non-string %s when matching HTML exists",
    async (field) => {
      const selected = adapter(
        vi.fn<typeof globalThis.fetch>(async () => jsonResponse(fullPosting({ [field]: 42 }))),
      );
      await expect(selected.pollExact(exactContext())).rejects.toThrow("invalid");
    },
  );

  it("retains HTML-only sections in independent truth even when description is deselected", async () => {
    const retainedClosing = `Everyone welcome. ${"Full closing content. ".repeat(700)}`.trim();
    let response = fullPosting({
      additionalPlain: undefined,
      additional: `<p>${retainedClosing}</p>`,
      salaryDescriptionPlain: null,
    });
    const selected = adapter(vi.fn<typeof globalThis.fetch>(async () => jsonResponse(response)));
    const verifier = new RegisteredIndependentProviderVerifier(
      new SourceRegistry(
        [
          {
            sourceId: selected.sourceId,
            provider: "lever",
            provenance: "permitted_api",
            enabled: true,
            adapter: selected,
          },
        ],
        () => true,
        { providerActivationAllowed: true },
      ),
      { findExact: async () => [] },
      [
        {
          sourceId: selected.sourceId,
          provider: "lever",
          pageVariant: "lever-posting-v1",
          atsTenant: "reviewed-site",
          sourcePolicyVersion: "synthetic-v1",
        },
      ],
      {
        clock: () => new Date("2026-08-23T00:01:00.000Z"),
        createId: () => "018f0000-0000-7000-8000-000000000003",
      },
    );
    const sourceUrl = `https://jobs.lever.co/reviewed-site/${postingId}`;
    const proposal: NormalizedContributionProposal = {
      schemaVersion: 1,
      normalizedTitle: "platform engineer",
      normalizedLocations: [],
      provenance: {
        provider: "lever",
        pageVariant: "lever-posting-v1",
        canonicalSourceUrl: sourceUrl,
        canonicalSourceUrlSha256: createHash("sha256").update(sourceUrl).digest("hex"),
        atsTenant: "reviewed-site",
        externalJobId: postingId,
        adapterVersion: "d2-job-page-v1",
        contributedContentSha256: "a".repeat(64),
        observedAt: "2026-08-23T00:00:00.000Z",
      },
      dedupe: { exactIdentityKeys: [], fuzzyFingerprintSha256: "b".repeat(64) },
      proposalSha256: "c".repeat(64),
    };
    const input = {
      contributionId: "018f0000-0000-7000-8000-000000000001",
      normalizationId: "018f0000-0000-7000-8000-000000000002",
      proposal,
    };
    expect(proposal.normalizedDescriptionSha256).toBeUndefined();
    const result = await verifier.verify(input);
    expect(result).toMatchObject({
      status: "verified",
      providerObservation: { description: expect.stringContaining(retainedClosing) },
    });
    expect(result).toMatchObject({
      providerObservation: { description: expect.stringContaining("$100,000—$120,000 annually.") },
    });
    response = fullPosting({
      additionalPlain: undefined,
      additional: "<script>Not job text.</script>",
    });
    await expect(verifier.verify(input)).resolves.toMatchObject({ status: "unavailable" });
    response = fullPosting({
      descriptionPlain: "x".repeat(100_000),
      additionalPlain: undefined,
      additional: "<p>More public content.</p>",
    });
    await expect(verifier.verify(input)).resolves.toMatchObject({ status: "unavailable" });
  });

  it.each([
    { descriptionPlain: null },
    { descriptionPlain: "", lists: [] },
    { lists: null },
    { lists: {} },
    { lists: [null] },
    { lists: [[]] },
    { lists: [{ text: "Requirements", content: "" }] },
    { lists: [{ text: "", content: "<li>Work.</li>" }] },
    { lists: [{ text: "x".repeat(501), content: "<li>Work.</li>" }] },
    { lists: [{ text: "Requirements", content: "<form>Not public job content.</form>" }] },
    {
      lists: Array.from({ length: 26 }, () => ({
        text: "Requirements",
        content: "<li>Work.</li>",
      })),
    },
    { lists: [{ text: "Requirements", content: "x".repeat(100_001) }] },
    { salaryDescriptionPlain: 42 },
    { additionalPlain: {} },
    { descriptionPlain: "x".repeat(100_000), additionalPlain: "One more section." },
  ])("rejects malformed or aggregate-oversized description sections: %j", async (override) => {
    const selected = adapter(
      vi.fn<typeof globalThis.fetch>(async () => jsonResponse(posting(override))),
    );
    await expect(selected.pollExact(exactContext())).rejects.toThrow();
  });

  it.each(["../posting", "posting?x=y", "posting%2felse", "x".repeat(101), "short"])(
    "rejects malformed exact identity %s before fetching",
    async (externalJobId) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(adapter(fetch).pollExact({ ...context(), externalJobId })).rejects.toThrow(
        "identifier is invalid",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: "another-posting", hostedUrl: "https://jobs.lever.co/reviewed-site/another-posting" },
    { hostedUrl: `https://jobs.lever.co/another-site/${postingId}` },
    { hostedUrl: `https://jobs.eu.lever.co/reviewed-site/${postingId}` },
    { hostedUrl: `https://evil.example/reviewed-site/${postingId}` },
    { hostedUrl: `https://jobs.lever.co/reviewed-site/${postingId}/apply` },
  ])("refuses mismatched exact response identity: %j", async (override) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(posting(override)));
    await expect(adapter(fetch).pollExact(exactContext())).rejects.toThrow(
      /identity|approved site/,
    );
  });

  it.each([
    [404, "source_unavailable"],
    [429, "rate_limited"],
    [503, "source_unavailable"],
    [302, "source_unavailable"],
  ] as const)(
    "keeps exact HTTP %s unavailable without inferring a withdrawal",
    async (status, reason) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
      await expect(adapter(fetch).pollExact(exactContext())).resolves.toEqual({
        kind: "retry",
        reason,
      });
    },
  );

  it("retains exact request time, body-size, and response-type boundaries", async () => {
    const timedFetch = vi.fn<typeof globalThis.fetch>(
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("synthetic timeout")), {
            once: true,
          });
        }),
    );
    const timed = new LeverPostingsAdapter({
      sourceId: "lever-reviewed-site",
      site: "reviewed-site",
      companyName: "Reviewed Company",
      verifiedCompanyDomain: "company.example",
      requestTimeoutMs: 100,
      fetch: timedFetch,
    });
    await expect(timed.pollExact(exactContext())).resolves.toEqual({
      kind: "retry",
      reason: "timeout",
    });
    for (const response of [
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "1000001" },
      }),
      new Response(`{}${" ".repeat(1_000_000)}`, {
        headers: { "content-type": "application/json" },
      }),
      new Response("{}", { headers: { "content-type": "text/html" } }),
    ]) {
      await expect(
        adapter(vi.fn<typeof globalThis.fetch>(async () => response)).pollExact(exactContext()),
      ).rejects.toThrow(/byte limit|response type/);
    }
  });

  it("uses only the fixed published-postings GET and maps reviewed fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify([posting()]), {
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(adapter(fetch).poll(context())).resolves.toEqual({
      kind: "success",
      observations: [
        {
          companyName: "Reviewed Company",
          title: "Platform Engineer",
          locations: ["Remote", "New York, NY"],
          description: "Build and maintain systems.",
          sourceUrl: "https://jobs.lever.co/reviewed-site/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
          atsTenant: "reviewed-site",
          externalJobId: "5ac21346-8e0c-4494-8e7a-3eb92ff77902",
          verifiedCompanyDomain: "company.example",
          department: "Engineering",
          workMode: "remote",
        },
      ],
      withdrawals: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/reviewed-site?mode=json&skip=0&limit=100",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("keeps the EU acquisition and hosted-job boundaries paired", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify([
            posting({
              hostedUrl:
                "https://jobs.eu.lever.co/reviewed-site/5ac21346-8e0c-4494-8e7a-3eb92ff77902",
            }),
          ]),
          { headers: { "content-type": "application/json" } },
        ),
    );
    await expect(adapter(fetch, "eu").poll(context())).resolves.toMatchObject({
      kind: "success",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.eu.lever.co/v0/postings/reviewed-site?mode=json&skip=0&limit=100",
    );
  });

  it.each([
    [429, "rate_limited"],
    [503, "source_unavailable"],
  ] as const)("maps HTTP %s to a redacted retry", async (status, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    await expect(adapter(fetch).poll(context())).resolves.toEqual({ kind: "retry", reason });
  });

  it("rejects foreign identities, oversized bodies, and a page beyond the bounded batch", async () => {
    const foreign = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify([posting({ hostedUrl: "https://evil.example/job" })]), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(adapter(foreign).poll(context())).rejects.toThrow("approved site");

    const oversized = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response("[]", {
          headers: { "content-type": "application/json", "content-length": "1000001" },
        }),
    );
    await expect(adapter(oversized).poll(context())).rejects.toThrow("byte limit");

    let request = 0;
    const overflow = vi.fn<typeof globalThis.fetch>(async () => {
      request += 1;
      const jobs =
        request === 1
          ? Array.from({ length: 100 }, (_, index) =>
              posting({
                id: `posting-${index.toString().padStart(8, "0")}`,
                hostedUrl: `https://jobs.lever.co/reviewed-site/posting-${index.toString().padStart(8, "0")}`,
              }),
            )
          : [posting()];
      return new Response(JSON.stringify(jobs), {
        headers: { "content-type": "application/json" },
      });
    });
    await expect(adapter(overflow).poll(context())).rejects.toThrow("bounded size");
    expect(overflow.mock.calls[1]?.[0]).toContain("skip=100&limit=1");
  });
});
