"use client";

import type {
  Application,
  ApplicationCoverLetterPreview,
  ApplicationResumePreview,
  ApplicationTemporaryMaterial,
} from "@ai-job-apply/api-contracts";
import { COVER_LETTER_DISCLOSURE_TEXT } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { materialDeadline } from "../lib/application-material-lifetime";
import { fetchResumeFile, fetchResumePreview, sha256OfBytes } from "../lib/applications-client";
import {
  elapsedSeconds,
  expiresInMinutes,
  formatElapsed,
  GENERATED_RESUME_LIFETIME_MINUTES,
  GENERATION_TYPICAL_DURATION,
  type GenerationView,
  generationFailureCopy,
} from "../lib/apply-flow";
import {
  type NativeMaterialValue,
  nativeMaterialReadFailureCopy,
  readNativeMaterial,
} from "../lib/native-material-client";
import { keyed, ResumePreviewView } from "./resume-preview-section";
import { useMaterialExpiry } from "./use-material-expiry";

type Packet = NonNullable<Application["currentPacket"]>;

type Loaded =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; resume?: ApplicationResumePreview };

/**
 * The generated-resume step: Generate, then a loading indicator that is honest about the cold start,
 * then the resume with its fixed expiry, a failure with a retry, or an expiry with one-click
 * regeneration. It never shows generated wording: only the candidate's own bullets, labelled.
 */
