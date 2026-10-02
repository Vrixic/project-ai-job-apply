import { describe, expect, it, vi } from "vitest";
import type { CoverLetterGenerationOutcome } from "./cover-letter-generation.js";
import { CoverLetterPreparationService } from "./cover-letter-preparation.js";
import type { CoverLetterProviderInput } from "./cover-letter-provider-contract.js";
import type { CoverLetterMetadata } from "./cover-letter-store.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

const id = "019a4000-0000-7000-8000-000000000001";
const owner = "019a4000-0000-7000-8000-000000000002";
const now = new Date("2026-10-02T12:00:00Z");
const requestSha256 = "a".repeat(64);
function setup() {
  let enabled = true;
  let time = now;
  let existing = false;
  let granted = false;
  let saved = false;
  const identity = {
    id,
    ownerUserId: owner,
    applicationId: "019a4000-0000-7000-8000-000000000003",
    jobContextHash: "b".repeat(64),
    confirmedFactsHash: "c".repeat(64),
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: now,
    expiresAt: new Date(now.getTime() + 15 * 60_000),
  };
  const input: CoverLetterProviderInput = {
    schemaVersion: 1,
    documentId: id,
    request: {
      objectVersion: "synthetic-v1",
      etag: '"synthetic-etag"',
      sha256: requestSha256,
      sizeBytes: 100,
    },
  };
  const reference: CoverLetterWorkReference = {
    id: owner,
    documentId: id,
    purpose: "provider_dispatch",
    requestSha256,
  };
  const ready: CoverLetterGenerationOutcome = {
    kind: "ready",
    letter: { contentSha256: "d".repeat(64), sourceFactIds: [owner], confidence: 0.9 },
  };
  const metadata = vi.fn(async () =>
    existing ? ({ id, status: saved ? "ready" : "pending" } as CoverLetterMetadata) : null,
  );
  const initialize = vi.fn(async () => {
    existing = true;
    return { kind: "initialized" as const, input };
  });
  const issue = vi.fn(async () => {
    if (granted) return { kind: "unavailable" as const };
    granted = true;
    return { kind: "issued" as const, reference };
  });
  const invoke = vi.fn(async () => {
    expect(granted).toBe(true);
    saved = true;
    return { schemaVersion: 1 as const, documentId: id, outcome: "in_progress" as const };
  });
  const recover = vi.fn(
    async (): Promise<CoverLetterGenerationOutcome> => (saved ? ready : { kind: "in_progress" }),
  );
  const ports = [
    { generationMetadata: metadata },
    { initialize },
    { issueProviderDispatch: issue },
    { invoke },
    { recover },
  ] as const;
  const service = new CoverLetterPreparationService(
    ...ports,
    () => enabled,
    () => time,
  );
  return {
    service,
    identity,
    input,
    reference,
    ready,
    ports,
    metadata,
    initialize,
    issue,
    invoke,
    recover,
    disable: () => {
      enabled = false;
    },
    expire: () => {
      time = new Date(identity.expiresAt.getTime() + 1);
    },
    pending: () => {
      existing = true;
    },
  };
}

