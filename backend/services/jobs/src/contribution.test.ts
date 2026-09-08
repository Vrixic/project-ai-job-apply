import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DevelopmentContributionCapabilitySource } from "./contribution-capability-source.js";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import {
  type CreateJobContributionCommand,
  type JobContributionConsentVerifier,
  JobContributionConsentRequiredError,
  JobContributionCapabilityDisabledError,
  type JobContributionInput,
  JobContributionService,
  type JobContributionStatus,
  type JobContributionStore,
  JobContributionUnavailableError,
  jobContributionContentDigestInput,
  jobContributionPreviewDigestInput,
} from "./contribution.js";
import {
  contributionCapabilityPolicyDigestInput,
  type D2ContributionCapabilityPolicy,
} from "./contribution-capability-policy.js";

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
      client: { surface: "browser_extension", version: "0.2.0" },
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

const capabilityPolicy: D2ContributionCapabilityPolicy = {
  schemaVersion: 1,
  revision: "d2-synthetic-intake-v1",
  issuedAt: "2026-09-01T12:00:00.000Z",
  expiresAt: "2026-09-02T12:00:00.000Z",
  intakeEnabled: true,
  processingEnabled: false,
  clients: { "0.2.0": true },
  providers: { ashby: true, greenhouse: true, lever: true },
  variants: {
    "ashby-job-board-v1": true,
    "greenhouse-board-v1": true,
    "lever-posting-v1": true,
  },
  domains: {
    "boards.greenhouse.io": true,
    "job-boards.greenhouse.io": true,
    "jobs.ashbyhq.com": true,
    "jobs.eu.lever.co": true,
    "jobs.lever.co": true,
  },
};
const capabilityKeys = generateKeyPairSync("ed25519");
const capabilityDigestInput = contributionCapabilityPolicyDigestInput(capabilityPolicy);
const allowCapability = {
  async load() {
    return {
      envelope: {
        keyId: "synthetic-key-v1",
        payload: capabilityPolicy,
        signature: sign(
          null,
          Buffer.from(capabilityDigestInput),
          capabilityKeys.privateKey,
        ).toString("base64url"),
      },
      publicKeys: {
        "synthetic-key-v1": capabilityKeys.publicKey
          .export({ format: "pem", type: "spki" })
          .toString(),
      },
    };
  },
};
const intakeNow = () => new Date("2026-09-01T13:00:00.000Z");

function capabilityLoader(policy: D2ContributionCapabilityPolicy) {
  const digestInput = contributionCapabilityPolicyDigestInput(policy);
  return {
    async load() {
      return {
        envelope: {
          keyId: "synthetic-key-v1",
          payload: policy,
          signature: sign(null, Buffer.from(digestInput), capabilityKeys.privateKey).toString(
            "base64url",
          ),
        },
        publicKeys: {
          "synthetic-key-v1": capabilityKeys.publicKey
            .export({ format: "pem", type: "spki" })
            .toString(),
        },
      };
    },
  };
}

