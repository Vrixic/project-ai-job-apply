"use client";

import type {
  CreateResumeUploadRequest,
  CreateResumeUploadResponse,
  ResumeDocument,
  ResumeDocumentCollection,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { candidateSafeProblemMessage } from "../lib/candidate-safe-problem";

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
    throw new Error(await candidateSafeProblemMessage(response, "resume"));
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

async function waitForDelay(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
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
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const sessionGeneration = useRef(0);
  const activeControllers = useRef(new Set<AbortController>());
  const pollingGeneration = useRef<number | undefined>(undefined);
  const pollingTargets = useRef(new ResumePollingTargets());
  const mounted = useRef(true);
  const onDocumentParsedRef = useRef(onDocumentParsed);
  onDocumentParsedRef.current = onDocumentParsed;

  const sessionIsCurrent = useCallback((generation: number, signal?: AbortSignal): boolean => {
    return (
      mounted.current &&
      authenticatedRef.current &&
      generation === sessionGeneration.current &&
      !signal?.aborted
    );
  }, []);

  const createSessionController = useCallback(
    (generation: number): AbortController | undefined => {
      if (!sessionIsCurrent(generation)) return undefined;
      const controller = new AbortController();
      activeControllers.current.add(controller);
      return controller;
    },
    [sessionIsCurrent],
  );

  const releaseSessionController = useCallback((controller: AbortController): void => {
    activeControllers.current.delete(controller);
  }, []);

  const abortSessionRequests = useCallback((): void => {
    for (const controller of activeControllers.current) controller.abort();
    activeControllers.current.clear();
  }, []);

  const pollUntilTerminal = useCallback(
    async (documentIds: readonly string[], generation: number) => {
      if (!sessionIsCurrent(generation) || documentIds.length === 0) return;
      pollingTargets.current.add(documentIds);
      if (pollingGeneration.current === generation) return;
      const controller = createSessionController(generation);
      if (!controller) return;
      pollingGeneration.current = generation;
      const delays = [2_000, 3_000, 5_000, 8_000, 10_000, 15_000, 20_000, 30_000];
      try {
        while (sessionIsCurrent(generation, controller.signal) && pollingTargets.current.pending) {
          const round = pollingTargets.current.beginRound();
          let completed = false;
          for (const delay of delays) {
            await waitForDelay(delay, controller.signal);
            if (!sessionIsCurrent(generation, controller.signal)) return;
            const result = await request<ResumeDocumentCollection>("/api/platform/resumes", {
              signal: controller.signal,
            });
            if (!sessionIsCurrent(generation, controller.signal)) return;
            setDocuments(result.documents);
            let parsed = false;
            let terminalWithoutParsedFacts = false;
            for (const document of result.documents) {
              if (
                pollingTargets.current.has(document.id) &&
                !["awaiting_upload", "scanning", "parsing"].includes(document.status)
              ) {
                pollingTargets.current.resolve(document.id);
                parsed ||= document.status === "parsed";
                terminalWithoutParsedFacts ||= document.status !== "parsed";
              }
            }
            if (parsed) {
              setMessage("Resume parsing finished. Checking for extracted facts to review.");
              onDocumentParsedRef.current?.();
            } else if (terminalWithoutParsedFacts) {
              setMessage(
                "Resume processing finished without parsed facts. Check its status below.",
              );
            }
            if (pollingTargets.current.roundComplete(round)) {
              completed = true;
              break;
            }
          }
          if (!completed) {
            pollingTargets.current.expire(round);
            if (sessionIsCurrent(generation, controller.signal)) {
              setMessage(
                "Processing is taking longer than expected. Refresh later; the upload remains safe in quarantine.",
              );
            }
          }
        }
      } catch (error) {
        if (sessionIsCurrent(generation, controller.signal)) {
          setMessage(error instanceof Error ? error.message : "Could not refresh resume status");
        }
      } finally {
        releaseSessionController(controller);
        if (pollingGeneration.current === generation) pollingGeneration.current = undefined;
      }
    },
    [createSessionController, releaseSessionController, sessionIsCurrent],
  );

  useEffect(() => {
    mounted.current = true;
    const generation = ++sessionGeneration.current;
    abortSessionRequests();
    pollingTargets.current.clear();
    pollingGeneration.current = undefined;

    if (!authenticated) {
      setDocuments([]);
      setFile(undefined);
      setLoading(false);
      setUploading(false);
      setMessage(undefined);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    const controller = createSessionController(generation);
    if (!controller) return;
    setLoading(true);
    void (async () => {
      try {
        const result = await request<ResumeDocumentCollection>("/api/platform/resumes", {
          signal: controller.signal,
        });
        if (!sessionIsCurrent(generation, controller.signal)) return;
        setDocuments(result.documents);
        const processingIds = recoverableResumeIds(result.documents);
        void pollUntilTerminal(processingIds, generation);
      } catch (error) {
        if (sessionIsCurrent(generation, controller.signal)) {
          setMessage(error instanceof Error ? error.message : "Could not load resumes");
        }
      } finally {
        releaseSessionController(controller);
        if (sessionIsCurrent(generation, controller.signal)) setLoading(false);
      }
    })();

    return () => {
      if (sessionGeneration.current === generation) sessionGeneration.current += 1;
      abortSessionRequests();
      pollingTargets.current.clear();
      pollingGeneration.current = undefined;
    };
  }, [
    abortSessionRequests,
    authenticated,
    createSessionController,
    pollUntilTerminal,
    releaseSessionController,
    sessionIsCurrent,
  ]);

  useEffect(
    () => () => {
      mounted.current = false;
      sessionGeneration.current += 1;
      abortSessionRequests();
      pollingTargets.current.clear();
      pollingGeneration.current = undefined;
    },
    [abortSessionRequests],
  );

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedFile = file;
    const generation = sessionGeneration.current;
    if (!selectedFile || !sessionIsCurrent(generation)) return;
    const controller = createSessionController(generation);
    if (!controller) return;
    setUploading(true);
    setMessage(undefined);
    try {
      if (selectedFile.size < 1 || selectedFile.size > MAXIMUM_RESUME_BYTES) {
        throw new Error("Resume files must be between 1 byte and 5 MiB.");
      }
      const mediaType = approvedMediaType(selectedFile);
      const digest = await sha256(selectedFile);
      if (!sessionIsCurrent(generation, controller.signal)) return;
      const metadata: CreateResumeUploadRequest = {
        fileName: selectedFile.name,
        mediaType,
        sizeBytes: selectedFile.size,
        sha256: digest,
      };
      const registered = await request<CreateResumeUploadResponse>("/api/platform/resumes", {
        method: "POST",
        headers: { "idempotency-key": `resume-upload-${crypto.randomUUID()}` },
        body: JSON.stringify(metadata),
        signal: controller.signal,
      });
      if (!sessionIsCurrent(generation, controller.signal)) return;
      const form = new FormData();
      for (const [name, value] of Object.entries(registered.upload.fields)) {
        form.append(name, value);
      }
      form.append("file", selectedFile, selectedFile.name);
      const uploaded = await fetch(registered.upload.url, {
        method: registered.upload.method,
        body: form,
        signal: controller.signal,
      });
      if (!sessionIsCurrent(generation, controller.signal)) return;
      if (!uploaded.ok) {
        throw new Error("The encrypted upload was not accepted. Retry with a new upload grant.");
      }
      setFile(undefined);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      setDocuments((current) => [registered.document, ...current]);
      setMessage("Resume uploaded to quarantine. It will be scanned before any text is parsed.");
      void pollUntilTerminal([registered.document.id], generation);
    } catch (error) {
      if (sessionIsCurrent(generation, controller.signal)) {
        setMessage(error instanceof Error ? error.message : "Could not upload the resume");
      }
    } finally {
      releaseSessionController(controller);
      if (sessionIsCurrent(generation, controller.signal)) setUploading(false);
    }
  }

  const visibleDocuments = authenticated ? documents : [];
  const visibleFile = authenticated ? file : undefined;
  const visibleLoading = authenticated && loading;
  const visibleUploading = authenticated && uploading;
  const visibleMessage = authenticated ? message : undefined;

  return (
    <section className="profile-facts" aria-labelledby="resume-upload-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Resume intake</div>
          <h2 id="resume-upload-heading">Your source resumes</h2>
        </div>
        <span>{visibleDocuments.length} stored</span>
      </div>
      <p>
        PDF and DOCX files are encrypted, quarantined, and malware-scanned before parsing. Parsed
        claims remain proposed until you review them; nothing is silently confirmed.
      </p>

      {visibleLoading ? (
        <p>Loading resumes…</p>
      ) : visibleDocuments.length === 0 ? (
        <p>No resumes uploaded yet.</p>
      ) : (
        <ul className="fact-list">
          {visibleDocuments.map((document) => (
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
            onChange={(event) => {
              if (authenticatedRef.current) {
                setFile(event.target.files?.[0]);
              } else {
                event.target.value = "";
                setFile(undefined);
              }
            }}
            disabled={!authenticated || visibleUploading}
            required
          />
          {visibleFile && <span aria-live="polite">Selected file: {visibleFile.name}</span>}
        </label>
        <button type="submit" disabled={!authenticated || !visibleFile || visibleUploading}>
          {visibleUploading ? "Encrypting and uploading…" : "Upload resume"}
        </button>
      </form>
      {visibleMessage && <output>{visibleMessage}</output>}
    </section>
  );
}
