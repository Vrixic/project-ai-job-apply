"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { materialsExpired } from "../lib/application-material-lifetime";
import { packetResumeSource } from "../lib/apply-flow";
import { ManualFormConfirmation, type ManualFormObservation } from "./manual-form-confirmation";

/** Only a plain https link with no credentials is ever offered as the place to apply. */
export function safeApplyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** What the website knows about handing the application to the extension. */
export type ExtensionHandoffState =
  | { phase: "none" }
  | { phase: "armed" }
  | { phase: "waiting_for_extension" }
  | { phase: "resume_sent" }
  | { phase: "unavailable" };

/**
 * Shown once the candidate pressed Apply. The employer page is open and, when the extension is
 * installed, it already knows this application and which resume to use. Nothing is submitted from
 * here or by the extension: the candidate confirms every sensitive answer and the final submit on
 * the employer page. Recording what happened opens a small dialog, so the page stays minimal.
 */
export function ApplyPanel({
  application,
  applyUrl,
  handoff = { phase: "none" },
  onRecordManualSubmission,
  fetchImplementation,
}: {
  application: Application;
  applyUrl?: string | undefined;
  handoff?: ExtensionHandoffState;
  onRecordManualSubmission(observation?: ManualFormObservation): Promise<void> | void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const headingId = useId();
  const dialogHeadingId = useId();
  const [message, setMessage] = useState<string>();
  const [recording, setRecording] = useState(false);
  const [open, setOpen] = useState(false);
  const [observation, setObservation] = useState<ManualFormObservation>();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const packet = application.currentPacket;
  const href = safeApplyUrl(applyUrl);
  const source = packetResumeSource(packet);
  const expired = materialsExpired(packet?.temporaryMaterials);

  function close() {
    setOpen(false);
    setMessage(undefined);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (open) dialog.current?.focus();
  }, [open]);

  async function recordManualSubmission() {
    if (
      expired ||
      (packet?.form && (!observation || Date.now() >= observation.capturedAtEpochMs + 60_000))
    )
      return;
    setRecording(true);
    setMessage(undefined);
    try {
      await onRecordManualSubmission(observation);
    } catch {
      setMessage("That did not go through. Check the application state and try again.");
    } finally {
      setRecording(false);
    }
  }

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep keyboard focus inside the open dialog.
    const items = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), textarea, input, a[href]",
      ) ?? [],
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (application.packetAvailability === "withheld") return null;

  const resumeName = source === "generated" ? "generated resume (PDF)" : "uploaded resume";

  return (
    <section aria-labelledby={headingId} className="apply-panel">
      <h3 id={headingId}>Finish on the employer's page</h3>
      {expired ? (
        <p role="alert">
          Your generated resume expired. Generate it again, or apply with your uploaded resume.
        </p>
      ) : handoff.phase === "unavailable" ? (
        <p role="status">The extension did not answer. Finish on the employer's page by hand.</p>
      ) : handoff.phase !== "none" ? (
        <p role="status">
          Open the ApplyDash extension on the employer's page. It will use your {resumeName}.
        </p>
      ) : null}
      {href && !expired ? (
        <p>
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open the employer's page (new tab)
          </a>
        </p>
      ) : !href ? (
        <p>
          We do not have a safe link to this application page. Find the job on the employer's site.
        </p>
      ) : null}
      <button type="button" ref={trigger} disabled={expired} onClick={() => setOpen(true)}>
        Record submission
      </button>
      {open ? (
        <div className="modal-backdrop">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the dialog handles Escape and Tab for its own focus trap. */}
          <div
            ref={dialog}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogHeadingId}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
          >
            <h4 id={dialogHeadingId}>Record submission</h4>
            <p>
              {packet?.form
                ? "Confirm the current form below, then continue. You submit on the employer's site yourself."
                : "Continue to tell us whether you submitted the application on the employer's site."}
            </p>
            {packet?.form ? (
              <ManualFormConfirmation
                key={`${application.id}:${application.revision}`}
                application={application}
                {...(fetchImplementation ? { fetchImplementation } : {})}
                onChange={setObservation}
              />
            ) : null}
            <p role="status" aria-live="polite">
              {message}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={recording || Boolean(packet?.form && !observation)}
                onClick={() => void recordManualSubmission()}
              >
                {recording ? "Opening..." : "Continue"}
              </button>
              <button type="button" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