describe("JobContributionService", () => {
  const allowConsent = {
    async verify() {
      return true;
    },
  };

  it("accepts only exact preview approval and remains queued", async () => {
    const store = new MemoryStore();
    const service = new JobContributionService(store, allowConsent, allowCapability, intakeNow);
    await expect(service.contribute(command())).resolves.toEqual(store.record);
    expect(store.command?.input.posting.title).toBe("Software Engineer");
  });

  it("accepts development jobs without signed policy while rechecking authority around consent", async () => {
    const values = {
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
      D2_CONTRIBUTION_ROUTES_ENABLED: "true",
    };
    const store = new MemoryStore();
    const capability = new DevelopmentContributionCapabilitySource(values);
    await expect(
      new JobContributionService(
        store,
        allowConsent,
        capability,
        () => new Date("2050-09-08T12:00:00.000Z"),
      ).contribute(command()),
    ).resolves.toMatchObject({ state: "queued" });
    await expect(
      new JobContributionService(
        new MemoryStore(),
        { verify: async () => false },
        capability,
        intakeNow,
      ).contribute(command()),
    ).rejects.toThrow(JobContributionConsentRequiredError);
    const stopped = new MemoryStore();
    await expect(
      new JobContributionService(
        stopped,
        {
          verify: async () => {
            values.D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED = "false";
            return true;
          },
        },
        capability,
        intakeNow,
      ).contribute(command()),
    ).rejects.toThrow(JobContributionCapabilityDisabledError);
    expect(stopped.command).toBeUndefined();
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
      new JobContributionService(
        new MemoryStore(),
        allowConsent,
        allowCapability,
        intakeNow,
      ).contribute(input),
    ).resolves.toMatchObject({ state: "queued" });
  });

  it("rejects approval that omits a contributed field", async () => {
    const store = new MemoryStore();
    const service = new JobContributionService(store, allowConsent, allowCapability, intakeNow);
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
        new JobContributionService(
          new MemoryStore(),
          allowConsent,
          allowCapability,
          intakeNow,
        ).contribute(input),
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
        new JobContributionService(
          new MemoryStore(),
          allowConsent,
          allowCapability,
          intakeNow,
        ).contribute(input),
      ).rejects.toThrow("source or approval is invalid");
    }
    const forged = command();
    forged.input.observation.contentSha256 = "f".repeat(64);
    forged.input.approval.previewDigestSha256 = createHash("sha256")
      .update(jobContributionPreviewDigestInput(forged.input))
      .digest("hex");
    await expect(
      new JobContributionService(
        new MemoryStore(),
        allowConsent,
        allowCapability,
        intakeNow,
      ).contribute(forged),
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
    await expect(
      new JobContributionService(store, undefined, allowCapability, intakeNow).contribute(
        command(),
      ),
    ).rejects.toThrow("current contribution consent binding is required");
    expect(store.command).toBeUndefined();
  });

  it("fails closed when signed capability policy is absent, disabled, or not yet valid", async () => {
    const absentStore = new MemoryStore();
    await expect(
      new JobContributionService(absentStore, allowConsent).contribute(command()),
    ).rejects.toThrow("temporarily unavailable");
    expect(absentStore.command).toBeUndefined();

    for (const policy of [
      { ...capabilityPolicy, intakeEnabled: false },
      {
        ...capabilityPolicy,
        issuedAt: "2026-09-01T14:00:00.000Z",
        expiresAt: "2026-09-02T14:00:00.000Z",
      },
    ]) {
      const store = new MemoryStore();
      await expect(
        new JobContributionService(
          store,
          allowConsent,
          capabilityLoader(policy),
          intakeNow,
        ).contribute(command()),
      ).rejects.toThrow("disabled for this client or source");
      expect(store.command).toBeUndefined();
    }
  });

  it("rechecks the signed intake policy immediately before durable creation", async () => {
    const store = new MemoryStore();
    const enabled = capabilityLoader(capabilityPolicy);
    const disabled = capabilityLoader({ ...capabilityPolicy, intakeEnabled: false });
    let reads = 0;
    const changing = {
      load: async () => {
        reads += 1;
        return reads === 1 ? enabled.load() : disabled.load();
      },
    };
    await expect(
      new JobContributionService(store, allowConsent, changing, intakeNow).contribute(command()),
    ).rejects.toThrow("disabled for this client or source");
    expect(reads).toBe(2);
    expect(store.command).toBeUndefined();
  });

  it("classifies store failures without retaining their private details", async () => {
    const privateFailure = Object.assign(new Error("candidate-private database detail"), {
      code: "23514",
      constraint: "job_contributions_chronology_ck",
    });
    const store = new MemoryStore();
    store.create = async () => {
      throw privateFailure;
    };

    let failure: unknown;
    try {
      await new JobContributionService(store, allowConsent, allowCapability, intakeNow).contribute(
        command(),
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(JobContributionUnavailableError);
    expect((failure as JobContributionUnavailableError).code).toBe("JOB_STORE_CHRONOLOGY");
    expect((failure as Error).message).not.toContain("candidate-private");
  });

  it.each([
    ["08006", "PostgresError", "JOB_STORE_CONNECTION"],
    ["22007", "PostgresError", "JOB_STORE_DATA"],
    ["40001", "PostgresError", "JOB_STORE_TRANSACTION"],
    ["42883", "PostgresError", "JOB_STORE_SCHEMA"],
    ["53300", "PostgresError", "JOB_STORE_RESOURCE"],
    [undefined, "PostgresError", "JOB_STORE_DATABASE"],
    [undefined, "TypeError", "JOB_STORE_RUNTIME"],
  ])("classifies safe store failure family %s", async (code, name, expected) => {
    const privateFailure = Object.assign(new Error("private database detail"), { code, name });
    const store = new MemoryStore();
    store.create = async () => {
      throw privateFailure;
    };

    await expect(
      new JobContributionService(store, allowConsent, allowCapability, intakeNow).contribute(
        command(),
      ),
    ).rejects.toMatchObject({ code: expected });
  });

  it("uses a fixed store stage for runtime failures while preserving database families", async () => {
    const staged = (cause: unknown) =>
      Object.assign(new Error("private staged persistence detail"), {
        cause,
        code: "JOB_STORE_INSERT",
        name: "JobContributionStoreStageError",
      });
    const store = new MemoryStore();
    store.create = async () => {
      throw staged(Object.assign(new Error("private runtime detail"), { name: "TypeError" }));
    };
    await expect(
      new JobContributionService(store, allowConsent, allowCapability, intakeNow).contribute(
        command(),
      ),
    ).rejects.toMatchObject({ code: "JOB_STORE_INSERT" });

    store.create = async () => {
      throw staged(Object.assign(new Error("private database detail"), { code: "23514" }));
    };
    await expect(
      new JobContributionService(store, allowConsent, allowCapability, intakeNow).contribute(
        command(),
      ),
    ).rejects.toMatchObject({ code: "JOB_STORE_CONSTRAINT" });
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
    await new JobContributionService(
      new MemoryStore(),
      verifier,
      allowCapability,
      intakeNow,
    ).contribute(input);
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
      clientVersion: "0.2.0",
    });
  });
});
