import { v7 as uuidv7 } from "uuid";
import { describe, expect, it, vi } from "vitest";
import {
  assertPrivateSavedPageCaptureInput,
  type CreatePrivateSavedPageCaptureCommand,
  type LinkPrivateSavedPageCaptureResolutionCommand,
  PrivateCaptureAccountInactiveError,
  PrivateCaptureResolutionNotVerifiedError,
  type PrivateSavedPageCapture,
  type PrivateSavedPageCaptureInput,
  type PrivateSavedPageCaptureStore,
  PrivateSavedPageCapturesService,
  privateSavedPageCaptureDigestInput,
} from "./private-saved-page-captures.js";

const ownerUserId = uuidv7();
const now = new Date("2026-09-01T18:00:00.000Z");

function input(
  overrides: Partial<PrivateSavedPageCaptureInput> = {},
): PrivateSavedPageCaptureInput {
  return {
    schemaVersion: 1,
    captureId: uuidv7(),
    source: {
      provider: "lever",
      pageVariant: "lever-posting-v1",
      sourceUrl: "https://jobs.eu.lever.co/synthetic/synthetic-123",
      adapterVersion: "d2-job-page-v1",
    },
    snapshot: {
      title: "Synthetic Platform Engineer",
      company: "Synthetic Company",
      location: "Remote - US",
      description: "A generated-synthetic public job description.",
      externalJobId: "synthetic-123",
    },
    capturedAt: "2026-09-01T17:59:00.000Z",
    ...overrides,
  };
}

function record(value: PrivateSavedPageCaptureInput): PrivateSavedPageCapture {
  return {
    id: value.captureId,
    ownerUserId,
    source: value.source,
    snapshot: value.snapshot,
    capturedAt: value.capturedAt,
    savedAt: now.toISOString(),
  };
}

class MemoryStore implements PrivateSavedPageCaptureStore {
  readonly values = new Map<string, PrivateSavedPageCapture>();

  async create(command: CreatePrivateSavedPageCaptureCommand): Promise<PrivateSavedPageCapture> {
    const created = record(command.input);
    this.values.set(created.id, created);
    return created;
  }

  async get(_owner: string, captureId: string): Promise<PrivateSavedPageCapture | null> {
    return this.values.get(captureId) ?? null;
  }

  async delete(_owner: string, captureId: string): Promise<void> {
    this.values.delete(captureId);
  }

