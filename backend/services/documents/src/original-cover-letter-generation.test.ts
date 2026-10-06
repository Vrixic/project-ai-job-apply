import { coverLetterContext, ModelGateway, OpenAiLunaProvider } from "@ai-job-apply/ai-sdk";
import type { GraphFact } from "@ai-job-apply/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import {
  OriginalCoverLetterGenerationActor,
  prepareOriginalCoverLetterRequest,
} from "./original-cover-letter-generation.js";
import { TemporaryCoverLetterService } from "./temporary-cover-letter.js";
import { type TemporaryMaterialReference, TemporaryMaterialStore } from "./temporary-materials.js";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const OWNER = "019d04cf-1f80-7000-8000-000000000001";
const APP = "019d04cf-1f80-7000-8000-000000000002";
const GENERATION = "019d04cf-1f80-7000-8000-000000000003";
const FACT = "019d04cf-1f80-7000-8000-000000000004";
const WORK = "019d04cf-1f80-7000-8000-000000000005";
const TEXT = "I have experience with TypeScript.";
const facts: GraphFact[] = [
  {
    id: FACT,
    kind: "skill",
    key: "skill",
    value: "TypeScript",
    verification: "confirmed",
    sensitivity: "standard",
    source: { type: "user", reference: "synthetic" },
    version: 1,
  },
];
const job = { title: "Engineer", company: "Synthetic", description: "Build reliable systems." };
const stores: TemporaryMaterialStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
});

