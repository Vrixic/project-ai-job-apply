"use client";

import type {
  Application,
  ApplicationCoverLetterPreview,
  ApplicationTemporaryMaterial,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useId, useState } from "react";
import { materialDeadline } from "../lib/application-material-lifetime";
import { fetchResumeFile, sha256OfBytes } from "../lib/applications-client";
import {
  elapsedSeconds,
  expiresInMinutes,
  formatElapsed,
  GENERATED_RESUME_LIFETIME_MINUTES,
  GENERATION_TYPICAL_DURATION,
  type GenerationView,
  generationFailureCopy,
} from "../lib/apply-flow";
import { keyed } from "../lib/keyed";
import { nativeMaterialReadFailureCopy, readNativeMaterial } from "../lib/native-material-client";
import { ResumePdfViewer } from "./resume-pdf-viewer";
import { useMaterialExpiry } from "./use-material-expiry";

type Packet = NonNullable<Application["currentPacket"]>;

/**
 * The generated-resume step: Generate, then a loading indicator that is honest about the cold start,
 * then the resume itself as a rendered PDF with its fixed expiry, a failure with a retry, or an
 * expiry with one-click regeneration. Only the candidate's own bullets are reordered or trimmed.
 */
export function GeneratedResumePanel({
  application,
  view,
  nativeMaterials,
  nowMs,
  busy,
  fileName,
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
  /** The name a downloaded or attached resume carries: `User_Job_Name_ID.pdf`. */
  fileName: string;
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
          fileName={fileName}
          onGenerate={onGenerate}
          onPreviewShown={onPreviewShown}
          {...(fetchImplementation ? { fetchImplementation } : {})}
        />
      ) : null}
    </section>
  );
}

type Loaded =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; bytes: Uint8Array; contentSha256: string };

function ReadyResume({
  application,
  packet,
  material,
  nativeMaterials,
  nowMs,
  busy,
  fileName,
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
  fileName: string;
  onGenerate(): void;
  onPreviewShown(contentSha256: string): void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  const [displayFailed, setDisplayFailed] = useState(false);
  const [message, setMessage] = useState<string>();
  const resumeHash = packet.artifactHashes.resume;

  // One verified read of the PDF per packet and retry. The same bytes are shown and downloaded, so
  // what the candidate reviews is exactly the file they get.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one verified read per packet and retry.
  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ phase: "loading" });
    setDisplayFailed(false);
    setMessage(undefined);
    const options = {
      signal: controller.signal,
      ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
    };
    let held: Uint8Array | undefined;
    void (async () => {
      try {
        let expectedSha: string;
        let contentSha256: string;
        let size: number;
        let base64: string;
        if (nativeMaterials && material) {
          const value = await readNativeMaterial(
            {
              applicationId: application.id,
              packetId: packet.id,
              packetHash: packet.packetHash,
              material,
            },
            "pdf",
            options,
          );
          if (!("contentBase64" in value) || typeof value.contentBase64 !== "string")
            throw Error("ResumeUnavailable");
          ({ sha256: expectedSha, sizeBytes: size, contentSha256 } = value);
          base64 = value.contentBase64;
          value.contentBase64 = "";
        } else {
          const result = await fetchResumeFile(application.id, "pdf", options);
          if (!result.ok || (resumeHash && result.file.contentSha256 !== resumeHash))
            throw Error("ResumeUnavailable");
          expectedSha = result.file.sha256;
          size = result.file.sizeBytes;
          contentSha256 = result.file.contentSha256;
          base64 = result.file.contentBase64;
        }
        held = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        if (
          held.byteLength !== size ||
          new TextDecoder().decode(held.subarray(0, 5)) !== "%PDF-" ||
          (await sha256OfBytes(held)) !== expectedSha
        )
          throw Error("ResumeUnavailable");
        if (controller.signal.aborted) return;
        setLoaded({ phase: "ready", bytes: held, contentSha256 });
      } catch (error) {
        held?.fill(0);
        held = undefined;
        if (!controller.signal.aborted)
          setLoaded({ phase: "error", message: nativeMaterialReadFailureCopy(error) });
      }
    })();
    return () => {
      controller.abort();
      held?.fill(0);
    };
  }, [application.id, packet.id, packet.packetHash, attempt]);

  const shown = useCallback(() => {
    if (loaded.phase === "ready") onPreviewShown(loaded.contentSha256);
  }, [loaded, onPreviewShown]);

  function download() {
    if (loaded.phase !== "ready" || busy) return;
    setMessage(undefined);
    if (material && Date.now() >= material.expiresAtMs) {
      setMessage("The resume could not be downloaded. Try again.");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([loaded.bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    try {
      document.body.append(anchor);
      anchor.click();
      setMessage(`${fileName} downloaded.`);
    } catch {
      setMessage("The resume could not be downloaded. Try again.");
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="resume-ready">
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
      {loaded.phase === "ready" ? (
        displayFailed ? (
          <p role="alert">
            Your resume is ready but could not be shown here. You can still download it.
          </p>
        ) : (
          <ResumePdfViewer
            bytes={loaded.bytes}
            label="Preview of your tailored resume"
            onRendered={shown}
            onFailed={() => setDisplayFailed(true)}
          />
        )
      ) : null}
      <p>
        <button type="button" disabled={busy || loaded.phase !== "ready"} onClick={download}>
          Download PDF
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
 * button before it exists, then its own preview. The request still carries the disclosure version
 * the Gateway requires; the page itself states only what the step does.
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
        Generates a cover letter based on your resume and the job description.
      </p>
      <button type="button" aria-describedby={descriptionId} disabled={busy} onClick={onGenerate}>
        Generate cover letter
      </button>
    </section>
  );
}
