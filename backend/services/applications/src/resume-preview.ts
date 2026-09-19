import type { ApplicationResumeFile, ApplicationResumePreview } from "@ai-job-apply/api-contracts";

/** What the Documents runtime reports for one job, before it is compared with the packet. */
export type ResumePreviewBody = Omit<ApplicationResumePreview, "matchesPacket">;

/**
 * Owner-scoped tailored-resume preview for an application's job. The Applications module never
 * reads resume text itself: an implementation asks the Documents runtime (ADR-031), which returns
 * the candidate's own text only in this owner's response. Nothing is stored.
 */
export interface ResumePreviewSource {
  preview(input: { ownerUserId: string; jobId: string }): Promise<ResumePreviewBody>;
  /** One verified rendering, or nothing when there is no resume or it cannot be rendered. */
  file(input: {
    ownerUserId: string;
    jobId: string;
    format: ApplicationResumeFile["format"];
  }): Promise<ResumeFileBody | undefined>;
}

export type ResumeFileBody = Omit<ApplicationResumeFile, "fileName"> & { baseFileName: string };

/** A safe download name derived from the candidate's own file name; never a path. */
export function tailoredFileName(baseFileName: string, format: ApplicationResumeFile["format"]) {
  const stem = baseFileName
    .replace(/\.[A-Za-z0-9]{1,5}$/u, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `${stem || "resume"}-tailored.${format}`;
}

/**
 * `matchesPacket` is true only when the packet already carries this exact tailored resume. It is
 * false when no packet exists, no resume is attached, or the resume, the job text, or the tailoring
 * version changed since the packet was prepared, which is when approval must be requested again.
 */
export function withPacketMatch(
  body: ResumePreviewBody,
  packetResumeHash: string | undefined,
): ApplicationResumePreview {
  return {
    ...body,
    matchesPacket:
      body.status === "ready" &&
      body.contentSha256 !== undefined &&
      packetResumeHash !== undefined &&
      body.contentSha256 === packetResumeHash,
  };
}