export function GeneratedResumePanel({
  application,
  view,
  nativeMaterials,
  nowMs,
  busy,
  onGenerate,
  onApplyWithUploaded,
  onPreviewShown,
  fetchImplementation,
}: {
  application: Application | undefined;
  view: GenerationView;
  nativeMaterials: boolean;
  nowMs: number;
  busy: boolean;
  onGenerate(): void;
  onApplyWithUploaded(): void;
  /** Called once the exact preview of this packet's resume has been displayed to the candidate. */
  onPreviewShown(contentSha256: string): void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const headingId = useId();
  const packet = application?.currentPacket;
  return (
    <section aria-labelledby={headingId} className="resume-step">
      <h3 id={headingId}>Your resume for this job</h3>
      {view.kind === "idle" ? (
        <>
          <p>
            Apply with your uploaded resume, or generate a version tailored to this job first. We
            only reorder and trim your own bullets. We never add or reword anything.
          </p>
          <button type="button" disabled={busy} onClick={onGenerate}>
            Generate resume
          </button>
        </>
      ) : null}
      {view.kind === "preparing" ? (
        <div className="generating" role="status" aria-live="polite">
          <p className="generating-line">
            <span className="spinner" aria-hidden="true" />
            <strong>Generating your resume</strong>
          </p>
          <p>
            This usually takes {GENERATION_TYPICAL_DURATION}: we start a private, temporary
            workspace for your resume.
            {view.requestedAtMs !== undefined
              ? ` Started ${formatElapsed(elapsedSeconds(view.requestedAtMs, nowMs))} ago.`
              : ""}{" "}
            This page updates by itself.
          </p>
          <p>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={onApplyWithUploaded}
            >
              Skip and apply with my uploaded resume
            </button>
          </p>
        </div>
      ) : null}
      {view.kind === "failed" ? (
        <>
          <p role="alert">{generationFailureCopy(view.code)}</p>
          <p>
            {view.code === "no_resume" ? null : (
              <button type="button" disabled={busy} onClick={onGenerate}>
                Try again
              </button>
            )}{" "}
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={onApplyWithUploaded}
            >
              Apply with my uploaded resume
            </button>
          </p>
        </>
      ) : null}
      {view.kind === "expired" ? (
        <>
          <p role="alert">
            Your generated resume expired and was deleted ({GENERATED_RESUME_LIFETIME_MINUTES}{" "}
            minutes after it was made). Generate it again, or apply with your uploaded resume.
          </p>
          <p>
            <button type="button" disabled={busy} onClick={onGenerate}>
              Generate again
            </button>{" "}
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={onApplyWithUploaded}
            >
              Apply with my uploaded resume
            </button>
          </p>
        </>
      ) : null}
      {view.kind === "ready" && application && packet ? (
        <ReadyResume
          key={`${application.id}:${packet.id}:${packet.packetHash}`}
          application={application}
          packet={packet}
          material={view.material}
          nativeMaterials={nativeMaterials}
          nowMs={nowMs}
          busy={busy}
          onGenerate={onGenerate}
          onPreviewShown={onPreviewShown}
          {...(fetchImplementation ? { fetchImplementation } : {})}
        />
      ) : null}
    </section>
  );
}

function ReadyResume({
  application,
  packet,
  material,
  nativeMaterials,
  nowMs,
  busy,
  onGenerate,
  onPreviewShown,
  fetchImplementation,
}: {
  application: Application;
  packet: Packet;
  material: ApplicationTemporaryMaterial | undefined;
  nativeMaterials: boolean;
  nowMs: number;
  busy: boolean;
  onGenerate(): void;
  onPreviewShown(contentSha256: string): void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  const [message, setMessage] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const resumeHash = packet.artifactHashes.resume;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one verified read per packet and retry.
  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ phase: "loading" });
    const options = {
      signal: controller.signal,
      ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
    };
    void (async () => {
      try {
        let resume: ApplicationResumePreview | undefined;
        if (nativeMaterials && material) {
          const value = await readNativeMaterial(
            {
              applicationId: application.id,
              packetId: packet.id,
              packetHash: packet.packetHash,
              material,
            },
            "preview",
            options,
          );
          resume = value as ApplicationResumePreview;
        } else {
          resume = await fetchResumePreview(application.id, options);
          if (
            resume?.status !== "ready" ||
            !resume.matchesPacket ||
            (resumeHash && resume.contentSha256 !== resumeHash)
          )
            throw Error("ResumeUnavailable");
        }
        if (controller.signal.aborted) return;
        setLoaded({ phase: "ready", ...(resume ? { resume } : {}) });
        if (resume?.status === "ready" && resume.contentSha256)
          onPreviewShown(resume.contentSha256);
      } catch (error) {
        if (!controller.signal.aborted)
          setLoaded({ phase: "error", message: nativeMaterialReadFailureCopy(error) });
      }
    })();
    return () => controller.abort();
  }, [application.id, packet.id, packet.packetHash, attempt]);

  async function download() {
    if (downloading || busy) return;
    setDownloading(true);
    setMessage(undefined);
    let bytes: Uint8Array | undefined;
    try {
      let name = "tailored-resume.pdf";
      let expectedSha: string;
      let base64: string;
      let size: number;
      if (nativeMaterials && material) {
        const value = (await readNativeMaterial(
          {
            applicationId: application.id,
            packetId: packet.id,
            packetHash: packet.packetHash,
            material,
          },
          "pdf",
          fetchImplementation ? { fetch: fetchImplementation } : {},
        )) as NativeMaterialValue & { contentBase64?: string };
        if (!("contentBase64" in value) || typeof value.contentBase64 !== "string")
          throw Error("ResumeUnavailable");
        ({ sha256: expectedSha, sizeBytes: size } = value as { sha256: string; sizeBytes: number });
        base64 = value.contentBase64;
        value.contentBase64 = "";
        name = (value as { fileName: string }).fileName;
      } else {
        const result = await fetchResumeFile(application.id, "pdf", {
          ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
        });
        if (!result.ok || result.file.contentSha256 !== resumeHash)
          throw Error("ResumeUnavailable");
        expectedSha = result.file.sha256;
        size = result.file.sizeBytes;
        base64 = result.file.contentBase64;
        name = result.file.fileName;
      }
      bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      if (bytes.byteLength !== size || (await sha256OfBytes(bytes)) !== expectedSha)
        throw Error("ResumeUnavailable");
      if (material && Date.now() >= material.expiresAtMs) throw Error("ResumeUnavailable");
      const url = URL.createObjectURL(
        new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.rel = "noopener";
      try {
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      if (mounted.current) setMessage(`${name} downloaded.`);
    } catch {
      if (mounted.current) setMessage("The resume could not be downloaded. Try again.");
    } finally {
      bytes?.fill(0);
      if (mounted.current) setDownloading(false);
    }
  }

  return (
    <div>
      {material ? (
        <p className="resume-expiry">
          Generated resume ready. It is deleted {GENERATED_RESUME_LIFETIME_MINUTES} minutes after it
          was made, in about <strong>{expiresInMinutes(material, nowMs)} min</strong>.
        </p>
      ) : (
        <p className="resume-expiry">Tailored resume ready.</p>
      )}
      {loaded.phase === "loading" ? <p role="status">Loading your resume...</p> : null}
      {loaded.phase === "error" ? (
        <>
          <p role="alert">{loaded.message}</p>
          <button type="button" onClick={() => setAttempt((current) => current + 1)}>
            Try loading again
          </button>
        </>
      ) : null}
      {loaded.phase === "ready" && loaded.resume ? (
        <ResumePreviewView preview={loaded.resume} />
      ) : null}
      <p>
        <button
          type="button"
          disabled={busy || downloading || loaded.phase !== "ready"}
          onClick={() => void download()}
        >
          {downloading ? "Preparing..." : "Download PDF"}
        </button>{" "}
        <button type="button" className="link-button" disabled={busy} onClick={onGenerate}>
          Generate again
        </button>
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

export function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  const tick = useCallback(() => setNow(Date.now()), []);
  useEffect(() => {
    if (!active) return;
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, tick]);
  return now;
}

/**
 * The explicit, opt-in cover letter, shown whenever the packet carries one. It is separate from the
 * resume: a cover letter exists only because the candidate asked for it, and it is read through
 * the same authenticated BFF boundary and expires with its own fixed deadline.
 */
export function GeneratedCoverLetterPanel({
  application,
  busy = false,
  onGenerate,
  fetchImplementation,
}: {
  application: Application;
  busy?: boolean;
  /** Drafts a new cover letter. Each draft is its own explicit request. */
  onGenerate?: (() => void) | undefined;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const packet = application.currentPacket;
  const material = packet?.temporaryMaterials?.find((item) => item.kind === "cover_letter");
  const [state, setState] = useState<
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; paragraphs: string[] }
  >({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const expired = useMaterialExpiry(material ? materialDeadline(material) : undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one verified read per packet and retry.
  useEffect(() => {
    if (!packet || !material || expired) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    readNativeMaterial(
      {
        applicationId: application.id,
        packetId: packet.id,
        packetHash: packet.packetHash,
        material,
      },
      "preview",
      {
        signal: controller.signal,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      },
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        const letter = value as ApplicationCoverLetterPreview;
        if (letter.status !== "ready") throw Error("CoverLetterUnavailable");
        setState({ phase: "ready", paragraphs: letter.paragraphs.map((item) => item.text) });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ phase: "error", message: nativeMaterialReadFailureCopy(error) });
      });
    return () => controller.abort();
  }, [application.id, packet?.id, packet?.packetHash, attempt]);
  if (!packet || !material) return null;
  if (expired)
    return (
      <section aria-label="Your cover letter" className="resume-step">
        <p role="alert">Your cover letter expired and was deleted. Generate it again.</p>
        {onGenerate ? (
          <button type="button" disabled={busy} onClick={onGenerate}>
            Generate cover letter
          </button>
        ) : null}
      </section>
    );
  return (
    <section aria-label="Your cover letter" className="resume-step">
      <h3>Your cover letter</h3>
      {state.phase === "loading" ? <p role="status">Loading your cover letter...</p> : null}
      {state.phase === "error" ? (
        <>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={() => setAttempt((current) => current + 1)}>
            Try loading again
          </button>
        </>
      ) : null}
      {state.phase === "ready"
        ? keyed(state.paragraphs, (paragraph) => paragraph).map(({ key, item }) => (
            <p key={key}>{item}</p>
          ))
        : null}
      {onGenerate && state.phase === "ready" ? (
        <p>
          <button type="button" className="link-button" disabled={busy} onClick={onGenerate}>
            Generate again
          </button>
        </p>
      ) : null}
    </section>
  );
}

/**
 * The optional cover letter, laid out like the resume step: a short description and one Generate
 * button before it exists, then its own preview. Pressing Generate is the candidate's explicit
 * permission to send their confirmed career facts and the job text to the model provider; the full
 * terms sit under Details and the same disclosure version is sent with the request.
 */
export function CoverLetterSection({
  application,
  enabled,
  busy,
  onGenerate,
  fetchImplementation,
}: {
  application: Application | undefined;
  enabled: boolean;
  busy: boolean;
  onGenerate(): void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const hasLetter = application?.currentPacket?.temporaryMaterials?.some(
    (item) => item.kind === "cover_letter",
  );
  if (application && hasLetter)
    return (
      <GeneratedCoverLetterPanel
        application={application}
        busy={busy}
        onGenerate={enabled ? onGenerate : undefined}
        {...(fetchImplementation ? { fetchImplementation } : {})}
      />
    );
  if (!enabled) return null;
  return (
    <section aria-labelledby={headingId} className="resume-step">
      <h3 id={headingId}>Cover letter (optional)</h3>
      <p id={descriptionId}>
        Drafted by OpenAI from your confirmed career facts and this job's text. You review it before
        it is used.
      </p>
      <details>
        <summary>Details</summary>
        <p>{COVER_LETTER_DISCLOSURE_TEXT}</p>
      </details>
      <button type="button" aria-describedby={descriptionId} disabled={busy} onClick={onGenerate}>
        Generate cover letter
      </button>
    </section>
  );
}
