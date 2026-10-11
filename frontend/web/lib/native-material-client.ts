import type {
  ApplicationCoverLetterFile,
  ApplicationCoverLetterPreview,
  ApplicationResumeFile,
  ApplicationResumePreview,
  ApplicationTemporaryMaterial,
  ApplicationTemporaryMaterialLocation,
} from "@ai-job-apply/api-contracts";
import { materialDeadline, sameMaterial } from "./application-material-lifetime";
import type { NativeMaterialSession } from "./native-material-session";

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

type ReadPhase = "packet" | "location" | "transport" | "content";
class MaterialReadUnavailable extends Error {
  constructor(readonly phase: ReadPhase) {
    super("MaterialReadUnavailable");
  }
}
const unavailable = (phase: ReadPhase = "content") => new MaterialReadUnavailable(phase);

export function nativeMaterialReadFailureCopy(error: unknown): string {
  if (error instanceof MaterialReadUnavailable) {
    if (error.phase === "packet")
      return "This packet could not be verified. Refresh the application before trying again.";
    if (error.phase === "location")
      return "Material availability could not be verified. Refresh the application before trying again.";
    if (error.phase === "transport")
      return "The material connection could not be verified. Sign in with the same account and try again.";
  }
  return "Materials could not be verified. Prepare a new packet and review it again.";
}
const MAX_BYTES = 512 * 1024;

async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable();
  }
  if (
    !response.ok ||
    response.status !== 200 ||
    response.headers.get("cache-control") !== "no-store" ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      response.headers.get("content-type") ?? "",
    ) ||
    !response.body
  )
    throw unavailable();
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

/** Scalar BFF proof -> fixed native HTTPS read -> fresh scalar proof. No content crosses the BFF. */
export async function readNativeMaterial(
  session: NativeMaterialSession,
  binding: NativeMaterialBinding,
  format: "preview" | "pdf" | "docx",
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<NativeMaterialValue> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const original = structuredClone(binding);
  const send = options.fetch ?? fetch;
  const revision = session.revision;
  const deadline = Math.min(Date.now() + 15_000, materialDeadline(original.material));
  const current = () =>
    !controller.signal.aborted &&
    session.ready &&
    session.revision === revision &&
    Date.now() < deadline;
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const route = original.material.kind === "tailored_resume" ? "resume" : "cover-letter";
  let phase: ReadPhase = "packet";
  try {
    const work = async () => {
      if (!current()) throw unavailable();
      const { compileComponentValidator } = await import("@ai-job-apply/api-contracts");
      const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
      if (
        !uuid.test(original.applicationId) ||
        !uuid.test(original.packetId) ||
        !/^[a-f0-9]{64}$/u.test(original.packetHash) ||
        !compileComponentValidator("ApplicationTemporaryMaterial")(original.material)
      )
        throw unavailable();
      const locationValid = compileComponentValidator("ApplicationTemporaryMaterialLocation");
      const location = async () => {
        if (!current()) throw unavailable();
        const response = await send(
          `/api/platform/applications/${original.applicationId}/${route}/location?generationId=${original.material.generationId}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
            signal: controller.signal,
          },
        );
        const value = await json(response, controller.signal);
        if (!current() || !locationValid(value)) throw unavailable();
        const result = value as ApplicationTemporaryMaterialLocation;
        if (
          result.packetId !== original.packetId ||
          result.packetHash !== original.packetHash ||
          !sameMaterial(result.temporaryMaterial, original.material) ||
          new URL(result.origin).origin !== result.origin
        )
          throw unavailable();
        return result;
      };
      phase = "location";
      const before = await location();
      const url = new URL(
        `/v1/applications/${original.applicationId}/${route}${format === "preview" ? "" : `/file?format=${format}`}`,
        before.origin,
      );
      phase = "transport";
      const response = await session.read(url, controller.signal, send);
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
      if (!compileComponentValidator(schema)(value) || !current()) throw unavailable();
      const result = value as NativeMaterialValue;
      if (
        !("temporaryMaterial" in result) ||
        !sameMaterial(result.temporaryMaterial, original.material) ||
        !("contentSha256" in result) ||
        result.contentSha256 !== original.material.contentSha256 ||
        ("status" in result && (result.status !== "ready" || !result.matchesPacket)) ||
        ("format" in result &&
          (result.format !== format ||
            result.mediaType !==
              (format === "pdf"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document")))
      )
        throw unavailable();
      phase = "location";
      if ((await location()).origin !== before.origin) throw unavailable();
      if (!current()) throw unavailable();
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
