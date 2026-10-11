"use client";

import {
  type Application,
  type ApplicationPacketPreparation,
  type ApplicationTemporaryMaterial,
  COVER_LETTER_DISCLOSURE_TEXT,
  COVER_LETTER_DISCLOSURE_VERSION,
  type PrepareApplicationPacketRequest,
} from "@ai-job-apply/api-contracts";
import { validateApplication } from "@ai-job-apply/api-contracts/browser-validators";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { sameMaterial } from "../lib/application-material-lifetime";
import {
  preparationFailureCopy,
  prepareApplicationPacket,
} from "../lib/application-preparation-client";
import {
  APPLICATIONS_CHANGED_EVENT,
  type ApplicationsCallResult,
  applicationsCall,
  commandKey,
  findLiveApplication,
  sha256Hex,
  startManualApplicationSubmission,
} from "../lib/applications-client";
import { nativeMaterialConfiguration } from "../lib/native-material-session";
import { ApplicationPreparationProgress } from "./application-preparation-progress";
import { type ApplicationReviewActions, ApplicationReviewPanel } from "./application-review-panel";
import { ApplyPanel } from "./apply-panel";
import { NativeApplicationMaterials } from "./native-application-materials";
import { ResumePreviewSection } from "./resume-preview-section";
import {
  type SavedApplicationAnswerSelection,
  SavedApplicationAnswers,
} from "./saved-application-answers";

type Entries = Readonly<Record<string, string | boolean>>;
const coverLetterUiEnabled = process.env.NEXT_PUBLIC_COVER_LETTER_PREPARATION_UI === "enabled";
const savedAnswersUiEnabled =
  process.env.NEXT_PUBLIC_APPLICATION_SAVED_ANSWER_SELECTION_UI === "enabled";

/**
 * Starts and reviews one application for a job. If the candidate already has a live application
 * for this job it is opened instead of started again. Submission itself is performed later from the
 * browser extension; this surface prepares, reviews, approves, reopens, cancels, starts a manual
 * candidate-attested attempt, and lets the candidate reconcile its result. It never shows upstream
 * text, only fixed copy.
 */
export function ApplicationsWorkspace({
  jobId,
  applicationId,
  applyUrl,
  fetchImplementation,
  coverLetterPreparationEnabled = coverLetterUiEnabled,
  savedAnswerSelectionEnabled = savedAnswersUiEnabled,
}: {
  jobId: string;
  applicationId?: string;
  /** The employer's application page, from the job's own source link. */
  applyUrl?: string | undefined;
  fetchImplementation?: typeof globalThis.fetch;
  coverLetterPreparationEnabled?: boolean;
  savedAnswerSelectionEnabled?: boolean;
}) {
  return (
    <JobApplicationWorkspace
      key={`${jobId}:${applicationId ?? ""}`}
      jobId={jobId}
      {...(applicationId ? { applicationId } : {})}
      applyUrl={applyUrl}
      coverLetterPreparationEnabled={coverLetterPreparationEnabled}
      savedAnswerSelectionEnabled={savedAnswerSelectionEnabled}
      {...(fetchImplementation ? { fetchImplementation } : {})}
    />
  );
}

