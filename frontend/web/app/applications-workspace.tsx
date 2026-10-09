"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  APPLICATIONS_CHANGED_EVENT,
  type ApplicationsCallResult,
  applicationsCall,
  commandKey,
  findLiveApplication,
  sha256Hex,
  startManualApplicationSubmission,
} from "../lib/applications-client";
import { type ApplicationReviewActions, ApplicationReviewPanel } from "./application-review-panel";
import { ApplyPanel } from "./apply-panel";
import { ResumePreviewSection } from "./resume-preview-section";

type Entries = Readonly<Record<string, string | boolean>>;

/**
 * Starts and reviews one application for a job. If the candidate already has a live application
 * for this job it is opened instead of started again. Submission itself is performed later from the
 * browser extension; this surface prepares, reviews, approves, reopens, cancels, starts a manual
 * candidate-attested attempt, and lets the candidate reconcile its result. It never shows upstream
 * text, only fixed copy.
 */
export function ApplicationsWorkspace({
  jobId,
  applyUrl,
  fetchImplementation,
}: {
  jobId: string;
  /** The employer's application page, from the job's own source link. */
  applyUrl?: string | undefined;
  fetchImplementation?: typeof globalThis.fetch;
}) {
  return (
    <JobApplicationWorkspace
      key={jobId}
      jobId={jobId}
      applyUrl={applyUrl}
      {...(fetchImplementation ? { fetchImplementation } : {})}
    />
  );
}

