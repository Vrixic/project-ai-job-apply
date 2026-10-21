import type { ApplicationResumeGeneration } from "@ai-job-apply/api-contracts";
import type { TemporaryMaterialReference } from "@ai-job-apply/domain";

/**
 * Generation is bounded by a Fargate cold start (about one to two minutes). A request still without
 * a resume or a positive terminal observation after this long is reported as timed out; the
 * original durable execution is never presumed stopped by this projection.
 */
export const RESUME_GENERATION_TIMEOUT_MS = 10 * 60_000;

/** Metadata of the newest resume-generation request for one application. No content or identifiers. */
export interface ResumeGenerationRequestRow {
  outboxStatus: "pending" | "processing" | "published" | "failed";
  dispatchResult: "started" | "no_resume" | null;
  terminalStatus: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "STOPPED" | null;
  requestedAtMs: number;
}

/**
 * Derives the honest generated-resume state for the current packet from owner metadata only. A
 * generated resume the packet carries is `ready` until its fixed expiry and `expired` afterwards.
 * A packet bound to the candidate's uploaded resume asked for no generation. With neither, the
 * newest request decides between `preparing`, `failed` and `not_requested`.
 */
export function deriveResumeGeneration(input: {
  materials: readonly TemporaryMaterialReference[] | undefined;
  /** The packet binds a resume hash without a generated file: the candidate's uploaded resume. */
  packetResumeHash?: string | undefined;
  request: ResumeGenerationRequestRow | null;
  nowMs: number;
  /** The candidate withdrew native materials after the request, so it can never complete. */
  withdrawnAtMs?: number | undefined;
}): ApplicationResumeGeneration {
  const material = input.materials?.find((candidate) => candidate.kind === "tailored_resume");
  const requestedAt = input.request
    ? new Date(input.request.requestedAtMs).toISOString()
    : undefined;
  if (material) {
    return {
      state: input.nowMs < material.expiresAtMs ? "ready" : "expired",
      requestedAt: requestedAt ?? new Date(material.completedAtMs).toISOString(),
    };
  }
  const request = input.request;
  if (input.packetResumeHash || !request || requestedAt === undefined)
    return { state: "not_requested" };
  const failed = (errorCode: NonNullable<ApplicationResumeGeneration["errorCode"]>) =>
    ({ state: "failed", errorCode, requestedAt }) satisfies ApplicationResumeGeneration;
  if (input.withdrawnAtMs !== undefined && input.withdrawnAtMs >= request.requestedAtMs)
    return failed("generation_failed");
  if (request.dispatchResult === "no_resume") return failed("no_resume");
  if (request.outboxStatus === "failed") return failed("generation_failed");
  if (
    request.terminalStatus === "FAILED" ||
    request.terminalStatus === "STOPPED" ||
    request.terminalStatus === "TIMED_OUT"
  )
    return failed(
      request.terminalStatus === "TIMED_OUT" ? "generation_timed_out" : "generation_failed",
    );
  if (input.nowMs - request.requestedAtMs >= RESUME_GENERATION_TIMEOUT_MS)
    return failed("generation_timed_out");
  return { state: "preparing", requestedAt };
}
