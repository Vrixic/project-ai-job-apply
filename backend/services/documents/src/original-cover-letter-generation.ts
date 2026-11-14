import { createHash } from "node:crypto";
import type {
  CoverLetterGroundingContext,
  GatewayRequest,
  GenerationResult,
  ModelGateway,
  OriginalModelGatewayCompletion,
} from "@ai-job-apply/ai-sdk";
import { coverLetterContext } from "@ai-job-apply/ai-sdk/context";
import { groundCoverLetterOutput, prepareCoverLetterPrompt } from "@ai-job-apply/ai-sdk/generation";
import { PROMPT_VERSIONS } from "@ai-job-apply/ai-sdk/prompts";
import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import type {
  CoverLetterEvidenceSource,
  CoverLetterPreparationIdentity,
  CoverLetterReadyBinding,
} from "./cover-letter-generation.js";
import {
  encodeCoverLetterProviderObject,
  validateNativeCoverLetterModel,
} from "./cover-letter-provider-contract.js";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import type { TemporaryCoverLetterService } from "./temporary-cover-letter.js";
import {
  GENERATED_MATERIAL_LIFETIME_MS,
  type TemporaryMaterialReference,
} from "./temporary-materials.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;

/** Memory-only canonical request identity for the private issuer and original actor. Using the
 * existing encoder here does not create or require any provider object/slot. */
export function prepareOriginalCoverLetterRequest(
  identity: CoverLetterPreparationIdentity,
  context: CoverLetterGroundingContext,
): { request: GatewayRequest; requestSha256: string } | null {
  const binding = coverLetterContext(context);
  if (
    binding.jobContextHash !== identity.jobContextHash ||
    binding.confirmedFactsHash !== identity.confirmedFactsHash
  )
    return null;
  const prompt = prepareCoverLetterPrompt(context);
  if (!prompt) return null;
  const bytes = encodeCoverLetterProviderObject("request", {
    schemaVersion: 1,
    documentId: identity.id,
    noticeVersion: identity.noticeVersion,
    promptVersion: PROMPT_VERSIONS.coverLetter,
    jobContextHash: identity.jobContextHash,
    confirmedFactsHash: identity.confirmedFactsHash,
    approvedAt: identity.approvedAt.toISOString(),
    expiresAt: identity.expiresAt.toISOString(),
    ...prompt,
    maxOutputChars: 8_000,
  });
  try {
    return {
      requestSha256: createHash("sha256").update(bytes).digest("hex"),
      request: {
        ...prompt,
        purpose: "cover_letter",
        promptId: "cover_letter",
        promptVersion: PROMPT_VERSIONS.coverLetter,
        categories: ["profile_facts", "job_posting"],
      },
    };
  } finally {
    bytes.fill(0);
  }
}

export type OriginalCoverLetterGenerationOutcome =
  | {
      kind: "ready";
      reference: Readonly<TemporaryMaterialReference>;
      letter: CoverLetterReadyBinding;
    }
  | { kind: "in_progress" }
  | { kind: "failed"; errorCode: "generation_unavailable" | "bindings_changed" };

type Work = Pick<
  PostgresCoverLetterWorkStore,
  | "claimProviderDispatch"
  | "settleProviderDispatch"
  | "settleRejectedProviderDispatch"
  | "settleUndispatchedProviderDispatch"
>;

/** Default-off original foreground actor: owner evidence -> consume an EXISTING dispatch grant
 * -> one SDK call -> positive scalar settlement -> original memory completion. No issue/renew,
 * objects, saved-draft recovery, durable content or database capability. Production must inject
 * authenticated private owner/control ports in a physically bounded memory-session host.
 * One active original promise is admitted, including after timeout/abort; physical host drain
 * remains necessary if a provider never acknowledges. This is not an all-copy purge receipt. */
export class OriginalCoverLetterGenerationActor {
  #active = false;

  constructor(
    private readonly source: CoverLetterEvidenceSource,
    private readonly gateway: Pick<ModelGateway, "generateOriginalWithCompletion">,
    private readonly work: Work,
    private readonly completion: Pick<
      TemporaryCoverLetterService,
      "complete" | "discardCompletion"
    >,
    private readonly enabled: () => boolean = () => false,
    private readonly clock: () => Date = () => new Date(),
    private readonly documentVersion: number = 1,
  ) {}

