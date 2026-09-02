import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  type CreateJobContributionCommand,
  type JobContributionConsentVerifier,
  type JobContributionInput,
  JobContributionService,
  type JobContributionStatus,
  type JobContributionStore,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "./contribution.js";

class MemoryStore implements JobContributionStore {
  command?: CreateJobContributionCommand;
  readonly record: JobContributionStatus = {
    id: uuidv7(),
    state: "queued",
    submittedAt: "2026-09-01T12:01:00.000Z",
    updatedAt: "2026-09-01T12:01:00.000Z",
  };
  async ping() {}
  async create(command: CreateJobContributionCommand) {
    this.command = command;
    return this.record;
  }
  async get(ownerUserId: string, contributionId: string) {
    return ownerUserId && contributionId === this.record.id ? this.record : null;
  }
}

function seal(value: CreateJobContributionCommand): CreateJobContributionCommand {
  value.input.observation.contentSha256 = createHash("sha256")
    .update(jobContributionContentDigestInput(value.input))
    .digest("hex");
  value.input.approval.previewDigestSha256 = createHash("sha256")
    .update(jobContributionPreviewDigestInput(value.input))
    .digest("hex");
  return value;
}

function command(): CreateJobContributionCommand {
  return seal({
    ownerUserId: uuidv7(),
    idempotencyKey: "contribution-test-key-0001",
    input: {
      schemaVersion: 1,
      contributionId: uuidv7(),
      source: {
        provider: "greenhouse",
        pageVariant: "greenhouse-board-v1",
        sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
        externalJobId: "123",
        adapterVersion: "d2-job-page-v1",
      },
      posting: {
        companyName: "Synthetic Company",
        title: "Software Engineer",
        locations: ["Remote - US"],
        description: "Generated public posting data for a unit test.",
      },
      observation: {
        observedAt: "2026-09-01T12:00:00.000Z",
        contentSha256: "a".repeat(64),
      },
      approval: {
        consentId: uuidv7(),
        consentVersion: "ugc-contribution-preview.v1",
        policyVersion: "ugc-policy-v1",
        approvedAt: "2026-09-01T12:01:00.000Z",
        approvedFields: [
          "provider",
          "pageVariant",
          "sourceUrl",
          "externalJobId",
          "companyName",
          "title",
          "locations",
          "description",
        ],
        previewDigestSha256: "0".repeat(64),
      },
    },
  });
}

