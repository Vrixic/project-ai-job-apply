import { createHash } from "node:crypto";
import type { NormalizedContributionProposal } from "@ai-job-apply/jobs-service";
import { describe, expect, it, vi } from "vitest";
import { AshbyJobBoardAdapter } from "./ashby.js";
import { RegisteredIndependentProviderVerifier } from "./contribution-verification.js";
import * as providerDescription from "./provider-description.js";
import { SourceRegistry } from "./registry.js";

const postingId = "12345678-abcd-4abc-8abc-1234567890ab";
const sourceUrl = `https://jobs.ashbyhq.com/synthetic-board/${postingId}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const context = () => ({
  observedAt: new Date("2026-09-12T12:01:00.000Z"),
  signal: new AbortController().signal,
  attempt: 1,
  externalJobId: postingId,
});

function job(id = postingId, overrides: Record<string, unknown> = {}) {
  return {
    title: "Platform Engineer",
    location: "Remote",
    isListed: true,
    workplaceType: "Remote",
    employmentType: "FullTime",
    publishedAt: "2026-09-12T12:00:00.000Z",
    descriptionPlain: "Build reliable systems. Support 12 regions.",
    descriptionHtml: "<p>Build reliable systems.</p><p>Support 12 regions.</p>",
    jobUrl: `https://jobs.ashbyhq.com/synthetic-board/${id}`,
    applyUrl: `https://jobs.ashbyhq.com/synthetic-board/${id}/application`,
    ...overrides,
  };
}

function harness(body: string) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const bytes = new TextEncoder().encode(body);
    let offset = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset === bytes.length) return controller.close();
          const end = Math.min(offset + 16_384, bytes.length);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  const adapter = new AshbyJobBoardAdapter({
    sourceId: "ashby-synthetic-board",
    jobBoardName: "synthetic-board",
    companyName: "Synthetic Company",
    verifiedCompanyDomain: "synthetic.example",
    fetch,
  });
  const poll = vi.spyOn(adapter, "poll");
  const findExact = vi.fn(async () => []);
  const registrations = [
    {
      sourceId: adapter.sourceId,
      provider: "ashby" as const,
      provenance: "permitted_api" as const,
      enabled: true,
      adapter,
    },
  ];
  const verifier = new RegisteredIndependentProviderVerifier(
    new SourceRegistry(registrations, () => true, { providerActivationAllowed: true }),
    { findExact },
    [
      {
        sourceId: adapter.sourceId,
        provider: "ashby",
        pageVariant: "ashby-job-board-v1",
        atsTenant: "synthetic-board",
        sourcePolicyVersion: "synthetic-v1",
      },
    ],
    { clock: () => context().observedAt, createId: () => "018f0000-0000-7000-8000-000000000003" },
  );
  const proposal: NormalizedContributionProposal = {
    schemaVersion: 1,
    normalizedCompanyName: "synthetic company",
    normalizedTitle: "platform engineer",
    normalizedLocations: ["remote"],
    normalizedDescriptionSha256: digest("build reliable systems. support 12 regions."),
    provenance: {
      provider: "ashby",
      pageVariant: "ashby-job-board-v1",
      canonicalSourceUrl: sourceUrl,
      canonicalSourceUrlSha256: digest(sourceUrl),
      atsTenant: "synthetic-board",
      externalJobId: postingId,
      adapterVersion: "d2-job-page-v1",
      contributedContentSha256: digest("synthetic contribution"),
      observedAt: "2026-09-12T12:00:00.000Z",
    },
    dedupe: { exactIdentityKeys: [], fuzzyFingerprintSha256: digest("synthetic fuzzy") },
    proposalSha256: digest("synthetic proposal"),
  };
  const verify = (selected = proposal) =>
    verifier.verify({
      contributionId: "018f0000-0000-7000-8000-000000000001",
      normalizationId: "018f0000-0000-7000-8000-000000000002",
      proposal: selected,
    });
  return { adapter, fetch, poll, findExact, proposal, verify, registrations };
}

