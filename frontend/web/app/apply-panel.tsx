"use client";

import type { Application, ApplicationResumeFile } from "@ai-job-apply/api-contracts";
import { useId, useState } from "react";
import { fetchResumeFile, sha256OfBytes } from "../lib/applications-client";

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
}: {
  application: Application;
  applyUrl?: string | undefined;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  const headingId = useId();
  const [message, setMessage] = useState<string>();
  const [busyFormat, setBusyFormat] = useState<"pdf" | "docx">();
  const href = safeApplyUrl(applyUrl);
  const fields = (application.currentPacket?.fields ?? []).filter(
    (field) => field.value !== undefined && String(field.value) !== "",
  );

  async function copy(fieldKey: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${labelFor(fieldKey)} copied.`);
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it instead.");
    }
  }

  async function download(format: "pdf" | "docx") {
    setBusyFormat(format);
    setMessage(undefined);
    try {
      const result = await fetchResumeFile(application.id, format, {
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const file: ApplicationResumeFile = result.file;
      const bytes = fileFrom(file.contentBase64);
      // The file must be exactly the bytes the platform said it verified.
      if (bytes.byteLength !== file.sizeBytes || (await sha256OfBytes(bytes)) !== file.sha256) {
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
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`${file.fileName} downloaded.`);
    } finally {
      setBusyFormat(undefined);
    }
  }

  return (
    <section aria-labelledby={headingId} className="apply-panel">
      <h3 id={headingId}>Apply</h3>
      <p>
        Your application is approved and ready. Nothing is sent for you yet: automatic filling from
        the browser extension is not available for this site. Open the application page, then use
        your approved answers and resume below.
      </p>
      {href ? (
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

      {application.currentPacket?.artifactHashes.resume ? (
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

      {fields.length > 0 ? (
        <div>
          <h4>Your approved answers</h4>
          <ul>
            {fields.map((field) => (
              <li key={field.fieldKey}>
                <strong>{labelFor(field.fieldKey)}:</strong> <span>{String(field.value)}</span>{" "}
                <button
                  type="button"
                  aria-label={`Copy ${labelFor(field.fieldKey)}`}
                  onClick={() => void copy(field.fieldKey, String(field.value))}
                >
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
