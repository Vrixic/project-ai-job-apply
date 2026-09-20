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
const resumeReadTimeoutMilliseconds = 20_000;
const resumeReadTimeoutMessage = "Loading resume status timed out. Retry to check your resumes.";
const resumeReadFailureMessage = "Resume processing is temporarily unavailable.";
const resumeRegistrationTimeoutMilliseconds = 20_000;
const resumeRegistrationTimeoutMessage =
  "Resume upload registration timed out. Try again to request a new upload grant.";
const resumeStorageTimeoutMilliseconds = 60_000;
const resumeStorageTimeoutMessage =
  "Resume file upload timed out. Try again to request a new upload grant.";
const resumeUploadFailureMessage =
  "Could not upload the resume. Try again with a new upload grant.";

class ResumeUploadCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeUploadCandidateError";
  }
}

class ResumeReadTimeoutError extends Error {
  constructor() {
    super("The resume status request timed out");
    this.name = "ResumeReadTimeoutError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    throw new ResumeUploadCandidateError(await candidateSafeProblemMessage(response, "resume"));
  }
  return (await response.json()) as T;
}

function approvedMediaType(file: File): typeof PDF | typeof DOCX {
  const lowerName = file.name.toLowerCase();
  if (file.type === PDF && lowerName.endsWith(".pdf")) return PDF;
  if (file.type === DOCX && lowerName.endsWith(".docx")) return DOCX;
  throw new ResumeUploadCandidateError(
    "Choose a PDF or DOCX file whose extension and media type agree.",
  );
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

const uploadInProgressMessage =
  "Your resume is still being processed. You can upload another when it finishes.";

/**
 * Whether a new upload may be started, from what the candidate can already see (ADR-032). An unfinished upload always
 * blocks, on every plan; a parsed resume blocks once the plan's stored-resume limit is reached. The server enforces
 * both authoritatively, so an unknown limit (entitlements unavailable) only means the server decides.
 */
export function resumeUploadGate(
  documents: readonly ResumeDocument[],
  maxStoredResumes: number | undefined,
  now = Date.now(),
): { blocked: false } | { blocked: true; message: string } {
  if (recoverableResumeIds(documents, now).length > 0) {
    return { blocked: true, message: uploadInProgressMessage };
  }
  if (maxStoredResumes !== undefined) {
    const stored = documents.filter((document) => document.status === "parsed").length;
    if (stored >= maxStoredResumes) {
      return {
        blocked: true,
        message: `Your plan includes ${maxStoredResumes} stored resume${maxStoredResumes === 1 ? "" : "s"}.`,
      };
    }
  }
  return { blocked: false };
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

interface ResumeUploadOwner {
  controller: AbortController;
  generation: number;
  rejectDeadline: ((reason?: unknown) => void) | undefined;
  timeout: number | undefined;
  timeoutMessage: string | undefined;
}

interface ResumeReadOwner {
  controller: AbortController;
  rejectDeadline: ((reason?: unknown) => void) | undefined;
  timeout: number | undefined;
}

export function ResumeUploadForm({
  authenticated,
  maxStoredResumes,
  onDocumentParsed,
}: {
  authenticated: boolean;
  /** The plan's stored-resume limit from the entitlement summary, when it is known. */
  maxStoredResumes?: number | undefined;
  onDocumentParsed?: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<ResumeDocument[]>([]);
  const [file, setFile] = useState<File>();
  const [loading, setLoading] = useState(authenticated);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>();
  const [readFailure, setReadFailure] = useState<string>();
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const sessionGeneration = useRef(0);
  const documentRevision = useRef(0);
  const activeControllers = useRef(new Set<AbortController>());
  const activeUpload = useRef<ResumeUploadOwner | undefined>(undefined);
  const activeRead = useRef<ResumeReadOwner | undefined>(undefined);
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

  const cancelActiveRead = useCallback((): void => {
    const read = activeRead.current;
    activeRead.current = undefined;
    if (!read) return;
    if (read.timeout !== undefined) window.clearTimeout(read.timeout);
    read.timeout = undefined;
    read.rejectDeadline?.(new Error("resume status request cancelled"));
    read.rejectDeadline = undefined;
    read.controller.abort();
  }, []);

  const cancelActiveUpload = useCallback((): void => {
    const upload = activeUpload.current;
    activeUpload.current = undefined;
    if (!upload) return;
    if (upload.timeout !== undefined) window.clearTimeout(upload.timeout);
    upload.timeout = undefined;
    upload.rejectDeadline?.(new Error("resume upload request cancelled"));
    upload.rejectDeadline = undefined;
    upload.controller.abort();
  }, []);

  const readResumeCollection = useCallback(
    async (controller: AbortController): Promise<ResumeDocumentCollection | undefined> => {
      if (activeRead.current) return undefined;
      const owner: ResumeReadOwner = {
        controller,
        rejectDeadline: undefined,
        timeout: undefined,
      };
      const deadline = new Promise<never>((_resolve, reject) => {
        owner.rejectDeadline = reject;
      });
      activeRead.current = owner;
      owner.timeout = window.setTimeout(() => {
        if (activeRead.current !== owner) return;
        owner.timeout = undefined;
        owner.rejectDeadline?.(new ResumeReadTimeoutError());
        owner.rejectDeadline = undefined;
        owner.controller.abort();
      }, resumeReadTimeoutMilliseconds);
      try {
        return await Promise.race([
          request<ResumeDocumentCollection>("/api/platform/resumes", {
            signal: controller.signal,
          }),
          deadline,
        ]);
      } finally {
        if (owner.timeout !== undefined) window.clearTimeout(owner.timeout);
        owner.timeout = undefined;
        owner.rejectDeadline = undefined;
        if (activeRead.current === owner) activeRead.current = undefined;
      }
    },
    [],
  );

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
            const revision = documentRevision.current;
            const result = await readResumeCollection(controller);
            if (!result) return;
            if (!sessionIsCurrent(generation, controller.signal)) return;
            if (revision !== documentRevision.current) {
              setReadFailure(resumeReadFailureMessage);
              return;
            }
            setReadFailure(undefined);
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
        if (
          sessionIsCurrent(
            generation,
            error instanceof ResumeReadTimeoutError ? undefined : controller.signal,
          )
        ) {
          setReadFailure(
            error instanceof ResumeReadTimeoutError
              ? resumeReadTimeoutMessage
              : resumeReadFailureMessage,
          );
        }
      } finally {
        releaseSessionController(controller);
        if (pollingGeneration.current === generation) pollingGeneration.current = undefined;
      }
    },
    [createSessionController, readResumeCollection, releaseSessionController, sessionIsCurrent],
  );

  const loadDocuments = useCallback(
    async (generation: number): Promise<void> => {
      if (!sessionIsCurrent(generation) || activeRead.current) return;
      const controller = createSessionController(generation);
      if (!controller) return;
      const revision = documentRevision.current;
      setLoading(true);
      setReadFailure(undefined);
      try {
        const result = await readResumeCollection(controller);
        if (!result || !sessionIsCurrent(generation, controller.signal)) return;
        if (revision !== documentRevision.current) {
          setReadFailure(resumeReadFailureMessage);
          return;
        }
        setDocuments(result.documents);
        const processingIds = recoverableResumeIds(result.documents);
        void pollUntilTerminal(processingIds, generation);
      } catch (error) {
        if (
          sessionIsCurrent(
            generation,
            error instanceof ResumeReadTimeoutError ? undefined : controller.signal,
          )
        ) {
          setReadFailure(
            error instanceof ResumeReadTimeoutError
              ? resumeReadTimeoutMessage
              : resumeReadFailureMessage,
          );
        }
      } finally {
        releaseSessionController(controller);
        if (sessionIsCurrent(generation)) setLoading(false);
      }
    },
    [
      createSessionController,
      pollUntilTerminal,
      readResumeCollection,
      releaseSessionController,
      sessionIsCurrent,
    ],
  );

  useEffect(() => {
    mounted.current = true;
    const generation = ++sessionGeneration.current;
    documentRevision.current += 1;
    cancelActiveRead();
    cancelActiveUpload();
    abortSessionRequests();
    pollingTargets.current.clear();
    pollingGeneration.current = undefined;

    if (!authenticated) {
      setDocuments([]);
      setFile(undefined);
      setLoading(false);
      setUploading(false);
      setMessage(undefined);
      setReadFailure(undefined);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    void loadDocuments(generation);

    return () => {
      if (sessionGeneration.current === generation) sessionGeneration.current += 1;
      cancelActiveRead();
      cancelActiveUpload();
      abortSessionRequests();
      pollingTargets.current.clear();
      pollingGeneration.current = undefined;
    };
  }, [abortSessionRequests, authenticated, cancelActiveRead, cancelActiveUpload, loadDocuments]);

  useEffect(
    () => () => {
      mounted.current = false;
      sessionGeneration.current += 1;
      cancelActiveRead();
      cancelActiveUpload();
      abortSessionRequests();
      pollingTargets.current.clear();
      pollingGeneration.current = undefined;
    },
    [abortSessionRequests, cancelActiveRead, cancelActiveUpload],
  );

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedFile = file;
    const generation = sessionGeneration.current;
    if (!selectedFile || !sessionIsCurrent(generation) || activeUpload.current) return;
    const controller = createSessionController(generation);
    if (!controller) return;
    const uploadOwner: ResumeUploadOwner = {
      controller,
      generation,
      rejectDeadline: undefined,
      timeout: undefined,
      timeoutMessage: undefined,
    };
    activeUpload.current = uploadOwner;
    setUploading(true);
    setMessage(undefined);
    async function settleUploadStage<T>(
      operation: () => Promise<T>,
      timeoutMilliseconds: number,
      timeoutMessage: string,
    ): Promise<T> {
      uploadOwner.timeoutMessage = undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        uploadOwner.rejectDeadline = reject;
        uploadOwner.timeout = window.setTimeout(() => {
          if (activeUpload.current !== uploadOwner) return;
          uploadOwner.timeout = undefined;
          uploadOwner.timeoutMessage = timeoutMessage;
          uploadOwner.rejectDeadline?.(new Error(timeoutMessage));
          uploadOwner.rejectDeadline = undefined;
          uploadOwner.controller.abort();
        }, timeoutMilliseconds);
      });
      try {
        return await Promise.race([operation(), deadline]);
      } finally {
        if (uploadOwner.timeout !== undefined) window.clearTimeout(uploadOwner.timeout);
        uploadOwner.timeout = undefined;
        uploadOwner.rejectDeadline = undefined;
      }
    }
    try {
      if (selectedFile.size < 1 || selectedFile.size > MAXIMUM_RESUME_BYTES) {
        throw new ResumeUploadCandidateError("Resume files must be between 1 byte and 5 MiB.");
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
      const registered = await settleUploadStage(
        () =>
          request<CreateResumeUploadResponse>("/api/platform/resumes", {
            method: "POST",
            headers: { "idempotency-key": `resume-upload-${crypto.randomUUID()}` },
            body: JSON.stringify(metadata),
            signal: controller.signal,
          }),
        resumeRegistrationTimeoutMilliseconds,
        resumeRegistrationTimeoutMessage,
      );
      if (!sessionIsCurrent(generation, controller.signal)) return;
      const form = new FormData();
      for (const [name, value] of Object.entries(registered.upload.fields)) {
        form.append(name, value);
      }
      form.append("file", selectedFile, selectedFile.name);
      const uploaded = await settleUploadStage(
        () =>
          fetch(registered.upload.url, {
            method: registered.upload.method,
            body: form,
            signal: controller.signal,
          }),
        resumeStorageTimeoutMilliseconds,
        resumeStorageTimeoutMessage,
      );
      if (!sessionIsCurrent(generation, controller.signal)) return;
      if (uploaded.status !== 204) {
        throw new ResumeUploadCandidateError(
          "The encrypted upload was not accepted. Retry with a new upload grant.",
        );
      }
      setFile(undefined);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      documentRevision.current += 1;
      setDocuments((current) => [registered.document, ...current]);
      setMessage("Resume uploaded to quarantine. It will be scanned before any text is parsed.");
      void pollUntilTerminal([registered.document.id], generation);
    } catch (error) {
      if (
        mounted.current &&
        authenticatedRef.current &&
        generation === sessionGeneration.current &&
        activeUpload.current === uploadOwner
      ) {
        setMessage(
          uploadOwner.timeoutMessage ??
            (error instanceof ResumeUploadCandidateError
              ? error.message
              : resumeUploadFailureMessage),
        );
      }
    } finally {
      releaseSessionController(controller);
      if (activeUpload.current === uploadOwner) {
        activeUpload.current = undefined;
        if (sessionIsCurrent(generation)) setUploading(false);
      }
    }
  }

  const visibleDocuments = authenticated ? documents : [];
  const uploadGate = authenticated
    ? resumeUploadGate(documents, maxStoredResumes)
    : { blocked: false as const };
  const visibleFile = authenticated ? file : undefined;
  const visibleLoading = authenticated && loading;
  const visibleUploading = authenticated && uploading;
  const visibleMessage = authenticated ? message : undefined;
  const visibleReadFailure = authenticated ? readFailure : undefined;

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

      {visibleLoading && visibleDocuments.length === 0 ? (
        <p>Loading resumes…</p>
      ) : visibleDocuments.length === 0 && !visibleReadFailure ? (
        <p>No resumes uploaded yet.</p>
      ) : visibleDocuments.length > 0 ? (
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
      ) : null}

      {visibleReadFailure && !visibleLoading && (
        <div>
          <p role="status">{visibleReadFailure}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadDocuments(sessionGeneration.current)}
          >
            Retry resume status
          </button>
        </div>
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
            disabled={!authenticated || visibleUploading || uploadGate.blocked}
            required
          />
          {visibleFile && <span aria-live="polite">Selected file: {visibleFile.name}</span>}
        </label>
        <button
          type="submit"
          disabled={!authenticated || !visibleFile || visibleUploading || uploadGate.blocked}
        >
          {visibleUploading ? "Encrypting and uploading…" : "Upload resume"}
        </button>
        {uploadGate.blocked && <p role="status">{uploadGate.message}</p>}
      </form>
      {visibleMessage && <output>{visibleMessage}</output>}
    </section>
  );
}
