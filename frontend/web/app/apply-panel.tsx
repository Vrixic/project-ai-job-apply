"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { useId, useState } from "react";
import { materialsExpired } from "../lib/application-material-lifetime";
import { packetResumeSource } from "../lib/apply-flow";
import { ExtensionApplicationHandoff } from "./extension-application-handoff";
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

function labelFor(fieldKey: string): string {
  const words = fieldKey.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function answerText(value: unknown): string {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
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
 * the employer page. A manual path stays available when the extension is not.
 */
export function ApplyPanel({
  application,
  applyUrl,
  handoff = { phase: "none" },
  onStopWaiting,
  onChangeResume,
  onRecordManualSubmission,
  fetchImplementation,
}: {
  application: Application;
  applyUrl?: string | undefined;
  handoff?: ExtensionHandoffState;
  onStopWaiting?: () => void;
  /** Reopens the application so a different resume can be chosen; nothing is lost. */
  onChangeResume?: () => void;
  onRecordManualSubmission(observation?: ManualFormObservation): Promise<void> | void;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const headingId = useId();
  const [message, setMessage] = useState<string>();
  const [recording, setRecording] = useState(false);
  const [observation, setObservation] = useState<ManualFormObservation>();
  const packet = application.currentPacket;
  const href = safeApplyUrl(applyUrl);
  const source = packetResumeSource(packet);
  const expired = materialsExpired(packet?.temporaryMaterials);
  const fields = (packet?.fields ?? []).filter(
    (field) =>
      field.value !== null &&
      field.value !== undefined &&
      String(field.value) !== "" &&
      !/^documents?\./u.test(field.fieldKey),
  );

  async function copy(fieldKey: string, value: string) {
    if (materialsExpired(packet?.temporaryMaterials)) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${labelFor(fieldKey)} copied.`);
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it instead.");
    }
  }

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

  if (application.packetAvailability === "withheld") return null;

  return (
    <section aria-labelledby={headingId} className="apply-panel">
      <h3 id={headingId}>Finish on the employer's page</h3>
      {expired ? (
        <p role="alert">
          Your generated resume expired. Generate it again, or apply with your uploaded resume.
          Files you already downloaded or sent are outside platform cleanup.
        </p>
      ) : null}
      {!expired && handoff.phase !== "none" && handoff.phase !== "unavailable" ? (
        <p role="status">
          {handoff.phase === "waiting_for_extension"
            ? `The employer page is open. Open the ApplyDash extension on it: it already knows this application and will use your ${source === "generated" ? "generated resume (PDF)" : "uploaded resume"}. Waiting for you...`
            : handoff.phase === "resume_sent"
              ? "Your generated resume reached the extension. Open the extension on the employer page to fill the form."
              : `The employer page is open. Open the ApplyDash extension on it: it already knows this application and will use your ${source === "generated" ? "generated resume (PDF)" : "uploaded resume"}.`}
        </p>
      ) : null}
      {!expired && handoff.phase === "unavailable" ? (
        <p role="status">
          The extension did not answer, so nothing was filled for you. Apply on the employer page by
          hand using the details below.
        </p>
      ) : null}
      {handoff.phase === "waiting_for_extension" && onStopWaiting ? (
        <button type="button" onClick={onStopWaiting}>
          Stop waiting for the extension
        </button>
      ) : null}
      {href && !expired ? (
        <p>
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open the employer's page again (opens in a new tab)
          </a>
        </p>
      ) : !href ? (
        <p>
          We do not have a safe link to this application page. Find the job on the employer's site.
        </p>
      ) : null}
      <p>You confirm sensitive answers and the final submit on the employer's page.</p>
      {onChangeResume ? (
        <p>
          <button type="button" className="link-button" onClick={onChangeResume}>
            Choose a different resume
          </button>
        </p>
      ) : null}

      {!expired ? <ExtensionApplicationHandoff application={application} /> : null}

      {!expired && fields.length > 0 ? (
        <details>
          <summary>Your answers, to copy by hand</summary>
          <ul>
            {fields.map((field) => (
              <li key={field.fieldKey}>
                <strong>{labelFor(field.fieldKey)}:</strong> <span>{answerText(field.value)}</span>{" "}
                <button
                  type="button"
                  aria-label={`Copy ${labelFor(field.fieldKey)}`}
                  onClick={() => void copy(field.fieldKey, answerText(field.value))}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div>
        <h4>Record what happened</h4>
        <p>
          {packet?.form
            ? "Confirm the current form and continue here before submitting on the employer site. Then complete the employer application yourself and report what happened."
            : "After you finish or stop on the employer’s site, continue here. We will ask you to confirm whether the application was submitted."}
        </p>
        {!expired && packet?.form ? (
          <ManualFormConfirmation
            key={`${application.id}:${application.revision}`}
            application={application}
            {...(fetchImplementation ? { fetchImplementation } : {})}
            onChange={setObservation}
          />
        ) : null}
        <button
          type="button"
          disabled={recording || expired || Boolean(packet?.form && !observation)}
          onClick={() => void recordManualSubmission()}
        >
          {recording ? "Opening confirmation..." : "Record submission status"}
        </button>
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