describe("private cover-letter preparation with one original Invoke", () => {
  it("defaults off before all I/O", async () => {
    const f = setup();
    expect(await new CoverLetterPreparationService(...f.ports).generate(f.identity)).toEqual({
      kind: "failed",
      errorCode: "generation_unavailable",
    });
    for (const port of [f.metadata, f.initialize, f.issue, f.invoke, f.recover])
      expect(port).not.toHaveBeenCalled();
  });
  it("grants before Invoke, trusts owned recovery rather than the Invoke outcome and never reinvokes ready work", async () => {
    const f = setup();
    expect(await f.service.generate(f.identity)).toEqual(f.ready);
    expect(f.issue).toHaveBeenCalledWith({
      ownerUserId: owner,
      documentId: id,
      requestSha256,
      consentExpiresAt: f.identity.expiresAt,
    });
    expect(f.invoke).toHaveBeenCalledWith(f.input, undefined);
    f.expire();
    expect(await f.service.generate(f.identity)).toEqual(f.ready);
    expect(f.initialize).toHaveBeenCalledOnce();
    expect(f.issue).toHaveBeenCalledOnce();
    expect(f.invoke).toHaveBeenCalledOnce();
  });
  it("does not reinvoke an issued original grant after a lost Invoke acknowledgement", async () => {
    const f = setup();
    f.invoke.mockImplementation(async () => {
      throw Error("SyntheticPrivateDiagnostic");
    });
    expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(f.invoke).toHaveBeenCalledOnce();
  });
  it("awaits the committed grant through cancellation, then refuses Invoke and does not renew on replay", async () => {
    const f = setup();
    const controller = new AbortController();
    const original = f.issue.getMockImplementation();
    if (!original) throw Error("SyntheticMissingImplementation");
    f.issue.mockImplementation(async () => {
      const result = await original();
      controller.abort();
      return result;
    });
    expect(await f.service.generate(f.identity, controller.signal)).toEqual({
      kind: "in_progress",
    });
    expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it.each(["metadata", "initialize", "issue", "invoke", "recover"] as const)(
    "redacts ambiguous %s errors",
    async (port) => {
      const f = setup();
      if (port === "recover") f.pending();
      f[port].mockRejectedValue(Error("SyntheticPrivateDiagnostic"));
      expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
      if (port !== "invoke") expect(f.invoke).not.toHaveBeenCalled();
    },
  );
  it.each(["id", "purpose", "hash", "document"])(
    "rejects a malformed grant %s before Invoke",
    async (field) => {
      const f = setup();
      if (field === "id") f.reference.id = "invalid";
      if (field === "purpose") f.reference.purpose = "private_slots";
      if (field === "hash") f.reference.requestSha256 = "f".repeat(64);
      if (field === "document") f.reference.documentId = owner;
      expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
      expect(f.invoke).not.toHaveBeenCalled();
    },
  );
  it.each(["document", "reference"])(
    "rejects initializer %s mismatch before granting",
    async (field) => {
      const f = setup();
      if (field === "document") f.input.documentId = owner;
      else f.input.request.sha256 = "invalid";
      expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
      expect(f.issue).not.toHaveBeenCalled();
      expect(f.invoke).not.toHaveBeenCalled();
    },
  );
  it.each(["initialize", "issue"] as const)("rechecks the kill switch after %s", async (port) => {
    const f = setup();
    const original = f[port].getMockImplementation();
    if (!original) throw Error("SyntheticMissingImplementation");
    // Different port signatures are intentionally handled without weakening their return types.
    if (port === "initialize") {
      f.initialize.mockImplementation(async () => {
        f.disable();
        return { kind: "initialized", input: f.input };
      });
    } else {
      f.issue.mockImplementation(async () => {
        f.disable();
        return { kind: "issued", reference: f.reference };
      });
    }
    expect(await f.service.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("expires pending work into read-only recovery without another initializer or grant", async () => {
    const f = setup();
    f.pending();
    f.expire();
    expect(await f.service.generate(f.identity)).toEqual({
      kind: "failed",
      errorCode: "disclosure_expired",
    });
    expect(f.recover).toHaveBeenCalledOnce();
    expect(f.initialize).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
  });
  it("snapshots caller identity across asynchronous initialization and does not renew consent", async () => {
    const f = setup();
    const original = structuredClone(f.identity);
    f.initialize.mockImplementation(async () => {
      f.identity.ownerUserId = id;
      f.identity.expiresAt.setTime(f.identity.expiresAt.getTime() + 60_000);
      return { kind: "initialized", input: f.input };
    });
    expect(await f.service.generate(f.identity)).toEqual(f.ready);
    expect(f.issue).toHaveBeenCalledWith({
      ownerUserId: original.ownerUserId,
      documentId: id,
      requestSha256,
      consentExpiresAt: original.expiresAt,
    });
    expect(f.recover).toHaveBeenCalledWith(original);
  });
  it("does not initialize or issue after an owned binding rejection", async () => {
    const f = setup();
    f.pending();
    f.recover.mockResolvedValue({ kind: "failed", errorCode: "bindings_changed" });
    expect(await f.service.generate(f.identity)).toEqual({
      kind: "failed",
      errorCode: "bindings_changed",
    });
    expect(f.initialize).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
  });
});