  async linkVerifiedResolution(
    command: LinkPrivateSavedPageCaptureResolutionCommand,
    occurredAt: Date,
  ): Promise<PrivateSavedPageCapture | null> {
    const current = this.values.get(command.captureId);
    if (!current) return null;
    const resolved: PrivateSavedPageCapture = {
      ...current,
      resolution: {
        resolutionId: uuidv7(),
        canonicalJobId: command.canonicalJobId,
        verificationEvidenceId: command.verificationEvidenceId,
        resolvedAt: occurredAt.toISOString(),
      },
    };
    this.values.set(command.captureId, resolved);
    return resolved;
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}

describe("private saved-page capture validation", () => {
  it.each([
    [
      "greenhouse",
      "greenhouse-board-v1",
      "https://boards.greenhouse.io/synthetic/jobs/synthetic-123",
    ],
    [
      "greenhouse",
      "greenhouse-board-v1",
      "https://job-boards.greenhouse.io/synthetic/jobs/synthetic-123",
    ],
    ["lever", "lever-posting-v1", "https://jobs.lever.co/synthetic/synthetic-123"],
    ["lever", "lever-posting-v1", "https://jobs.eu.lever.co/synthetic/synthetic-123"],
    ["ashby", "ashby-job-board-v1", "https://jobs.ashbyhq.com/synthetic/synthetic-123"],
  ] as const)("accepts the exact %s provider boundary", (provider, pageVariant, sourceUrl) => {
    const value = input({
      source: { provider, pageVariant, sourceUrl, adapterVersion: "d2-job-page-v1" },
    });
    expect(() => assertPrivateSavedPageCaptureInput(value)).not.toThrow();
    expect(privateSavedPageCaptureDigestInput(value)).not.toContain("rawDom");
  });

  it.each([
    "http://jobs.lever.co/synthetic/synthetic-123",
    "https://jobs.lever.co/synthetic",
    "https://jobs.lever.co/synthetic/synthetic-123?token=secret",
    "https://jobs.lever.co/synthetic/synthetic-123#form",
    "https://user:secret@jobs.lever.co/synthetic/synthetic-123",
    "https://localhost/synthetic/synthetic-123",
  ])("rejects an unsafe or structurally ambiguous source URL: %s", (sourceUrl) => {
    expect(() =>
      assertPrivateSavedPageCaptureInput(input({ source: { ...input().source, sourceUrl } })),
    ).toThrow(TypeError);
  });

  it("rejects provider/variant mismatch, markup, bidi controls, raw DOM, and oversized text", () => {
    expect(() =>
      assertPrivateSavedPageCaptureInput(
        input({ source: { ...input().source, pageVariant: "ashby-job-board-v1" } }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      assertPrivateSavedPageCaptureInput(input({ snapshot: { title: "<script>bad</script>" } })),
    ).toThrow(TypeError);
    expect(() =>
      assertPrivateSavedPageCaptureInput(input({ snapshot: { title: "Safe\u202eunsafe" } })),
    ).toThrow(TypeError);
    expect(() =>
      assertPrivateSavedPageCaptureInput(input({ snapshot: { title: "Unsafe\nnewline" } })),
    ).toThrow(TypeError);
    expect(() =>
      assertPrivateSavedPageCaptureInput(input({ snapshot: { title: "x".repeat(241) } })),
    ).toThrow(TypeError);
    expect(() =>
      assertPrivateSavedPageCaptureInput({ ...input(), rawDom: "<html />" } as never),
    ).toThrow(TypeError);
  });
});

describe("PrivateSavedPageCapturesService", () => {
  it("fails closed when the owning account is not confirmed active", async () => {
    const store = new MemoryStore();
    const service = new PrivateSavedPageCapturesService(store, {
      async isActive() {
        return false;
      },
    });
    await expect(
      service.create({
        ownerUserId,
        idempotencyKey: "private-capture-command-0001",
        input: input(),
      }),
    ).rejects.toThrow(PrivateCaptureAccountInactiveError);
    expect(store.values.size).toBe(0);
  });

  it("requires independent verification before the explicit resolution transition", async () => {
    const store = new MemoryStore();
    const verify = vi.fn().mockResolvedValue(false);
    const service = new PrivateSavedPageCapturesService(
      store,
      {
        async isActive() {
          return true;
        },
      },
      { verify },
      () => now,
    );
    const captureInput = input();
    await service.create({
      ownerUserId,
      idempotencyKey: "private-capture-command-0002",
      input: captureInput,
    });
    const command = {
      ownerUserId,
      captureId: captureInput.captureId,
      canonicalJobId: uuidv7(),
      verificationEvidenceId: uuidv7(),
    };
    await expect(service.linkVerifiedResolution(command)).rejects.toThrow(
      PrivateCaptureResolutionNotVerifiedError,
    );
    expect(verify).toHaveBeenCalledWith({
      ...command,
      source: captureInput.source,
    });
    expect((await service.get(ownerUserId, captureInput.captureId))?.resolution).toBeUndefined();
  });

  it("links only the identifier evidence returned by an explicit verifier", async () => {
    const store = new MemoryStore();
    const service = new PrivateSavedPageCapturesService(
      store,
      {
        async isActive() {
          return true;
        },
      },
      {
        async verify() {
          return true;
        },
      },
      () => now,
    );
    const captureInput = input();
    await service.create({
      ownerUserId,
      idempotencyKey: "private-capture-command-0003",
      input: captureInput,
    });
    const linked = await service.linkVerifiedResolution({
      ownerUserId,
      captureId: captureInput.captureId,
      canonicalJobId: uuidv7(),
      verificationEvidenceId: uuidv7(),
    });
    expect(linked?.resolution?.resolvedAt).toBe(now.toISOString());
  });
});
