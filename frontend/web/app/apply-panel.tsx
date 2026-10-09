"use client";

import type { Application, ApplicationResumeFile } from "@ai-job-apply/api-contracts";
import { useEffect, useId, useRef, useState } from "react";
import {
  materialDeadline,
  materialsExpired,
  sameMaterial,
} from "../lib/application-material-lifetime";
import { fetchResumeFile, sha256OfBytes } from "../lib/applications-client";
import { ExtensionApplicationHandoff } from "./extension-application-handoff";
import { ManualFormConfirmation, type ManualFormObservation } from "./manual-form-confirmation";
import { useMaterialExpiry } from "./use-material-expiry";

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

function fileFrom(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const FORMAT_LABEL = { pdf: "PDF", docx: "Word (DOCX)" } as const;

/**
 * Shown once a packet is approved. It does not submit anything: it opens the employer's page and
 * puts the approved answers and the tailored resume within reach so the candidate can complete the
 * application by hand until browser-extension filling exists for the site. Every answer and file is
 * exactly what was approved; a resume that no longer matches the packet is refused, not downloaded.
 */
export function ApplyPanel({
  application,
  applyUrl,
  fetchImplementation,
  onRecordManualSubmission,
  nativeMaterialDownloads = false,
}: {
  application: Application;
  applyUrl?: string | undefined;
  fetchImplementation?: typeof globalThis.fetch;
  onRecordManualSubmission(observation?: ManualFormObservation): Promise<void> | void;
  nativeMaterialDownloads?: boolean;
}) {
  const headingId = useId();
  const [message, setMessage] = useState<string>();
  const [busyFormat, setBusyFormat] = useState<"pdf" | "docx">();
  const [recording, setRecording] = useState(false);
  const [observation, setObservation] = useState<ManualFormObservation>();
  const pending = useRef<AbortController | undefined>(undefined);
  const packet = application.currentPacket;
  const deadlines = packet?.temporaryMaterials?.map(materialDeadline) ?? [];
  const expired = useMaterialExpiry(deadlines.length ? Math.min(...deadlines) : undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changed approval bindings invalidate any held file read.
  useEffect(
    () => () => pending.current?.abort(),
    [application.id, application.revision, application.packetAvailability],
  );
  useEffect(() => {
    if (expired) pending.current?.abort();
  }, [expired]);
  const href = safeApplyUrl(applyUrl);
  const fields = (application.currentPacket?.fields ?? []).filter(
    (field) =>
      field.value !== null &&
      field.value !== undefined &&
      String(field.value) !== "" &&
      !field.fieldKey.startsWith("document."),
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

  async function download(format: "pdf" | "docx") {
    if (pending.current || materialsExpired(packet?.temporaryMaterials)) return;
    const controller = new AbortController();
    let heldBytes: Uint8Array | undefined;
    pending.current = controller;
    setBusyFormat(format);
    setMessage(undefined);
    try {
      const result = await fetchResumeFile(application.id, format, {
        signal: controller.signal,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const file: ApplicationResumeFile = result.file;
      const expectedMaterial = packet?.temporaryMaterials?.find(
        (material) => material.kind === "tailored_resume",
      );
      if (
        controller.signal.aborted ||
        file.format !== format ||
        file.contentSha256 !== packet?.artifactHashes.resume ||
        Boolean(expectedMaterial) !== Boolean(file.temporaryMaterial) ||
        (expectedMaterial && !sameMaterial(file.temporaryMaterial, expectedMaterial)) ||
        materialsExpired(file.temporaryMaterial ? [file.temporaryMaterial] : undefined)
      ) {
        setMessage("The resume changed or expired. Prepare and review it again.");
        return;
      }
      const bytes = fileFrom(file.contentBase64);
      heldBytes = bytes;
      file.contentBase64 = "";
      // The file must be exactly the bytes the platform said it verified.
      if (
        bytes.byteLength !== file.sizeBytes ||
        (await sha256OfBytes(bytes)) !== file.sha256 ||
        controller.signal.aborted ||
        materialsExpired(packet?.temporaryMaterials) ||
        materialsExpired(file.temporaryMaterial ? [file.temporaryMaterial] : undefined)
      ) {
        setMessage("The resume file did not pass its check, so it was not downloaded.");
        return;
      }
      const url = URL.createObjectURL(
        new Blob([bytes.buffer as ArrayBuffer], { type: file.mediaType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.rel = "noopener";
      try {
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      setMessage(`${file.fileName} downloaded.`);
    } catch {
      if (!controller.signal.aborted) setMessage("The resume could not be downloaded. Try again.");
    } finally {
      heldBytes?.fill(0);
      if (pending.current === controller) pending.current = undefined;
      setBusyFormat(undefined);
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
      <h3 id={headingId}>Apply</h3>
      <p>
        Your application is approved and ready. Nothing is sent for you yet: automatic filling from
        the browser extension is not available for this site. Open the application page, then use
        your approved answers and resume below.
      </p>
      {expired ? (
        <p role="alert">
          Generated materials expired. Prepare and review a new packet before applying. Files you
          already downloaded or sent are outside platform cleanup.
        </p>
      ) : null}
      {!expired ? <ExtensionApplicationHandoff application={application} /> : null}
      {href && !expired ? (
        <p>
          <a href={href} target="_blank" rel="noopener noreferrer">
            Open the application page (opens in a new tab)
          </a>
        </p>
      ) : (
        <p>
          We do not have a safe link to this application page. Find the job on the employer's site.
        </p>
      )}

      {!nativeMaterialDownloads && !expired && application.currentPacket?.artifactHashes.resume ? (
        <div>
          <h4>Your tailored resume</h4>
          <p>Exactly the version you reviewed. Upload it on the application page.</p>
          {(["pdf", "docx"] as const).map((format) => (
            <button
              key={format}
              type="button"
              disabled={busyFormat !== undefined}
              onClick={() => void download(format)}
            >
              {busyFormat === format ? "Preparing..." : `Download ${FORMAT_LABEL[format]}`}
            </button>
          ))}
        </div>
      ) : null}

      {!expired && fields.length > 0 ? (
        <div>
          <h4>Your approved answers</h4>
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
        </div>
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
          disabled={
            recording ||
            busyFormat !== undefined ||
            expired ||
            Boolean(packet?.form && !observation)
          }
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
