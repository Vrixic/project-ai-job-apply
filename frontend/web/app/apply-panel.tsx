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
  onRecordSubmission,
  fetchImplementation,
}: {
  application: Application;
  applyUrl?: string | undefined;
  handoff?: ExtensionHandoffState;
  /** Records what the candidate says happened on the employer's page. One step, no second panel. */
  onRecordSubmission(input: {
    outcome: "submitted" | "not_submitted";
    observation?: ManualFormObservation | undefined;
  }): Promise<void> | void;
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
  // Before recording starts, the generated resume must still be valid. Once an attempt is open
  // (the candidate is already on the employer's page) only the outcome is asked for.
  const starting = application.status === "approved";
  const expired = starting && materialsExpired(packet?.temporaryMaterials);

  function close() {
    setOpen(false);
    setMessage(undefined);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (open) dialog.current?.focus();
  }, [open]);

  const formUnconfirmed = Boolean(
    starting &&
      packet?.form &&
      (!observation || Date.now() >= observation.capturedAtEpochMs + 60_000),
  );

  async function recordSubmission(outcome: "submitted" | "not_submitted") {
    if (expired || formUnconfirmed) return;
    setRecording(true);
    setMessage(undefined);
    try {
      await onRecordSubmission({ outcome, observation });
      setOpen(false);
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

  // A withheld packet grants nothing. With an attempt already open only the outcome is asked for.
  const withheld = application.packetAvailability === "withheld";
  if (withheld && starting) return null;

  const resumeName = source === "generated" ? "generated resume (PDF)" : "uploaded resume";

  return (
    <section aria-labelledby={headingId} className="apply-panel">
      <h3 id={headingId}>Finish on the employer's page</h3>
      {expired ? (
        <p role="alert">
          Your generated resume expired. Generate it again, or apply with your uploaded resume.
        </p>
      ) : application.status === "reconciliation_required" ? (
        <p role="alert">
          We could not confirm whether this was submitted. Do not submit again until you record it.
        </p>
      ) : !starting ? null : handoff.phase === "unavailable" ? (
        <p role="status">The extension did not answer. Finish on the employer's page by hand.</p>
      ) : handoff.phase !== "none" ? (
        <p role="status">
          Open the ApplyDash extension on the employer's page. It will use your {resumeName}.
        </p>
      ) : null}
      {href && !expired && !withheld ? (
        <p>
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open the employer's page (new tab)
          </a>
        </p>
      ) : !href && !withheld ? (
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
              {starting && packet?.form
                ? "Confirm the current form below, then tell us what happened on the employer's site."
                : "Did you submit the application on the employer's site?"}
            </p>
            {starting && packet?.form ? (
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
            <p>If it was not submitted, submitting again later could create a duplicate.</p>
            <div className="modal-actions">
              <button
                type="button"
                disabled={recording || formUnconfirmed}
                onClick={() => void recordSubmission("submitted")}
              >
                I submitted it
              </button>
              <button
                type="button"
                disabled={recording || formUnconfirmed}
                onClick={() => void recordSubmission("not_submitted")}
              >
                It was not submitted
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
