"use client";

import type {
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  ResumeDocument,
  ResumeDocumentCollection,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

const MAXIMUM_RESUME_BYTES = 5 * 1024 * 1024;
const PDF = "application/pdf" as const;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const problem = (await response.json()) as { detail?: string; title?: string };
    throw new Error(problem.detail ?? problem.title ?? "The resume request failed");
  }
  return (await response.json()) as T;
}

function approvedMediaType(file: File): typeof PDF | typeof DOCX {
  const lowerName = file.name.toLowerCase();
  if (file.type === PDF && lowerName.endsWith(".pdf")) return PDF;
  if (file.type === DOCX && lowerName.endsWith(".docx")) return DOCX;
  throw new Error("Choose a PDF or DOCX file whose extension and media type agree.");
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function recoverableResumeIds(
  documents: readonly ResumeDocument[],
  now = Date.now(),
): string[] {
  return documents
    .filter(
      (document) =>
        ["scanning", "parsing"].includes(document.status) ||
        (document.status === "awaiting_upload" &&
          now - Date.parse(document.createdAt) <= 15 * 60 * 1000),
    )
    .map((document) => document.id);
}

export class ResumePollingTargets {
  readonly #ids = new Set<string>();

  add(documentIds: readonly string[]): void {
    for (const documentId of documentIds) this.#ids.add(documentId);
  }

  beginRound(): Set<string> {
    return new Set(this.#ids);
  }

  has(documentId: string): boolean {
    return this.#ids.has(documentId);
  }

  resolve(documentId: string): void {
    this.#ids.delete(documentId);
  }

  roundComplete(round: ReadonlySet<string>): boolean {
    return [...round].every((documentId) => !this.#ids.has(documentId));
  }

  expire(round: ReadonlySet<string>): void {
    for (const documentId of round) this.#ids.delete(documentId);
  }

  get pending(): boolean {
    return this.#ids.size > 0;
  }

  clear(): void {
    this.#ids.clear();
  }
}

export function ResumeUploadForm({
  authenticated,
  onDocumentParsed,
}: {
  authenticated: boolean;
  onDocumentParsed?: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<ResumeDocument[]>([]);
  const [file, setFile] = useState<File>();
  const [loading, setLoading] = useState(authenticated);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>();
  const polling = useRef(false);
  const pollingTargets = useRef(new ResumePollingTargets());
  const mounted = useRef(true);

  const pollUntilTerminal = useCallback(
    async (documentIds: readonly string[]) => {
      if (!authenticated || documentIds.length === 0) return;
      pollingTargets.current.add(documentIds);
      if (polling.current) return;
      polling.current = true;
      const delays = [2_000, 3_000, 5_000, 8_000, 10_000, 15_000, 20_000, 30_000];
      try {
        while (mounted.current && pollingTargets.current.pending) {
          const round = pollingTargets.current.beginRound();
          let completed = false;
          for (const delay of delays) {
            await new Promise((resolve) => window.setTimeout(resolve, delay));
            if (!mounted.current) return;
            const result = await request<ResumeDocumentCollection>("/api/platform/resumes");
            if (!mounted.current) return;
            setDocuments(result.documents);
            let parsed = false;
            for (const document of result.documents) {
              if (
                pollingTargets.current.has(document.id) &&
                !["awaiting_upload", "scanning", "parsing"].includes(document.status)
              ) {
                pollingTargets.current.resolve(document.id);
                parsed ||= document.status === "parsed";
              }
            }
            if (parsed) onDocumentParsed?.();
            if (pollingTargets.current.roundComplete(round)) {
              completed = true;
              break;
            }
          }
          if (!completed) {
            pollingTargets.current.expire(round);
            setMessage(
              "Processing is taking longer than expected. Refresh later; the upload remains safe in quarantine.",
            );
          }
        }
      } catch (error) {
        if (mounted.current) {
          setMessage(error instanceof Error ? error.message : "Could not refresh resume status");
        }
      } finally {
        polling.current = false;
      }
    },
    [authenticated, onDocumentParsed],
  );

  const load = useCallback(async () => {
    if (!authenticated) {
      setLoading(false);
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const result = await request<ResumeDocumentCollection>("/api/platform/resumes");
      setDocuments(result.documents);
      const processingIds = recoverableResumeIds(result.documents);
      void pollUntilTerminal(processingIds);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load resumes");
    } finally {
      setLoading(false);
    }
  }, [authenticated, pollUntilTerminal]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      pollingTargets.current.clear();
    };
  }, [load]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setMessage(undefined);
    try {
      if (file.size < 1 || file.size > MAXIMUM_RESUME_BYTES) {
        throw new Error("Resume files must be between 1 byte and 5 MiB.");
      }
      const mediaType = approvedMediaType(file);
      const metadata: CreateResumeUploadRequest = {
        fileName: file.name,
        mediaType,
        sizeBytes: file.size,
        sha256: await sha256(file),
      };
      const registered = await request<CreateResumeUploadResponse>("/api/platform/resumes", {
        method: "POST",
        headers: { "idempotency-key": `resume-upload-${crypto.randomUUID()}` },
        body: JSON.stringify(metadata),
      });
      const form = new FormData();
      for (const [name, value] of Object.entries(registered.upload.fields)) {
        form.append(name, value);
      }
      form.append("file", file, file.name);
      const uploaded = await fetch(registered.upload.url, {
        method: registered.upload.method,
        body: form,
      });
      if (!uploaded.ok) {
        throw new Error("The encrypted upload was not accepted. Retry with a new upload grant.");
      }
      setFile(undefined);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      setDocuments((current) => [registered.document, ...current]);
      setMessage("Resume uploaded to quarantine. It will be scanned before any text is parsed.");
      void pollUntilTerminal([registered.document.id]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload the resume");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="profile-facts" aria-labelledby="resume-upload-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Resume intake</div>
          <h2 id="resume-upload-heading">Your source resumes</h2>
        </div>
        <span>{documents.length} stored</span>
      </div>
      <p>
        PDF and DOCX files are encrypted, quarantined, and malware-scanned before parsing. Parsed
        claims remain proposed until you review them; nothing is silently confirmed.
      </p>

      {loading ? (
        <p>Loading resumes…</p>
      ) : documents.length === 0 ? (
        <p>No resumes uploaded yet.</p>
      ) : (
        <ul className="fact-list">
          {documents.map((document) => (
            <li key={document.id}>
              <div>
                <strong>{document.fileName}</strong>
                <span aria-live="polite">{statusLabel(document.status)}</span>
                <small>
                  {(document.sizeBytes / 1024).toFixed(1)} KiB
                  {document.pageCount ? ` · ${document.pageCount} pages` : ""}
                  {document.failureCode ? ` · ${statusLabel(document.failureCode)}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="compact-form" onSubmit={upload}>
        <label>
          Resume file
          <span>PDF or DOCX, up to 5 MiB</span>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setFile(event.target.files?.[0])}
            disabled={!authenticated || uploading}
            required
          />
          {file && <span aria-live="polite">Selected file: {file.name}</span>}
        </label>
        <button type="submit" disabled={!authenticated || !file || uploading}>
          {uploading ? "Encrypting and uploading…" : "Upload resume"}
        </button>
      </form>
      {message && <output>{message}</output>}
    </section>
  );
}
