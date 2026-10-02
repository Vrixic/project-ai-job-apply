import { COVER_LETTER_DISCLOSURE_VERSION } from "@ai-job-apply/api-contracts";
import type { CoverLetterDraftRecoveryService } from "./cover-letter-draft-recovery.js";
import type {
  CoverLetterGenerationOutcome,
  CoverLetterPreparationIdentity,
} from "./cover-letter-generation.js";
import { validateCoverLetterProviderInput } from "./cover-letter-provider-contract.js";
import type { CoverLetterProviderInitializer } from "./cover-letter-provider-initialize.js";
import type { CoverLetterProviderInvoker } from "./cover-letter-provider-invoke.js";
import type { PostgresCoverLetterStore } from "./cover-letter-store.js";
import type { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;

/**
 * Private source-only orchestration. No public API, model or provider-object write capability.
 * Only the original committed grant winner may Invoke once. All retries recover original work;
 * local cancellation or an Invoke response never settles work or proves remote quiescence.
 * Runtime/authenticated control/IAM and retention must precede production composition.
 */
export class CoverLetterPreparationService {
  constructor(
    private readonly store: Pick<PostgresCoverLetterStore, "generationMetadata">,
    private readonly initializer: Pick<CoverLetterProviderInitializer, "initialize">,
    private readonly work: Pick<PostgresCoverLetterWorkStore, "issueProviderDispatch">,
    private readonly provider: Pick<CoverLetterProviderInvoker, "invoke">,
    private readonly recovery: Pick<CoverLetterDraftRecoveryService, "recover">,
    private readonly enabled: () => boolean = () => false,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async generate(
    input: CoverLetterPreparationIdentity,
    signal?: AbortSignal,
  ): Promise<CoverLetterGenerationOutcome> {
    if (!this.enabled()) return { kind: "failed", errorCode: "generation_unavailable" };
    const identity = structuredClone(input);
    const approved = identity.approvedAt.getTime();
    const expires = identity.expiresAt.getTime();
    const now = this.clock().getTime();
    if (
      !UUID.test(identity.id) ||
      !UUID.test(identity.ownerUserId) ||
      !UUID.test(identity.applicationId) ||
      !HASH.test(identity.jobContextHash) ||
      !HASH.test(identity.confirmedFactsHash)
    )
      return { kind: "failed", errorCode: "generation_unavailable" };
    if (
      identity.noticeVersion !== COVER_LETTER_DISCLOSURE_VERSION ||
      !Number.isFinite(approved) ||
      !Number.isFinite(expires) ||
      !Number.isFinite(now) ||
      expires !== approved + 15 * 60_000 ||
      now < approved
    )
      return { kind: "failed", errorCode: "disclosure_expired" };
    const available = () => this.enabled() && !signal?.aborted;
    const fresh = () => {
      const at = this.clock().getTime();
      return Number.isFinite(at) && at >= approved && at < expires;
    };
    try {
      if (!available()) return { kind: "in_progress" };
      const existing = await this.store.generationMetadata({
        id: identity.id,
        ownerUserId: identity.ownerUserId,
        applicationId: identity.applicationId,
        jobRevision: identity.jobContextHash,
        confirmedFactsHash: identity.confirmedFactsHash,
      });
      if (!available()) return { kind: "in_progress" };
      if (existing) {
        // Recovery is permitted after original consent expires. It cannot reserve or Invoke.
        const recovered = await this.recovery.recover(structuredClone(identity));
        if (recovered.kind !== "in_progress") return recovered;
      }
      if (!available()) return { kind: "in_progress" };
      if (!fresh()) return { kind: "failed", errorCode: "disclosure_expired" };
      const initialized = await this.initializer.initialize(structuredClone(identity));
      if (initialized.kind !== "initialized") return initialized;
      const invocation = structuredClone(initialized.input);
      if (!validateCoverLetterProviderInput(invocation) || invocation.documentId !== identity.id)
        return { kind: "in_progress" };
      if (!available() || !fresh()) return { kind: "in_progress" };
      // Await the committed control result, never race it against a local deadline/abort.
      // The store checks original slot settlement and exact owner/hash/consent under lock.
      const issued = await this.work.issueProviderDispatch({
        ownerUserId: identity.ownerUserId,
        documentId: identity.id,
        requestSha256: invocation.request.sha256,
        consentExpiresAt: new Date(identity.expiresAt),
      });
      if (!available()) return { kind: "in_progress" };
      if (issued.kind === "issued") {
        const reference = structuredClone(issued.reference);
        if (
          !UUID.test(reference.id) ||
          reference.documentId !== identity.id ||
          reference.purpose !== "provider_dispatch" ||
          reference.requestSha256 !== invocation.request.sha256 ||
          !fresh()
        )
          return { kind: "in_progress" };
        // Exactly one call, with identifiers/references only. The isolated handler separately
        // consumes this existing grant before dispatch/model effects. No retry in catch/finally.
        await this.provider.invoke(invocation, signal);
      }
      if (!available()) return { kind: "in_progress" };
      // Even a positive Invoke response is not a ready document or settlement authority.
      return await this.recovery.recover(structuredClone(identity));
    } catch {
      // Ambiguous committed grants, Invoke/results and completion remain recoverable; do not
      // expose private diagnostics or turn a lost acknowledgement into another disclosure.
      return { kind: "in_progress" };
    }
  }
}
