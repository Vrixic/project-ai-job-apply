import {
  type ApplicationCoverLetters,
  ApplicationsUnavailableError,
  type ApplicationView,
  PostgresApplicationStore,
} from "@ai-job-apply/applications-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApplicationsRuntimeOptions,
  createApplicationsRuntime,
} from "./applications-runtime.js";

const owner = "019d04cf-1f80-7000-8000-000000000101";
const applicationId = "019d04cf-1f80-7000-8000-000000000102";
const jobId = "019d04cf-1f80-7000-8000-000000000103";
const hash = "a".repeat(64);
const now = new Date("2026-10-02T12:00:00Z");

function setup(hasLetter = true) {
  const view = {
    application: {
      id: applicationId,
      ownerUserId: owner,
      canonicalJobId: jobId,
      status: "review_required",
      revision: 3,
      createdAt: now,
      updatedAt: now,
    },
    currentPacket: {
      id: applicationId,
      version: 2,
      packetHash: hash,
      jobRevision: hash,
      artifactHashes: hasLetter ? { coverLetter: hash } : {},
      fields: [],
      createdAt: now,
    },
    approval: null,
    attempts: [],
    currentAction: "review_and_approve",
  } as unknown as ApplicationView;
  const get = vi
    .spyOn(PostgresApplicationStore.prototype, "getApplication")
    .mockResolvedValue(view);
  const approve = vi
    .spyOn(PostgresApplicationStore.prototype, "approve")
    .mockResolvedValue({ replayed: false, view });
  const letters: ApplicationCoverLetters = {
    context: vi.fn(async () => ({ jobContextHash: hash, confirmedFactsHash: hash })),
    preview: vi.fn(async () => ({ status: "no_cover_letter", matchesPacket: false }) as const),
    file: vi.fn(async () => {
      throw new Error("Synthetic unexpected file request");
    }),
    binding: vi.fn(async () => hash),
  };
  const options: ApplicationsRuntimeOptions = {
    client: {} as ApplicationsRuntimeOptions["client"],
    definitions: new Map(),
    profile: { listGroundingFacts: vi.fn(async () => []) },
    catalog: {
      getActiveJob: vi.fn(async () => null),
      resolveActiveJobSummaries: vi.fn(async () => ({ items: [], catalogRevision: "synthetic" })),
    },
    clock: () => now,
    coverLetters: letters,
  };
  const run = () =>
    createApplicationsRuntime(options).approve(
      owner,
      applicationId,
      { expectedRevision: 3, packetHash: hash, acknowledgedFieldKeys: [] },
      "synthetic-idempotency-key",
    );
  return { get, approve, letters, options, run };
}

describe("current cover-letter approval binding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads the owner's current packet and passes its fresh Documents binding to the atomic approval", async () => {
    const fixture = setup();
    await fixture.run();
    expect(fixture.get).toHaveBeenCalledWith(owner, applicationId);
    expect(fixture.letters.binding).toHaveBeenCalledWith(owner, applicationId, hash);
    expect(fixture.approve.mock.calls[0]?.[0].current.coverLetterHash).toBe(hash);
    expect(fixture.letters.context).not.toHaveBeenCalled();
    expect(fixture.letters.file).not.toHaveBeenCalled();
  });

  it("passes an absent changed-evidence/job binding so the packet guard rejects the stale draft", async () => {
    const fixture = setup();
    vi.mocked(fixture.letters.binding).mockResolvedValue(undefined);
    await fixture.run();
    expect(fixture.approve.mock.calls[0]?.[0].current.coverLetterHash).toBeUndefined();
  });

  it("an owner transport failure refuses approval rather than falsely treating the draft as changed", async () => {
    const fixture = setup();
    vi.mocked(fixture.letters.binding).mockRejectedValue(
      new Error("Synthetic private transport failure"),
    );
    await expect(fixture.run()).rejects.toThrow(ApplicationsUnavailableError);
    expect(fixture.approve).not.toHaveBeenCalled();
  });

  it("a current cover letter without its Documents port fails closed before approval", async () => {
    const fixture = setup();
    delete fixture.options.coverLetters;
    await expect(fixture.run()).rejects.toThrow(ApplicationsUnavailableError);
    expect(fixture.approve).not.toHaveBeenCalled();
  });

  it("packets without a cover letter retain existing behavior and make no Documents request", async () => {
    const fixture = setup(false);
    delete fixture.options.coverLetters;
    await fixture.run();
    expect(fixture.approve).toHaveBeenCalledTimes(1);
    expect(fixture.approve.mock.calls[0]?.[0].current.coverLetterHash).toBeUndefined();
    expect(fixture.letters.binding).not.toHaveBeenCalled();
  });

  it("preparation acceptance and status remain default-off even when a Documents read port is supplied", async () => {
    const fixture = setup();
    const runtime = createApplicationsRuntime(fixture.options);
    await expect(
      runtime.prepareCoverLetter(
        owner,
        applicationId,
        {
          expectedRevision: 1,
          coverLetter: {
            disclosure: { noticeVersion: "openai-cover-letter.v1", acknowledged: true },
          },
        },
        "synthetic-key",
      ),
    ).rejects.toThrow(ApplicationsUnavailableError);
    await expect(runtime.preparation(owner, applicationId, jobId)).rejects.toThrow(
      ApplicationsUnavailableError,
    );
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.letters.context).not.toHaveBeenCalled();
  });
});