describe("Ashby bounded exact verification composition", () => {
  it.each(["timeout", "abort"] as const)(
    "rechecks %s after mapping the selected provider description",
    async (mode) => {
      const controller = new AbortController();
      const realNow = performance.now.bind(performance);
      let elapsed = 0;
      const clock = vi.spyOn(performance, "now").mockImplementation(() => realNow() + elapsed);
      const parse = providerDescription.parsePublicDescriptionHtml;
      const description = vi
        .spyOn(providerDescription, "parsePublicDescriptionHtml")
        .mockImplementation((...args) => {
          const result = parse(...args);
          if (mode === "timeout") elapsed = 5_001;
          else controller.abort();
          return result;
        });
      try {
        const { adapter } = harness(JSON.stringify({ apiVersion: "1", jobs: [job()] }));
        await expect(
          adapter.pollExact({ ...context(), signal: controller.signal }),
        ).resolves.toEqual({
          kind: "retry",
          reason: mode === "timeout" ? "timeout" : "source_unavailable",
        });
        expect(description).toHaveBeenCalledTimes(1);
      } finally {
        description.mockRestore();
        clock.mockRestore();
      }
    },
  );

  it("verifies the target beyond both old board limits while general ingestion remains capped", async () => {
    const jobs = Array.from({ length: 130 }, (_, index) =>
      job(`synthetic-${index}`, {
        descriptionPlain: "x".repeat(10_000),
        descriptionHtml: undefined,
      }),
    );
    const body = JSON.stringify({ apiVersion: "1", jobs: [...jobs, job()] });
    expect(Buffer.byteLength(body)).toBeGreaterThan(1_000_000);
    const { adapter, verify, poll, fetch, findExact } = harness(body);
    await expect(verify()).resolves.toMatchObject({
      status: "verified",
      providerObservation: { sourceUrl, title: "Platform Engineer" },
    });
    expect(poll).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(findExact).toHaveBeenCalledTimes(1);
    await expect(adapter.poll(context())).rejects.toThrow("byte limit");
    const countOnly = harness(
      JSON.stringify({
        apiVersion: "1",
        jobs: jobs.slice(0, 101).map((_, i) => job(`synthetic-${i}`)),
      }),
    );
    await expect(countOnly.adapter.poll(context())).rejects.toThrow("bounded size");
  });

  it("preserves exact-response preview digests and never emits unrelated jobs or HTML", async () => {
    const { adapter } = harness(
      JSON.stringify({ apiVersion: "1", jobs: [job("another-posting"), job()] }),
    );
    const result = await adapter.pollExact(context());
    if (result.kind !== "success" || !result.observations[0])
      throw new Error("Missing synthetic result");
    expect(result.observations).toHaveLength(1);
    expect(
      adapter.pagePreviewDescriptionDigests(result.observations[0], "d2-job-page-v1"),
    ).toContain(digest("build reliable systems.support 12 regions."));
    expect(
      adapter.pagePreviewDescriptionDigests({ ...result.observations[0] }, "d2-job-page-v1"),
    ).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/descriptionHtml|<p>|another-posting/u);
  });

  it.each([
    [[], "unavailable"],
    [[job(postingId, { isListed: false })], "closed"],
    [[job(postingId, { title: "Different position" })], "mismatch"],
    [[job(), job()], "unavailable"],
    [[job(), job("other-posting", { jobUrl: "https://evil.example/job" })], "unavailable"],
    [[job(postingId, { applyUrl: "https://evil.example/application" })], "unavailable"],
  ])(
    "keeps absence, explicit withdrawal, mismatch and ambiguous evidence distinct",
    async (jobs, status) => {
      const { verify } = harness(JSON.stringify({ apiVersion: "1", jobs }));
      await expect(verify()).resolves.toMatchObject({ status });
    },
  );

  it("discards an early target when the response is incomplete or malformed", async () => {
    for (const body of [
      `{"apiVersion":"1","jobs":[${JSON.stringify(job())},`,
      `${JSON.stringify({ apiVersion: "1", jobs: [job()] })}false`,
      JSON.stringify({ apiVersion: "2", jobs: [job()] }),
    ]) {
      const { verify, findExact } = harness(body);
      await expect(verify()).resolves.toMatchObject({ status: "unavailable" });
      expect(findExact).not.toHaveBeenCalled();
    }
  });

  it("does not fetch for invalid exact IDs or acquire source authority from the new method", async () => {
    const { adapter, fetch, registrations } = harness(
      JSON.stringify({ apiVersion: "1", jobs: [job()] }),
    );
    for (const externalJobId of ["../escape", "", `${postingId}?private=true`]) {
      await expect(adapter.pollExact({ ...context(), externalJobId })).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(() => new SourceRegistry(registrations)).toThrow("default-off");
    const disabled = new SourceRegistry(
      registrations.map((registration) => ({ ...registration, enabled: false })),
    );
    expect(() => disabled.requireEnabled(adapter.sourceId)).toThrow("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
});
