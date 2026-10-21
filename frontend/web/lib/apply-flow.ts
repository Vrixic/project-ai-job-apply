import type { Application, ApplicationTemporaryMaterial } from "@ai-job-apply/api-contracts";
import { materialDeadline } from "./application-material-lifetime";

type Packet = NonNullable<Application["currentPacket"]>;

/** Generated resumes live 30 minutes; the UI shows the same fixed window. */
export const GENERATED_RESUME_LIFETIME_MINUTES = 30;
/** A cold start of the private generation workspace typically takes this long. */
export const GENERATION_TYPICAL_DURATION = "1 to 2 minutes";
/** The UI stops polling after this long and offers a retry; the server reports a timeout sooner. */
export const GENERATION_POLL_LIMIT_MS = 12 * 60_000;

export type GenerationView =
  | { kind: "idle" }
  | { kind: "preparing"; requestedAtMs?: number }
  | { kind: "ready"; material?: ApplicationTemporaryMaterial }
  | { kind: "failed"; code: "no_resume" | "generation_failed" | "generation_timed_out" }
  | { kind: "expired" };

/** Which resume a packet is bound to. The packet, never the screen, is the authority. */
export function packetResumeSource(packet: Packet | undefined): "generated" | "uploaded" | "none" {
  if (!packet) return "none";
  if (packet.temporaryMaterials?.some((material) => material.kind === "tailored_resume"))
    return "generated";
  const resume = packet.fields.find((field) => field.fieldKey === "documents.resume");
  if (resume && resume.value !== null && resume.origin === "confirmed_fact") return "uploaded";
  return packet.artifactHashes.resume ? "generated" : "none";
}

/**
 * The honest state of the generated resume. A generated resume the packet carries is ready until
 * its fixed expiry, judged on this device's clock too so an idle page never shows an expired file
 * as usable. Without one, the server's own generation status decides.
 */
export function generationView(
  application: Application | undefined,
  nativeMaterials: boolean,
  nowMs: number,
): GenerationView {
  const packet = application?.currentPacket;
  if (!application || !packet || application.packetAvailability === "withheld")
    return { kind: "idle" };
  const material = packet.temporaryMaterials?.find((item) => item.kind === "tailored_resume");
  if (material)
    return nowMs < materialDeadline(material) ? { kind: "ready", material } : { kind: "expired" };
  if (!nativeMaterials)
    return packetResumeSource(packet) === "generated" ? { kind: "ready" } : { kind: "idle" };
  const generation = application.resumeGeneration;
  switch (generation?.state) {
    case "preparing":
      return {
        kind: "preparing",
        ...(generation.requestedAt ? { requestedAtMs: Date.parse(generation.requestedAt) } : {}),
      };
    case "failed":
      return { kind: "failed", code: generation.errorCode ?? "generation_failed" };
    case "expired":
      return { kind: "expired" };
    default:
      return { kind: "idle" };
  }
}

export interface ApplyPlan {
  /** The resume the employer application will use. */
  resume: "generated" | "uploaded";
  /** The current packet is bound to a different resume, so a new packet is built first. */
  needsNewPacket: boolean;
}

/** Generated when a valid generated resume exists; otherwise the candidate's own uploaded resume. */
export function applyPlan(application: Application | undefined, view: GenerationView): ApplyPlan {
  const source = packetResumeSource(application?.currentPacket);
  if (view.kind === "ready") return { resume: "generated", needsNewPacket: false };
  return { resume: "uploaded", needsNewPacket: source !== "uploaded" };
}

export function expiresInMinutes(material: ApplicationTemporaryMaterial, nowMs: number): number {
  return Math.max(0, Math.ceil((materialDeadline(material) - nowMs) / 60_000));
}

/** Elapsed whole seconds, never negative, for the honest "started N ago" line. */
export function elapsedSeconds(startedAtMs: number | undefined, nowMs: number): number {
  return startedAtMs === undefined ? 0 : Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

export function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Fixed copy for a failed generation. Never shows upstream text. */
export function generationFailureCopy(
  code: "no_resume" | "generation_failed" | "generation_timed_out",
) {
  if (code === "no_resume")
    return "We could not find an uploaded resume to tailor. Add a resume to your profile, then try again.";
  if (code === "generation_timed_out")
    return "Generating your resume took longer than expected, so we stopped waiting. Nothing was lost; try again.";
  return "We could not generate your resume this time. Nothing was changed; try again.";
}
