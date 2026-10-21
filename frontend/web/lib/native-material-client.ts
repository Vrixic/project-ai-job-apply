import {
  type ApplicationCoverLetterFile,
  type ApplicationCoverLetterPreview,
  type ApplicationResumeFile,
  type ApplicationResumePreview,
  type ApplicationTemporaryMaterial,
  compileComponentValidator,
} from "@ai-job-apply/api-contracts";
import { materialDeadline, sameMaterial } from "./application-material-lifetime";

export interface NativeMaterialBinding {
  applicationId: string;
  packetId: string;
  packetHash: string;
  material: ApplicationTemporaryMaterial;
}
export type NativeMaterialValue =
  | ApplicationResumePreview
  | ApplicationCoverLetterPreview
  | ApplicationResumeFile
  | ApplicationCoverLetterFile;

type ReadPhase = "request" | "access" | "service" | "content";
class MaterialReadUnavailable extends Error {
  constructor(readonly phase: ReadPhase) {
    super("MaterialReadUnavailable");
  }
}
const unavailable = (phase: ReadPhase = "content") => new MaterialReadUnavailable(phase);

/** Fixed, value-free copy for a failed read. Never shows upstream text. */
export function nativeMaterialReadFailureCopy(error: unknown): string {
  if (error instanceof MaterialReadUnavailable) {
    if (error.phase === "access")
      return "We could not confirm this resume belongs to your account. Sign in again and try again.";
    if (error.phase === "service")
      return "Your resume could not be loaded right now. Try again before it expires.";
  }
  return "We could not verify your resume. Generate it again.";
}

const MAX_BYTES = 512 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable();
  }
  if (
    response.status !== 200 ||
    response.headers.get("cache-control") !== "no-store" ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      response.headers.get("content-type") ?? "",
    ) ||
    !response.body
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable(response.status === 401 || response.status === 403 ? "access" : "service");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw unavailable();
      if (done) break;
      size += value.byteLength;
      chunks.push(value);
      if (size > MAX_BYTES) throw unavailable();
    }
    const bytes = new Uint8Array(size);
    try {
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    for (const chunk of chunks) chunk.fill(0);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * Same-origin read of one generated material through the authenticated BFF. The browser holds no
 * credential; the BFF performs the owner-authorized native read. Every response is validated
 * against its closed schema and the exact packet, material identity and content hash again here.
 */
export async function readNativeMaterial(
  binding: NativeMaterialBinding,
  format: "preview" | "pdf",
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<NativeMaterialValue> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const original = structuredClone(binding);
  const send = options.fetch ?? fetch;
  const deadline = Math.min(Date.now() + 20_000, materialDeadline(original.material));
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const route = original.material.kind === "tailored_resume" ? "resume" : "cover-letter";
  let phase: ReadPhase = "request";
  try {
    const work = async () => {
      if (
        controller.signal.aborted ||
        Date.now() >= deadline ||
        !UUID.test(original.applicationId) ||
        !UUID.test(original.packetId) ||
        !/^[a-f0-9]{64}$/u.test(original.packetHash) ||
        !compileComponentValidator("ApplicationTemporaryMaterial")(original.material)
      )
        throw unavailable();
      const response = await send(
        `/api/platform/applications/${original.applicationId}/${route}/content?generationId=${original.material.generationId}&packetHash=${original.packetHash}&format=${format}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
        },
      );
      phase = response.status === 401 || response.status === 403 ? "access" : "service";
      const value = await json(response, controller.signal);
      phase = "content";
      const schema =
        original.material.kind === "tailored_resume"
          ? format === "preview"
            ? "ApplicationResumePreview"
            : "ApplicationResumeFile"
          : format === "preview"
            ? "ApplicationCoverLetterPreview"
            : "ApplicationCoverLetterFile";
      if (
        !compileComponentValidator(schema)(value) ||
        controller.signal.aborted ||
        Date.now() >= deadline
      )
        throw unavailable();
      const result = value as NativeMaterialValue;
      if (
        !("temporaryMaterial" in result) ||
        !sameMaterial(result.temporaryMaterial, original.material) ||
        !("contentSha256" in result) ||
        result.contentSha256 !== original.material.contentSha256 ||
        ("status" in result && (result.status !== "ready" || !result.matchesPacket)) ||
        ("format" in result && (result.format !== "pdf" || result.mediaType !== "application/pdf"))
      )
        throw unavailable();
      return result;
    };
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(unavailable());
      else controller.signal.addEventListener("abort", () => reject(unavailable()), { once: true });
    });
    return await Promise.race([work(), aborted]);
  } catch {
    throw unavailable(phase);
  } finally {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