describe("JobContributionService", () => {
  const allowConsent = {
    async verify() {
      return true;
    },
  };

  it("accepts only exact preview approval and remains queued", async () => {
    const store = new MemoryStore();
    const service = new JobContributionService(store, allowConsent);
    await expect(service.contribute(command())).resolves.toEqual(store.record);
    expect(store.command?.input.posting.title).toBe("Software Engineer");
  });

  it("accepts the exact supported Lever EU posting boundary", async () => {
    const input = command();
    input.input.source = {
      provider: "lever",
      pageVariant: "lever-posting-v1",
      sourceUrl: "https://jobs.eu.lever.co/synthetic/synthetic-123",
      externalJobId: "synthetic-123",
      adapterVersion: "d2-job-page-v1",
    };
    seal(input);
    await expect(
      new JobContributionService(new MemoryStore(), allowConsent).contribute(input),
    ).resolves.toMatchObject({ state: "queued" });
  });

  it("rejects approval that omits a contributed field", async () => {
    const store = new MemoryStore();
    const service = new JobContributionService(store, allowConsent);
    const input = command();
    input.input.approval.approvedFields = input.input.approval.approvedFields.slice(0, -1);
    input.input.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(input.input))
      .digest("hex");
    await expect(service.contribute(input)).rejects.toThrow(
      "approved contribution fields do not exactly match",
    );
    expect(store.command).toBeUndefined();
  });

  it("rejects insecure, credential-bearing, or fragment-bearing source URLs", async () => {
    for (const sourceUrl of [
      "http://job-boards.greenhouse.io/synthetic/jobs/123",
      "https://user:secret@job-boards.greenhouse.io/synthetic/jobs/123",
      "https://job-boards.greenhouse.io/synthetic/jobs/123#candidate-note",
      "https://job-boards.greenhouse.io/synthetic/jobs/123?utm_source=test",
      "https://127.0.0.1/synthetic/jobs/123",
      "https://jobs.lever.co/synthetic/123",
      "https://jobs.internal/synthetic/jobs/123",
    ]) {
      const input = command();
      input.input.source.sourceUrl = sourceUrl;
      seal(input);
      await expect(
        new JobContributionService(new MemoryStore(), allowConsent).contribute(input),
      ).rejects.toThrow("source or approval is invalid");
    }
  });

  it("rejects markup, control text, and a client-supplied content hash", async () => {
    for (const title of [
      "<script>alert(1)</script>",
      "Engineer\u0000Admin",
      "Engineer\u202eAdmin",
    ]) {
      const input = command();
      input.input.posting.title = title;
      input.input.observation.contentSha256 = createHash("sha256")
        .update(jobContributionContentDigestInput(input.input))
        .digest("hex");
      input.input.approval.previewDigestSha256 = createHash("sha256")
        .update(jobContributionPreviewDigestInput(input.input))
        .digest("hex");
      await expect(
        new JobContributionService(new MemoryStore(), allowConsent).contribute(input),
      ).rejects.toThrow("source or approval is invalid");
    }
    const forged = command();
    forged.input.observation.contentSha256 = "f".repeat(64);
    forged.input.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(forged.input))
      .digest("hex");
    await expect(
      new JobContributionService(new MemoryStore(), allowConsent).contribute(forged),
    ).rejects.toThrow("source or approval is invalid");
  });

  it("keeps the preview hash independent of consent issuance metadata", () => {
    const first = command().input;
    const second = {
      ...first,
      approval: {
        ...first.approval,
        consentId: uuidv7(),
        approvedAt: "2026-09-01T12:02:00.000Z",
      },
    } as JobContributionInput;
    expect(jobContributionPreviewDigestInput(second)).toBe(
      jobContributionPreviewDigestInput(first),
    );
  });

  it("canonicalizes payload property order for both server-recomputed digests", () => {
    const first = command().input;
    const second = {
      ...first,
      source: {
        adapterVersion: first.source.adapterVersion,
        sourceUrl: first.source.sourceUrl,
        ...(first.source.externalJobId === undefined
          ? {}
          : { externalJobId: first.source.externalJobId }),
        pageVariant: first.source.pageVariant,
        provider: first.source.provider,
      },
      posting: {
        description: first.posting.description,
        locations: first.posting.locations,
        title: first.posting.title,
        companyName: first.posting.companyName,
      },
    } as JobContributionInput;
    expect(jobContributionContentDigestInput(second)).toBe(
      jobContributionContentDigestInput(first),
    );
    expect(jobContributionPreviewDigestInput(second)).toBe(
      jobContributionPreviewDigestInput(first),
    );
  });

  it("fails closed on a fabricated or unavailable Profile consent binding", async () => {
    const store = new MemoryStore();
    await expect(new JobContributionService(store).contribute(command())).rejects.toThrow(
      "current contribution consent binding is required",
    );
    expect(store.command).toBeUndefined();
  });

  it("passes the exact owner, purpose, client, policy, and preview binding to Profile", async () => {
    const input = command();
    let observed: Parameters<JobContributionConsentVerifier["verify"]>[0] | undefined;
    const verifier: JobContributionConsentVerifier = {
      async verify(binding) {
        observed = binding;
        return true;
      },
    };
    await new JobContributionService(new MemoryStore(), verifier).contribute(input);
    expect(observed).toEqual({
      ownerUserId: input.ownerUserId,
      consentId: input.input.approval.consentId,
      purpose: "ugc_contribution",
      clientSurface: "browser_extension",
      contributionId: input.input.contributionId,
      consentVersion: input.input.approval.consentVersion,
      policyVersion: input.input.approval.policyVersion,
      previewDigestSha256: input.input.approval.previewDigestSha256,
      approvedAt: input.input.approval.approvedAt,
    });
  });
});
