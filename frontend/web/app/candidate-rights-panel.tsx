"use client";

import {
  type AccountDeletionRequest,
  type CandidateDataExport,
  type CandidateDataExportAccess,
  type CandidateDataExportDownloadGrant,
  compileComponentValidator,
} from "@ai-job-apply/api-contracts";
import { useEffect, useRef, useState } from "react";
import { candidateRightsReauthenticationPath } from "../lib/candidate-rights-reauthentication";

const validateExport = compileComponentValidator("CandidateDataExport");
const validateExportAccess = compileComponentValidator("CandidateDataExportAccess");
const validateDeletion = compileComponentValidator("AccountDeletionRequest");
const requestTimeoutMilliseconds = 20_000;

interface Intent {
  idempotencyKey: string;
  body: string;
}

interface ExportAccessView {
  export: CandidateDataExport;
  download?: CandidateDataExportDownloadGrant;
}

async function exactJson<T>(
  path: string,
  init: RequestInit,
  validate: (value: unknown) => boolean,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMilliseconds);
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: { ...init.headers, accept: "application/json" },
    });
    if (!response.ok) {
      try {
        void response.body?.cancel().catch(() => undefined);
      } catch {
        // Candidate-facing copy remains fixed and never consumes an upstream failure body.
      }
      throw new Error(response.status === 401 ? "reauthenticate" : "unavailable");
    }
    const value: unknown = await response.json();
    if (!validate(value)) throw new Error("unavailable");
    return value as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function exactNoContent(path: string, init: RequestInit): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMilliseconds);
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status !== 204 || response.body !== null) {
      try {
        void response.body?.cancel().catch(() => undefined);
      } catch {
        // Fixed candidate-facing copy is used by the caller.
      }
      throw new Error(response.status === 401 ? "reauthenticate" : "unavailable");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function newIntent(body: unknown, prefix: string): Intent {
  return { idempotencyKey: `${prefix}-${crypto.randomUUID()}`, body: JSON.stringify(body) };
}

export function CandidateRightsPanel({ authenticated }: { authenticated: boolean }) {
  const [dataExport, setDataExport] = useState<ExportAccessView | null>(null);
  const [deletion, setDeletion] = useState<AccountDeletionRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const exportIntent = useRef<Intent | null>(null);
  const requestDeletionIntent = useRef<Intent | null>(null);
  const confirmDeletionIntent = useRef<Intent | null>(null);
  const cancelDeletionKey = useRef<string | null>(null);

  useEffect(() => {
    generation.current += 1;
    if (!authenticated) {
      setDataExport(null);
      setDeletion(null);
      setAcknowledged(false);
      setConfirmation("");
      setMessage("");
      exportIntent.current = null;
      requestDeletionIntent.current = null;
      confirmDeletionIntent.current = null;
      cancelDeletionKey.current = null;
    }
  }, [authenticated]);

  const run = async (name: string, work: (owner: number) => Promise<void>) => {
    const owner = generation.current;
    setBusy(name);
    setMessage("");
    try {
      await work(owner);
    } catch (error) {
      if (owner !== generation.current) return;
      setMessage(
        error instanceof Error && error.message === "reauthenticate"
          ? "Sign in again with recent multi-factor authentication to continue."
          : "Account privacy controls are temporarily unavailable. Your last request may still be processing; retrying is safe.",
      );
    } finally {
      if (owner === generation.current) setBusy(null);
    }
  };

  const createExport = () =>
    run("export", async (owner) => {
      exportIntent.current ??= newIntent(
        { format: "candidate-data-export-v1" },
        "candidate-export",
      );
      const result = await exactJson<CandidateDataExport>(
        "/api/platform/data-exports",
        {
          method: "POST",
          body: exportIntent.current.body,
          headers: {
            "content-type": "application/json",
            "idempotency-key": exportIntent.current.idempotencyKey,
          },
        },
        validateExport,
      );
      if (owner !== generation.current) return;
      setDataExport({ export: result });
      exportIntent.current = null;
      setMessage("Your portable data export was requested.");
    });

  const refreshExport = () => {
    if (!dataExport) return;
    void run("export-refresh", async (owner) => {
      const result = await exactJson<CandidateDataExportAccess>(
        `/api/platform/data-exports/${dataExport.export.id}`,
        { method: "GET" },
        validateExportAccess,
      );
      if (owner !== generation.current) return;
      setDataExport(result);
      setMessage(
        result.export.state === "ready"
          ? "Your export is ready for its limited download window."
          : `Your export is ${result.export.state.replaceAll("_", " ")}.`,
      );
    });
  };

  const createDeletion = () =>
    run("deletion-request", async (owner) => {
      requestDeletionIntent.current ??= newIntent(
        { acknowledgement: "ACCOUNT_DELETION_IS_IRREVERSIBLE" },
        "account-deletion-request",
      );
      const result = await exactJson<AccountDeletionRequest>(
        "/api/platform/account-deletion-requests",
        {
          method: "POST",
          body: requestDeletionIntent.current.body,
          headers: {
            "content-type": "application/json",
            "idempotency-key": requestDeletionIntent.current.idempotencyKey,
          },
        },
        validateDeletion,
      );
      if (owner !== generation.current) return;
      setDeletion(result);
      requestDeletionIntent.current = null;
      setMessage("The deletion request is created but not confirmed. You may still cancel it.");
    });

  const cancelDeletion = () => {
    if (deletion?.state !== "requested") return;
    void run("deletion-cancel", async (owner) => {
      cancelDeletionKey.current ??= `account-deletion-cancel-${crypto.randomUUID()}`;
      await exactNoContent(`/api/platform/account-deletion-requests/${deletion.id}`, {
        method: "DELETE",
        headers: {
          "idempotency-key": cancelDeletionKey.current,
          "if-match": `"${deletion.version}"`,
        },
      });
      if (owner !== generation.current) return;
      setDeletion(null);
      setAcknowledged(false);
      setConfirmation("");
      cancelDeletionKey.current = null;
      setMessage("The unconfirmed deletion request was cancelled.");
    });
  };

  const confirmDeletion = () => {
    if (deletion?.state !== "requested" || confirmation !== "DELETE_MY_ACCOUNT") return;
    void run("deletion-confirm", async (owner) => {
      confirmDeletionIntent.current ??= newIntent(
        { expectedVersion: deletion.version, confirmation: "DELETE_MY_ACCOUNT" },
        "account-deletion-confirm",
      );
      const result = await exactJson<AccountDeletionRequest>(
        `/api/platform/account-deletion-requests/${deletion.id}/confirm`,
        {
          method: "POST",
          body: confirmDeletionIntent.current.body,
          headers: {
            "content-type": "application/json",
            "idempotency-key": confirmDeletionIntent.current.idempotencyKey,
          },
        },
        validateDeletion,
      );
      if (owner !== generation.current) return;
      setDeletion(result);
      confirmDeletionIntent.current = null;
      setMessage("Your account is quarantined and irreversible deletion is processing.");
    });
  };

  const refreshDeletion = () => {
    if (!deletion) return;
    void run("deletion-refresh", async (owner) => {
      const result = await exactJson<AccountDeletionRequest>(
        `/api/platform/account-deletion-requests/${deletion.id}`,
        { method: "GET" },
        validateDeletion,
      );
      if (owner !== generation.current) return;
      setDeletion(result);
      setMessage(`Account deletion is ${result.state.replaceAll("_", " ")}.`);
    });
  };

  if (!authenticated) return null;

  return (
    <section className="candidate-rights" aria-labelledby="candidate-rights-heading">
      <h2 id="candidate-rights-heading">Your data and account</h2>
      <p>
        Requests and account changes require a recent sign-in. Permanent deletion also requires
        multi-factor authentication.
      </p>
      <a href={candidateRightsReauthenticationPath}>Refresh identity verification with MFA</a>
      <div className="candidate-rights-card">
        <h3>Portable data export</h3>
        <p>Request a structured copy of the candidate data held by the current platform owners.</p>
        {!dataExport ? (
          <button type="button" disabled={busy !== null} onClick={() => void createExport()}>
            Request my data export
          </button>
        ) : (
          <div className="candidate-rights-actions">
            <p>Export status: {dataExport.export.state.replaceAll("_", " ")}</p>
            <button type="button" disabled={busy !== null} onClick={refreshExport}>
              Check export status
            </button>
            {dataExport.download && (
              <a href={dataExport.download.url} rel="noreferrer" download>
                Download my export
              </a>
            )}
          </div>
        )}
      </div>

      <div className="candidate-rights-card danger-zone">
        <h3>Delete account</h3>
        <p>
          Confirmation immediately quarantines the account and starts irreversible deletion from
          active systems. Backup aging continues for the policy-defined period.
        </p>
        {!deletion ? (
          <>
            <label className="acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I understand that confirmed account deletion cannot be undone.
            </label>
            <button
              type="button"
              disabled={!acknowledged || busy !== null}
              onClick={() => void createDeletion()}
            >
              Start account deletion
            </button>
          </>
        ) : (
          <div className="candidate-rights-actions">
            <p>Deletion status: {deletion.state.replaceAll("_", " ")}</p>
            {deletion.state === "requested" && (
              <>
                <label>
                  Type DELETE_MY_ACCOUNT to confirm
                  <input
                    value={confirmation}
                    autoComplete="off"
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
                <a href={candidateRightsReauthenticationPath}>
                  Verify with MFA before permanent deletion
                </a>
                <button
                  type="button"
                  disabled={confirmation !== "DELETE_MY_ACCOUNT" || busy !== null}
                  onClick={confirmDeletion}
                >
                  Permanently delete my account
                </button>
                <button type="button" disabled={busy !== null} onClick={cancelDeletion}>
                  Cancel deletion request
                </button>
              </>
            )}
            {deletion.state !== "requested" && (
              <button type="button" disabled={busy !== null} onClick={refreshDeletion}>
                Check deletion status
              </button>
            )}
          </div>
        )}
      </div>
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