  async generate(
    input: CoverLetterPreparationIdentity,
    signal?: AbortSignal,
  ): Promise<OriginalCoverLetterGenerationOutcome> {
    if (this.#active) return { kind: "in_progress" };
    if (
      !this.enabled() ||
      signal?.aborted ||
      !Number.isSafeInteger(this.documentVersion) ||
      this.documentVersion < 1 ||
      this.documentVersion > 2_147_483_647
    )
      return { kind: "failed", errorCode: "generation_unavailable" };
    this.#active = true;
    let evidence: Awaited<ReturnType<CoverLetterEvidenceSource["load"]>> | undefined;
    let prepared: ReturnType<typeof prepareOriginalCoverLetterRequest> = null;
    let receipt: OriginalModelGatewayCompletion | undefined;
    let generated: GenerationResult | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const lifetime = new AbortController();
    const contentSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const clearGenerated = () => {
      if (!generated) return;
      for (const paragraph of generated.paragraphs) {
        paragraph.text = "";
        paragraph.factIds.length = 0;
      }
      generated.paragraphs.length = 0;
      generated.findings.length = 0;
      generated.sourceFactIds.length = 0;
    };
    contentSignal.addEventListener("abort", clearGenerated);
    try {
      const identity = structuredClone(input);
      const approved = identity.approvedAt.getTime();
      const expires = identity.expiresAt.getTime();
      const available = () => this.enabled() && !signal?.aborted;
      const fresh = () => {
        const now = this.clock().getTime();
        return Number.isFinite(now) && now >= approved && now < expires;
      };
      if (
        !UUID.test(identity.id) ||
        !UUID.test(identity.ownerUserId) ||
        !UUID.test(identity.applicationId) ||
        !HASH.test(identity.jobContextHash) ||
        !HASH.test(identity.confirmedFactsHash) ||
        identity.noticeVersion !== COVER_LETTER_DISCLOSURE_VERSION ||
        !Number.isFinite(approved) ||
        expires !== approved + 15 * 60_000 ||
        !fresh()
      )
        return { kind: "failed", errorCode: "generation_unavailable" };
      evidence = structuredClone(
        await this.source.load(identity.ownerUserId, identity.applicationId),
      );
      if (!available() || !fresh()) return { kind: "in_progress" };
      const context = { ...evidence, now: this.clock() };
      prepared = prepareOriginalCoverLetterRequest(identity, context);
      if (!prepared) return { kind: "failed", errorCode: "bindings_changed" };
      const claim = await this.work.claimProviderDispatch({
        documentId: identity.id,
        requestSha256: prepared.requestSha256,
        consentExpiresAt: new Date(expires),
      });
      if (claim.kind !== "claimed") return { kind: "in_progress" };
      const reference = structuredClone(claim.reference);
      if (
        !validateProviderControlReference(reference) ||
        reference.documentId !== identity.id ||
        reference.requestSha256 !== prepared.requestSha256
      )
        return { kind: "in_progress" };
      if (!available() || !fresh()) {
        // No gateway/provider call was made after this original claim.
        await this.work.settleUndispatchedProviderDispatch(reference);
        return { kind: "in_progress" };
      }
      const dispatched = this.gateway.generateOriginalWithCompletion(prepared.request, {
        purpose: "cover_letter",
        categories: ["profile_facts", "job_posting"],
        approvedAt: new Date(approved),
      });
      prepared.request.system = "";
      prepared.request.user = "";
      receipt = await dispatched;
      if (receipt.kind === "not_dispatched") {
        await this.work.settleUndispatchedProviderDispatch(reference);
        return { kind: "failed", errorCode: "generation_unavailable" };
      }
      if (receipt.kind === "completed_rejected") {
        await this.work.settleRejectedProviderDispatch(reference);
        return { kind: "failed", errorCode: "generation_unavailable" };
      }
      if (receipt.kind === "completed") {
        if (validateNativeCoverLetterModel(receipt.result.model))
          generated = groundCoverLetterOutput(context, receipt.result);
        receipt.result.value = undefined;
        const remaining =
          receipt.completedAtMs + GENERATED_MATERIAL_LIFETIME_MS - this.clock().getTime();
        if (
          !Number.isFinite(remaining) ||
          remaining <= 0 ||
          remaining > GENERATED_MATERIAL_LIFETIME_MS
        )
          lifetime.abort();
        else expiryTimer = setTimeout(() => lifetime.abort(), remaining);
        if (contentSignal.aborted) clearGenerated();
      }
      // Only actual original fulfillment reaches settlement. Exceptions/abort/deadline never do.
      // Owned generated paragraphs actively expire even while this control acknowledgement waits.
      await this.work.settleProviderDispatch(reference);
      if (receipt.kind === "completed_discarded" || !available() || contentSignal.aborted)
        return { kind: "in_progress" };
      if (generated?.status !== "needs_review")
        return { kind: "failed", errorCode: "generation_unavailable" };
      const completed = await this.completion.complete(
        {
          id: identity.id,
          ownerUserId: identity.ownerUserId,
          applicationId: identity.applicationId,
          version: this.documentVersion,
          jobRevision: identity.jobContextHash,
          confirmedFactsHash: identity.confirmedFactsHash,
        },
        generated,
        receipt.completedAtMs,
        contentSignal,
      );
      if (!available() || contentSignal.aborted) {
        this.completion.discardCompletion(completed.reference);
        return { kind: "in_progress" };
      }
      return { kind: "ready", ...completed };
    } catch {
      // Unknown claim/dispatch/settlement/completion acknowledgements are never retried here.
      return { kind: "in_progress" };
    } finally {
      if (prepared) {
        prepared.request.system = "";
        prepared.request.user = "";
      }
      if (receipt?.kind === "completed") receipt.result.value = undefined;
      if (expiryTimer) clearTimeout(expiryTimer);
      contentSignal.removeEventListener("abort", clearGenerated);
      clearGenerated();
      if (evidence) {
        evidence.job.title = "";
        evidence.job.company = "";
        evidence.job.description = "";
        for (const fact of evidence.facts) fact.value = "";
      }
      this.#active = false;
    }
  }
}