function JobApplicationWorkspace({
  jobId,
  applicationId,
  applyUrl,
  fetchImplementation,
  coverLetterPreparationEnabled,
  savedAnswerSelectionEnabled,
}: Parameters<typeof ApplicationsWorkspace>[0]) {
  const headingId = useId();
  const [nativeConfiguration] = useState(nativeMaterialConfiguration);
  const [createKey] = useState(() => `web-create-${crypto.randomUUID()}`);
  const [application, setApplication] = useState<Application>();
  const [entries, setEntries] = useState<Entries>({});
  useEffect(() => {
    if (application?.packetAvailability === "withheld") setEntries({});
  }, [application?.packetAvailability]);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [coverLetterRequested, setCoverLetterRequested] = useState(false);
  const [preparation, setPreparation] = useState<ApplicationPacketPreparation>();
  const acceptApplication = useCallback((next: Application) => {
    setApplication((current) =>
      current?.id === next.id && current.revision > next.revision ? current : next,
    );
  }, []);
  const preparationResolved = useCallback(
    (operation: ApplicationPacketPreparation, current: Application) => {
      acceptApplication(current);
      setPreparation(undefined);
      setCoverLetterRequested(false);
      setNotice(
        operation.state === "failed"
          ? preparationFailureCopy(operation.errorCode)
          : "Preparation finished. Review the current packet and its exact generated materials before approving.",
      );
    },
    [acceptApplication],
  );
  const [availableMaterials, setAvailableMaterials] = useState<
    readonly ApplicationTemporaryMaterial[]
  >([]);
  const materialReady = useCallback(
    (material: ApplicationTemporaryMaterial) =>
      setAvailableMaterials((current) =>
        current.some((available) => sameMaterial(available, material))
          ? current
          : [...current, material],
      ),
    [],
  );
  const prepareIntent = useRef<{ signature: string; key: string } | undefined>(undefined);
  const materialsUnavailable = useCallback(() => setAvailableMaterials([]), []);
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
    setLookupFailed(false);
    const timeout = setTimeout(() => {
      controller.abort();
      setChecking(false);
      setLookupFailed(Boolean(applicationId));
    }, 20_000);
    const lookup = async () => {
      if (!applicationId)
        return findLiveApplication(jobId, { ...options, signal: controller.signal });
      const result = await applicationsCall("GET", `/api/platform/applications/${applicationId}`, {
        ...options,
        signal: controller.signal,
      });
      return result.ok &&
        result.application.id === applicationId &&
        result.application.canonicalJobId === jobId
        ? { ok: true as const, application: result.application }
        : { ok: false as const };
    };
    void lookup().then((found) => {
      if (controller.signal.aborted) return;
      clearTimeout(timeout);
      if (found.ok && found.application) setApplication(found.application);
      if (applicationId && (!found.ok || !found.application)) setLookupFailed(true);
      setChecking(false);
    });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [jobId, applicationId, lookupAttempt]);

  // Extension submission changes server state while this workspace is in another tab.
  useEffect(() => {
    const id = application?.id;
    if (
      !id ||
      !["approved", "submitting", "takeover", "reconciliation_required"].includes(
        application.status,
      )
    )
      return;
    let pending: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refreshOnReturn = () => {
      if (disposed || pending || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      pending = controller;
      timer = setTimeout(() => controller.abort(), 10_000);
      void applicationsCall("GET", `/api/platform/applications/${id}`, {
        signal: controller.signal,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      })
        .then((result) => {
          if (
            disposed ||
            controller.signal.aborted ||
            !result.ok ||
            !validateApplication(result.application) ||
            result.application.id !== id ||
            result.application.canonicalJobId !== jobId
          )
            return;
          acceptApplication(result.application);
          if (result.application.status === "applied")
            window.dispatchEvent(new Event(APPLICATIONS_CHANGED_EVENT));
        })
        .finally(() => {
          clearTimeout(timer);
          if (pending === controller) pending = undefined;
        });
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      disposed = true;
      clearTimeout(timer);
      pending?.abort();
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [application?.id, application?.status, jobId, fetchImplementation, acceptApplication]);

  async function refresh(id: string) {
    const latest = await applicationsCall("GET", `/api/platform/applications/${id}`, options);
    if (latest.ok && !lifetime.current.signal.aborted && latest.application.id === id)
      acceptApplication(latest.application);
  }

  async function checkGeneratedResume() {
    if (!application || busy) return;
    setBusy(true);
    setNotice(undefined);
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.current.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 10_000);
    try {
      const result = await applicationsCall("GET", `/api/platform/applications/${application.id}`, {
        ...options,
        signal: controller.signal,
      });
      if (lifetime.current.signal.aborted) return;
      if (
        controller.signal.aborted ||
        !result.ok ||
        !validateApplication(result.application) ||
        result.application.id !== application.id ||
        result.application.canonicalJobId !== jobId ||
        result.application.revision < application.revision
      ) {
        setNotice(
          "We could not check the generated resume. Check again; no new preparation was requested.",
        );
        return;
      }
      acceptApplication(result.application);
      setNotice(
        result.application.currentPacket?.temporaryMaterials?.some(
          (material) => material.kind === "tailored_resume",
        )
          ? "The current packet has a generated resume. Sign in to review its availability and exact content."
          : "No generated resume is available in the current packet. No new preparation was requested.",
      );
    } finally {
      clearTimeout(timeout);
      lifetime.current.signal.removeEventListener("abort", abort);
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  }

  /** Applies a result to state; a failure sets the fixed copy and throws so the panel shows it too. */
  async function settle(result: ApplicationsCallResult, id?: string): Promise<Application> {
    if (lifetime.current.signal.aborted) throw new Error("Workspace closed");
    if (result.ok) {
      acceptApplication(result.application);
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
      await prepare(
        created,
        entries,
        coverLetterRequested && Boolean(coverLetterPreparationEnabled),
      );
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
      await prepare(
        current,
        entries,
        coverLetterRequested && Boolean(coverLetterPreparationEnabled),
      );
    } catch {
      // The notice already carries the fixed copy for this failure.
    } finally {
      setBusy(false);
    }
  }

  async function prepare(
    current: Application,
    answers: Entries,
    includeCoverLetter = false,
    selected?: SavedApplicationAnswerSelection,
  ) {
    // A withheld packet grants no authority to reuse answers kept in this workspace's memory.
    if (current.packetAvailability === "withheld") answers = {};
    const previousEntries = Object.fromEntries(
      (current.currentPacket?.fields ?? [])
        .filter(
          (field) =>
            field.origin === "user_entered" &&
            (typeof field.value === "string" || typeof field.value === "boolean"),
        )
        .map((field) => [field.fieldKey, field.value as string | boolean]),
    );
    // Reconstruct only exact selection metadata; values remain owned by the protected vault read.
    const selections: PrepareApplicationPacketRequest["vaultSelections"] =
      selected?.vaultSelections ??
      (current.currentPacket?.fields ?? []).flatMap((field) =>
        field.origin === "answer_vault" &&
        field.vaultReference &&
        !Object.hasOwn(answers, field.fieldKey)
          ? [
              {
                id: field.vaultReference.id,
                version: field.vaultReference.version,
                fieldKey: field.fieldKey,
                context: field.vaultReference.context,
                questionHash: field.vaultReference.questionHash,
                meaningConfirmed: true as const,
              },
            ]
          : [],
      );
    const form = selected?.form ?? current.currentPacket?.form;
    const selectedKeys = new Set(selections.map((selection) => selection.fieldKey));
    const userEntries = Object.entries({ ...previousEntries, ...answers })
      .filter(([fieldKey]) => !selectedKeys.has(fieldKey))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldKey, value]) => ({ fieldKey, value }));
    const coverLetter = includeCoverLetter
      ? {
          disclosure: {
            noticeVersion: COVER_LETTER_DISCLOSURE_VERSION,
            acknowledged: true as const,
          },
        }
      : undefined;
    const signature = JSON.stringify([
      current.id,
      current.revision,
      userEntries,
      coverLetter,
      form,
      selections,
    ]);
    if (prepareIntent.current?.signature !== signature)
      prepareIntent.current = { signature, key: `web-prepare-${crypto.randomUUID()}` };
    const idempotencyKey = prepareIntent.current.key;
    const result = await prepareApplicationPacket(
      current.id,
      {
        expectedRevision: current.revision,
        ...(userEntries.length ? { userEntries } : {}),
        ...(coverLetter ? { coverLetter } : {}),
        ...(form ? { form } : {}),
        ...(selections.length ? { vaultSelections: selections } : {}),
      },
      idempotencyKey,
      options,
    );
    if (lifetime.current.signal.aborted) return;
    if (result.ok && result.kind === "preparation") {
      setPreparation(result.preparation);
      setCoverLetterRequested(false);
      return;
    }
    await settle(result, current.id);
  }

  async function cancelPreparation() {
    if (!application || starting.current) return;
    starting.current = true;
    setBusy(true);
    try {
      const latest = await applicationsCall(
        "GET",
        `/api/platform/applications/${application.id}`,
        options,
      );
      if (!latest.ok) {
        await settle(latest);
        return;
      }
      if (latest.application.id !== application.id) throw new Error("Application changed");
      const current = latest.application;
      await settle(
        current.status === "cancelled" || current.status === "applied"
          ? latest
          : await applicationsCall("POST", `/api/platform/applications/${current.id}/cancel`, {
              ...options,
              body: { expectedRevision: current.revision },
              idempotencyKey: commandKey("cancel", current.id, current.revision),
            }),
        current.id,
      );
      setPreparation(undefined);
    } catch {
      if (!lifetime.current.signal.aborted)
        setNotice(
          "Cancellation could not be confirmed. Check the current application before trying again.",
        );
    } finally {
      starting.current = false;
      setBusy(false);
    }
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
      {coverLetterPreparationEnabled &&
      !preparation &&
      (!application || ["preparing", "review_required"].includes(application.status)) ? (
        <fieldset disabled={busy || checking}>
          <legend>Optional cover letter</legend>
          <p>{COVER_LETTER_DISCLOSURE_TEXT}</p>
          <label>
            <input
              type="checkbox"
              checked={coverLetterRequested}
              onChange={(event) => setCoverLetterRequested(event.target.checked)}
            />{" "}
            Prepare a cover letter with OpenAI using these terms
          </label>
          <p>A new draft requires a new choice. Status checks never request another draft.</p>
        </fieldset>
      ) : null}
      {application && actions ? (
        <>
          {preparation ? (
            <>
              <ApplicationPreparationProgress
                key={preparation.id}
                preparation={preparation}
                onResolved={preparationResolved}
                {...(fetchImplementation ? { fetchImplementation } : {})}
              />
              <button type="button" disabled={busy} onClick={() => void cancelPreparation()}>
                Cancel application
              </button>
            </>
          ) : null}
          {!preparation &&
          nativeConfiguration &&
          application.currentPacket?.temporaryMaterials?.length &&
          application.status !== "applied" &&
          application.status !== "cancelled" ? (
            <NativeApplicationMaterials
              key={`${application.id}:${application.currentPacket.id}:${application.currentPacket.packetHash}`}
              application={application}
              configuration={nativeConfiguration}
              busy={busy}
              onReady={materialReady}
              onUnavailable={materialsUnavailable}
              {...(fetchImplementation ? { fetchImplementation } : {})}
            />
          ) : null}
          {!preparation &&
          nativeConfiguration &&
          !application.currentPacket?.temporaryMaterials?.length &&
          application.currentPacket &&
          application.status === "review_required" ? (
            <section aria-label="Generated resume availability">
              <p>
                Check whether a generated resume is available. This does not start another
                preparation.
              </p>
              <button type="button" disabled={busy} onClick={() => void checkGeneratedResume()}>
                Check generated resume
              </button>
            </section>
          ) : null}
          {!preparation &&
          !nativeConfiguration &&
          !busy &&
          application.currentPacket &&
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
          {!preparation &&
          !application.currentPacket &&
          (application.status === "preparing" ||
            (application.status === "review_required" &&
              application.packetAvailability === "withheld")) ? (
            <button
              type="button"
              onClick={() => void continuePreparing(application)}
              disabled={busy}
            >
              {busy
                ? "Preparing..."
                : coverLetterRequested
                  ? "Prepare resume and cover letter"
                  : application.packetAvailability === "withheld"
                    ? "Prepare a new packet"
                    : "Prepare application"}
            </button>
          ) : null}
          {!preparation && !busy ? (
            <ApplicationReviewPanel
              application={application}
              actions={actions}
              availableMaterials={availableMaterials}
            />
          ) : null}
          {!preparation &&
          !busy &&
          savedAnswerSelectionEnabled &&
          application.status === "review_required" ? (
            <SavedApplicationAnswers
              key={`${application.id}:${application.revision}`}
              application={application}
              {...(fetchImplementation ? { fetchImplementation } : {})}
              onPrepare={async (selection) => {
                if (starting.current) return;
                starting.current = true;
                setBusy(true);
                try {
                  await prepare(application, entries, false, selection);
                } finally {
                  starting.current = false;
                  setBusy(false);
                }
              }}
            />
          ) : null}
          {!preparation &&
          application.status === "review_required" &&
          application.packetAvailability !== "withheld" &&
          coverLetterRequested ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void continuePreparing(application)}
            >
              Prepare resume and cover letter
            </button>
          ) : null}
          {!preparation &&
          !busy &&
          application.packetAvailability !== "withheld" &&
          application.currentAction === "ready_to_submit" ? (
            <ApplyPanel
              application={application}
              nativeMaterialDownloads={Boolean(
                nativeConfiguration && application.currentPacket?.temporaryMaterials?.length,
              )}
              applyUrl={applyUrl}
              {...(fetchImplementation ? { fetchImplementation } : {})}
              onRecordManualSubmission={async (observation) => {
                const result = await startManualApplicationSubmission(
                  application.id,
                  application.revision,
                  options,
                  observation,
                );
                // A lost response may already have started takeover. Read it before offering another capture.
                if (!result.ok && observation) await refresh(application.id);
                await settle(result, application.id);
              }}
            />
          ) : null}
        </>
      ) : checking ? (
        <p role="status">Checking for an existing application...</p>
      ) : lookupFailed ? (
        <>
          <p role="alert">
            This application review could not be opened. Check your account and try again.
          </p>
          <button type="button" onClick={() => setLookupAttempt((current) => current + 1)}>
            Reload application review
          </button>
        </>
      ) : (
        <>
          <p>
            We prepare your answers from confirmed profile facts. You review everything before
            anything is sent, and nothing is submitted from this page.
          </p>
          <button type="button" onClick={() => void start()} disabled={busy}>
            {busy
              ? "Preparing..."
              : coverLetterRequested
                ? "Prepare resume and cover letter"
                : "Prepare application"}
          </button>
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