function JobApplicationWorkspace({
  jobId,
  applyUrl,
  fetchImplementation,
}: Parameters<typeof ApplicationsWorkspace>[0]) {
  const headingId = useId();
  const [createKey] = useState(() => `web-create-${crypto.randomUUID()}`);
  const [application, setApplication] = useState<Application>();
  const [entries, setEntries] = useState<Entries>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [availableMaterialGenerations, setAvailableMaterialGenerations] = useState<
    readonly string[]
  >([]);
  const materialReady = useCallback(
    (generationId: string) =>
      setAvailableMaterialGenerations((current) =>
        current.includes(generationId) ? current : [...current, generationId],
      ),
    [],
  );
  const prepareIntent = useRef<{ signature: string; key: string } | undefined>(undefined);
  const reconciliationIntent = useRef<{ signature: string; body: unknown } | undefined>(undefined);
  const lifetime = useRef(new AbortController());
  const starting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const options = {
    get signal() {
      return lifetime.current.signal;
    },
    ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
  };

  // Open the candidate's existing live application for this job, if there is one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per job; `options` is derived from a stable prop.
  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    void findLiveApplication(jobId, { ...options, signal: controller.signal }).then((found) => {
      if (controller.signal.aborted) return;
      if (found.ok && found.application) setApplication(found.application);
      setChecking(false);
    });
    return () => controller.abort();
  }, [jobId]);

  async function refresh(id: string) {
    const latest = await applicationsCall("GET", `/api/platform/applications/${id}`, options);
    if (latest.ok) setApplication(latest.application);
  }

  /** Applies a result to state; a failure sets the fixed copy and throws so the panel shows it too. */
  async function settle(result: ApplicationsCallResult, id?: string): Promise<Application> {
    if (lifetime.current.signal.aborted) throw new Error("Workspace closed");
    if (result.ok) {
      setApplication(result.application);
      if (result.application.status === "applied")
        window.dispatchEvent(new Event(APPLICATIONS_CHANGED_EVENT));
      setNotice(undefined);
      return result.application;
    }
    setNotice(result.message);
    if (result.code === "application_revision_conflict" && id) await refresh(id);
    throw new Error(result.code);
  }

  async function start() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await applicationsCall("POST", "/api/platform/applications", {
        ...options,
        body: { jobId },
        idempotencyKey: createKey,
      });
      if (!result.ok && result.code === "application_already_exists") {
        // A live application appeared since this page loaded: open it instead of failing.
        const found = await findLiveApplication(jobId, options);
        if (found.ok && found.application) {
          setApplication(found.application);
          setNotice("You already have an application for this job. It is open below.");
          return;
        }
      }
      const created = await settle(result);
      await prepare(created, entries);
    } catch {
      // The notice already carries the fixed copy for this failure.
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  /** An application that exists but never got a packet (for example after a failed prepare). */
  async function continuePreparing(current: Application) {
    setBusy(true);
    setNotice(undefined);
    try {
      await prepare(current, entries);
    } catch {
      // The notice already carries the fixed copy for this failure.
    } finally {
      setBusy(false);
    }
  }

  async function prepare(current: Application, answers: Entries) {
    const userEntries = Object.entries(answers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldKey, value]) => ({ fieldKey, value }));
    const signature = JSON.stringify([current.id, current.revision, userEntries]);
    if (prepareIntent.current?.signature !== signature)
      prepareIntent.current = { signature, key: `web-prepare-${crypto.randomUUID()}` };
    const idempotencyKey = prepareIntent.current.key;
    await settle(
      await applicationsCall("POST", `/api/platform/applications/${current.id}/packets`, {
        ...options,
        body: {
          expectedRevision: current.revision,
          ...(userEntries.length ? { userEntries } : {}),
        },
        idempotencyKey,
      }),
      current.id,
    );
  }

  const actions: ApplicationReviewActions | undefined = application
    ? {
        async onApprove({ packetHash, acknowledgedFieldKeys }) {
          await settle(
            await applicationsCall(
              "POST",
              `/api/platform/applications/${application.id}/approval`,
              {
                ...options,
                body: { expectedRevision: application.revision, packetHash, acknowledgedFieldKeys },
                idempotencyKey: commandKey("approve", application.id, application.revision),
              },
            ),
            application.id,
          );
        },
        async onProvideEntry({ fieldKey, value }) {
          const next = { ...entries, [fieldKey]: value };
          setEntries(next);
          await prepare(application, next);
        },
        async onReopen() {
          await settle(
            await applicationsCall("POST", `/api/platform/applications/${application.id}/reopen`, {
              ...options,
              body: { expectedRevision: application.revision },
              idempotencyKey: commandKey("reopen", application.id, application.revision),
            }),
            application.id,
          );
        },
        async onCancel() {
          await settle(
            await applicationsCall("POST", `/api/platform/applications/${application.id}/cancel`, {
              ...options,
              body: { expectedRevision: application.revision },
              idempotencyKey: commandKey("cancel", application.id, application.revision),
            }),
            application.id,
          );
        },
        async onReconcile(input) {
          const path = `/api/platform/applications/${application.id}/attempts/${input.attemptId}/reconciliation`;
          const signature = `${input.attemptId}:${input.kind}`;
          if (reconciliationIntent.current?.signature !== signature) {
            const observedAt = new Date().toISOString();
            const body =
              input.kind === "submitted"
                ? {
                    kind: "user_attested_submitted",
                    observedAt,
                    fingerprintSha256: await sha256Hex(
                      `user-attested:${input.attemptId}:${observedAt}`,
                    ),
                  }
                : { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true };
            reconciliationIntent.current = { signature, body };
          }
          await settle(
            await applicationsCall("POST", path, {
              ...options,
              body: reconciliationIntent.current.body,
              idempotencyKey: commandKey(
                `reconcile-${input.kind}`,
                application.id,
                application.revision,
              ),
            }),
            application.id,
          );
        },
      }
    : undefined;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Apply with review</h2>
      {application && actions ? (
        <>
          {application.currentPacket &&
          application.status !== "applied" &&
          application.status !== "cancelled" ? (
            <ResumePreviewSection
              applicationId={application.id}
              revision={application.revision}
              expectedHash={application.currentPacket.artifactHashes.resume}
              temporaryMaterial={application.currentPacket.temporaryMaterials?.find(
                (material) => material.kind === "tailored_resume",
              )}
              onMaterialReady={materialReady}
              {...(fetchImplementation ? { fetchImplementation } : {})}
              onRefreshPacket={async () => {
                try {
                  await prepare(application, entries);
                } catch {
                  // The notice already carries the fixed copy for this failure.
                }
              }}
            />
          ) : null}
          {application.status === "preparing" && !application.currentPacket ? (
            <button
              type="button"
              onClick={() => void continuePreparing(application)}
              disabled={busy}
            >
              {busy ? "Preparing..." : "Prepare application"}
            </button>
          ) : null}
          <ApplicationReviewPanel
            application={application}
            actions={actions}
            availableMaterialGenerations={availableMaterialGenerations}
          />
          {application.currentAction === "ready_to_submit" ? (
            <ApplyPanel
              application={application}
              applyUrl={applyUrl}
              {...(fetchImplementation ? { fetchImplementation } : {})}
              onRecordManualSubmission={async () => {
                await settle(
                  await startManualApplicationSubmission(
                    application.id,
                    application.revision,
                    options,
                  ),
                  application.id,
                );
              }}
            />
          ) : null}
        </>
      ) : checking ? (
        <p role="status">Checking for an existing application...</p>
      ) : (
        <>
          <p>
            We prepare your answers from confirmed profile facts. You review everything before
            anything is sent, and nothing is submitted from this page.
          </p>
          <button type="button" onClick={() => void start()} disabled={busy}>
            {busy ? "Preparing..." : "Prepare application"}
          </button>
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
