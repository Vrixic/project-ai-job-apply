"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { useId, useState } from "react";
import {
  type ApplicationsCallResult,
  applicationsCall,
  commandKey,
  sha256Hex,
} from "../lib/applications-client";
import { type ApplicationReviewActions, ApplicationReviewPanel } from "./application-review-panel";
import { ApplyPanel } from "./apply-panel";
import { ResumePreviewSection } from "./resume-preview-section";

type Entries = Readonly<Record<string, string | boolean>>;

/**
 * Starts and reviews one application for a job. Submission itself is performed later from the
 * browser extension; this surface only prepares, reviews, approves, reopens, cancels, and lets the
 * candidate resolve an ambiguous result. It never shows upstream text, only fixed copy.
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
  const headingId = useId();
  const [createKey] = useState(() => `web-create-${crypto.randomUUID()}`);
  const [application, setApplication] = useState<Application>();
  const [entries, setEntries] = useState<Entries>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const options = fetchImplementation ? { fetch: fetchImplementation } : {};

  async function refresh(id: string) {
    const latest = await applicationsCall("GET", `/api/platform/applications/${id}`, options);
    if (latest.ok) setApplication(latest.application);
  }

  /** Applies a result to state; a failure sets the fixed copy and throws so the panel shows it too. */
  async function settle(result: ApplicationsCallResult, id?: string): Promise<Application> {
    if (result.ok) {
      setApplication(result.application);
      setNotice(undefined);
      return result.application;
    }
    setNotice(result.message);
    if (result.code === "application_revision_conflict" && id) await refresh(id);
    throw new Error(result.code);
  }

  async function start() {
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await settle(
        await applicationsCall("POST", "/api/platform/applications", {
          ...options,
          body: { jobId },
          idempotencyKey: createKey,
        }),
      );
      await prepare(created, entries);
    } catch {
      // The notice already carries the fixed copy for this failure.
    } finally {
      setBusy(false);
    }
  }

  async function prepare(current: Application, answers: Entries) {
    const userEntries = Object.entries(answers).map(([fieldKey, value]) => ({ fieldKey, value }));
    await settle(
      await applicationsCall("POST", `/api/platform/applications/${current.id}/packets`, {
        ...options,
        body: {
          expectedRevision: current.revision,
          ...(userEntries.length ? { userEntries } : {}),
        },
        idempotencyKey: commandKey(`prepare-${userEntries.length}`, current.id, current.revision),
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
          await settle(
            await applicationsCall("POST", path, {
              ...options,
              body,
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
          {application.currentPacket ? (
            <ResumePreviewSection
              applicationId={application.id}
              revision={application.revision}
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
          <ApplicationReviewPanel application={application} actions={actions} />
          {application.currentAction === "ready_to_submit" ? (
            <ApplyPanel
              application={application}
              applyUrl={applyUrl}
              {...(fetchImplementation ? { fetchImplementation } : {})}
            />
          ) : null}
        </>
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