function setup(
  options: {
    documentVersion?: number;
    enabled?: boolean;
    gatewayEnabled?: boolean;
    text?: string;
    timeoutMs?: number;
  } = {},
) {
  let now = NOW;
  let enabled = options.enabled ?? true;
  const evidence = { facts: structuredClone(facts), job: { ...job } };
  const source = { load: vi.fn(async () => evidence) };
  const binding = coverLetterContext({ ...evidence, now: new Date(now) });
  const identity = {
    id: GENERATION,
    ownerUserId: OWNER,
    applicationId: APP,
    ...binding,
    noticeVersion: "openai-cover-letter.v1",
    approvedAt: new Date(NOW),
    expiresAt: new Date(NOW + 900_000),
  };
  const prepared = prepareOriginalCoverLetterRequest(identity, { ...evidence, now: new Date(now) });
  if (!prepared) throw Error("SyntheticOriginalRequestMissing");
  const reference: CoverLetterWorkReference = {
    id: WORK,
    documentId: GENERATION,
    purpose: "provider_dispatch",
    requestSha256: prepared.requestSha256,
  };
  let consumed = false;
  const work = {
    claimProviderDispatch: vi.fn(async () => {
      if (consumed) return { kind: "unavailable" as const };
      consumed = true;
      return { kind: "claimed" as const, reference };
    }),
    settleProviderDispatch: vi.fn(async () => {}),
    settleRejectedProviderDispatch: vi.fn(async () => {}),
    settleUndispatchedProviderDispatch: vi.fn(async () => {}),
  };
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text:
                    options.text ??
                    JSON.stringify({ paragraphs: [{ text: TEXT, factIds: [FACT] }] }),
                },
              ],
            },
          ],
        }),
      ),
  );
  const provider = new OpenAiLunaProvider({
    enabled: () => true,
    apiKey: () => "synthetic",
    fetch: transport,
  });
  const gateway = new ModelGateway(provider, {
    enabled: () => options.gatewayEnabled ?? true,
    clock: () => new Date(now),
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  const memory = new TemporaryMaterialStore({ wallNow: () => now, monotonicNow: () => now });
  stores.push(memory);
  let recorded = false;
  const authority = {
    claimOriginalCompletion: vi.fn(async (_reference: Readonly<TemporaryMaterialReference>) => {
      if (recorded) return "already_completed" as const;
      recorded = true;
      return "claimed" as const;
    }),
  };
  const temporary = new TemporaryCoverLetterService(
    memory,
    source,
    authority,
    () => true,
    () => new Date(now),
  );
  const actor = new OriginalCoverLetterGenerationActor(
    source,
    gateway,
    work,
    temporary,
    () => enabled,
    () => new Date(now),
    options.documentVersion ?? 1,
  );
  return {
    actor,
    source,
    evidence,
    identity,
    reference,
    work,
    transport,
    authority,
    memory,
    temporary,
    setNow: (value: number) => {
      now = value;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}

describe("original memory-only cover-letter generation actor", () => {
  it("uses the owning Documents version for a second explicit generation", async () => {
    const f = setup({ documentVersion: 2 });
    const generated = await f.actor.generate(f.identity);
    expect(generated.kind).toBe("ready");
    if (generated.kind !== "ready") throw Error("SyntheticGenerationMissing");
    expect(generated.reference.version).toBe(2);
    expect(f.authority.claimOriginalCompletion).toHaveBeenCalledExactlyOnceWith(
      generated.reference,
    );
    const preview = await f.temporary.preview({ ...generated.reference });
    expect(preview.value).toMatchObject({ version: 2 });
    preview.release();
  });
  it.each([0, -1, 1.5, NaN, 2_147_483_648])(
    "refuses invalid owning version %s before provider work",
    async (documentVersion) => {
      const f = setup({ documentVersion });
      expect(await f.actor.generate(f.identity)).toEqual({
        kind: "failed",
        errorCode: "generation_unavailable",
      });
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.work.claimProviderDispatch).not.toHaveBeenCalled();
    },
  );
  it("runs actual SDK grounding and production PDF/DOCX verification without returning content", async () => {
    const f = setup();
    const generated = await f.actor.generate(f.identity);
    expect(generated.kind).toBe("ready");
    if (generated.kind !== "ready") throw Error("SyntheticGenerationMissing");
    expect(generated.reference.completedAtMs).toBe(NOW);
    expect(generated.reference.expiresAtMs).toBe(NOW + 1_800_000);
    expect(JSON.stringify(generated)).not.toContain(TEXT);
    expect(f.work.claimProviderDispatch).toHaveBeenCalledWith({
      documentId: GENERATION,
      requestSha256: f.reference.requestSha256,
      consentExpiresAt: f.identity.expiresAt,
    });
    expect(f.work.settleProviderDispatch).toHaveBeenCalledExactlyOnceWith(f.reference);
    expect(f.authority.claimOriginalCompletion).toHaveBeenCalledExactlyOnceWith(
      generated.reference,
    );
    const preview = await f.temporary.preview({ ...generated.reference });
    expect(JSON.stringify(preview.value)).toContain(TEXT);
    preview.release();
    expect(f.transport).toHaveBeenCalledOnce();
    expect(JSON.parse(f.transport.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      store: false,
      background: false,
      stream: false,
    });
    expect(f.evidence.facts[0]?.value).toBe("TypeScript");
    expect(await f.actor.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it("defaults off before owner evidence, grant consumption or provider access", async () => {
    const f = setup();
    const actor = new OriginalCoverLetterGenerationActor(
      f.source,
      {} as never,
      f.work,
      f.temporary,
    );
    expect(await actor.generate(f.identity)).toMatchObject({ kind: "failed" });
    expect(f.source.load).not.toHaveBeenCalled();
    expect(f.work.claimProviderDispatch).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(["expired", "changed_evidence", "disabled_after_evidence", "foreign_claim"])(
    "refuses %s before disclosure without settling unknown work",
    async (fault) => {
      const f = setup();
      if (fault === "expired") f.setNow(NOW + 900_000);
      if (fault === "changed_evidence") f.evidence.job.description = "Changed posting";
      if (fault === "disabled_after_evidence")
        f.source.load.mockImplementation(async () => {
          f.setEnabled(false);
          return f.evidence;
        });
      if (fault === "foreign_claim") f.reference.documentId = APP;
      expect((await f.actor.generate(f.identity)).kind).not.toBe("ready");
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleUndispatchedProviderDispatch).not.toHaveBeenCalled();
    },
  );

  it.each(["claim_lost", "provider_unknown", "settlement_lost", "completion_lost"])(
    "keeps %s unresolved without redispatch, saved recovery or diagnostic leakage",
    async (fault) => {
      const f = setup();
      if (fault === "claim_lost")
        f.work.claimProviderDispatch.mockRejectedValue(Error("SensitiveClaim"));
      if (fault === "provider_unknown")
        f.transport.mockRejectedValue(Error("SensitiveProviderBody"));
      if (fault === "settlement_lost")
        f.work.settleProviderDispatch.mockRejectedValue(Error("SensitiveSettlement"));
      if (fault === "completion_lost")
        f.authority.claimOriginalCompletion.mockRejectedValue(Error("SensitiveCompletion"));
      expect(await f.actor.generate(f.identity)).toEqual({ kind: "in_progress" });
      expect(f.transport.mock.calls.length).toBe(fault === "claim_lost" ? 0 : 1);
      if (["claim_lost", "provider_unknown"].includes(fault))
        expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleRejectedProviderDispatch).not.toHaveBeenCalled();
      expect(f.work.settleUndispatchedProviderDispatch).not.toHaveBeenCalled();
    },
  );

  it.each(["not json", "x".repeat(8_001)])(
    "fences only positive output rejection",
    async (text) => {
      const f = setup({ text });
      expect(await f.actor.generate(f.identity)).toMatchObject({ kind: "failed" });
      expect(f.work.settleRejectedProviderDispatch).toHaveBeenCalledExactlyOnceWith(f.reference);
      expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
      expect(f.authority.claimOriginalCompletion).not.toHaveBeenCalled();
    },
  );

  it("settles a positive local gateway refusal without a model call", async () => {
    const f = setup({ gatewayEnabled: false });
    expect(await f.actor.generate(f.identity)).toMatchObject({ kind: "failed" });
    expect(f.work.settleUndispatchedProviderDispatch).toHaveBeenCalledExactlyOnceWith(f.reference);
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("records the original clock before delayed control completion", async () => {
    const f = setup();
    f.work.settleProviderDispatch.mockImplementation(async () => {
      f.setNow(NOW + 120_000);
    });
    const generated = await f.actor.generate(f.identity);
    expect(generated.kind).toBe("ready");
    if (generated.kind !== "ready") throw Error("SyntheticGenerationMissing");
    expect(generated.reference.completedAtMs).toBe(NOW);
    expect(generated.reference.expiresAtMs).toBe(NOW + 1_800_000);
  });

  it("cancellation during native completion clears staged bytes and cannot publish", async () => {
    const f = setup();
    const controller = new AbortController();
    f.authority.claimOriginalCompletion.mockImplementation(async () => {
      controller.abort();
      return "claimed" as const;
    });
    expect(await f.actor.generate(f.identity, controller.signal)).toEqual({ kind: "in_progress" });
    expect(f.work.settleProviderDispatch).toHaveBeenCalledOnce();
    expect(f.transport).toHaveBeenCalledOnce();
    const ref = f.authority.claimOriginalCompletion.mock.calls[0]?.[0];
    expect(ref).toBeDefined();
    if (ref) expect(f.memory.has(ref)).toBe(false);
  });

  it("keeps original admission through SDK timeout until positive late fulfillment", async () => {
    vi.useFakeTimers();
    const f = setup({ timeoutMs: 10 });
    let finish!: (response: Response) => void;
    f.transport.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const original = f.actor.generate(f.identity);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(await f.actor.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(f.work.claimProviderDispatch).toHaveBeenCalledOnce();
    expect(f.work.settleProviderDispatch).not.toHaveBeenCalled();
    finish(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "{}" }],
            },
          ],
        }),
      ),
    );
    expect(await original).toEqual({ kind: "in_progress" });
    expect(f.work.settleProviderDispatch).toHaveBeenCalledExactlyOnceWith(f.reference);
    expect(f.authority.claimOriginalCompletion).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it("expires generated copies while a native settlement acknowledgement is still pending", async () => {
    vi.useFakeTimers();
    const f = setup();
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    f.work.settleProviderDispatch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          entered();
        }),
    );
    const original = f.actor.generate(f.identity);
    await ready;
    f.setNow(NOW + 1_800_000);
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(f.authority.claimOriginalCompletion).not.toHaveBeenCalled();
    expect(await f.actor.generate(f.identity)).toEqual({ kind: "in_progress" });
    finish();
    expect(await original).toEqual({ kind: "in_progress" });
    expect(f.authority.claimOriginalCompletion).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it("memory loss and a new actor never reconstruct or redispatch the original generation", async () => {
    const f = setup();
    const generated = await f.actor.generate(f.identity);
    expect(generated.kind).toBe("ready");
    f.memory.dispose();
    const restarted = new OriginalCoverLetterGenerationActor(
      f.source,
      {} as never,
      f.work,
      f.temporary,
      () => true,
      () => new Date(NOW),
    );
    expect(await restarted.generate(f.identity)).toEqual({ kind: "in_progress" });
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.authority.claimOriginalCompletion).toHaveBeenCalledOnce();
  });

  it("clears a just-published completion if cancellation arrives before the actor receives it", async () => {
    const f = setup();
    const controller = new AbortController();
    let published: Readonly<TemporaryMaterialReference> | undefined;
    const actor = new OriginalCoverLetterGenerationActor(
      f.source,
      new ModelGateway(
        new OpenAiLunaProvider({
          enabled: () => true,
          apiKey: () => "synthetic",
          fetch: f.transport,
        }),
        { enabled: () => true, clock: () => new Date(NOW) },
      ),
      f.work,
      {
        complete: async (...args) => {
          const completed = await f.temporary.complete(...args);
          published = completed.reference;
          controller.abort();
          return completed;
        },
        discardCompletion: (ref) => f.temporary.discardCompletion(ref),
      },
      () => true,
      () => new Date(NOW),
    );
    expect(await actor.generate(f.identity, controller.signal)).toEqual({ kind: "in_progress" });
    expect(published).toBeDefined();
    if (published) expect(f.memory.has(published)).toBe(false);
    expect(f.transport).toHaveBeenCalledOnce();
  });

  it("withholds ungrounded output even though the original provider positively completed", async () => {
    const f = setup({
      text: JSON.stringify({ paragraphs: [{ text: "Invented expertise", factIds: [WORK] }] }),
    });
    expect(await f.actor.generate(f.identity)).toMatchObject({ kind: "failed" });
    expect(f.work.settleProviderDispatch).toHaveBeenCalledExactlyOnceWith(f.reference);
    expect(f.authority.claimOriginalCompletion).not.toHaveBeenCalled();
  });
});
