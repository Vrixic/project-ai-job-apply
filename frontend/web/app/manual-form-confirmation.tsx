"use client";

import type {
  Application,
  StartManualApplicationSubmissionRequest,
} from "@ai-job-apply/api-contracts";
import {
  CHALLENGE_SUBMISSION_NOTICE,
  employerPageForSource,
  formStructureDigestInput,
  parseObservedApplicationForm,
} from "@ai-job-apply/ats-sdk/observed-form";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { sha256Hex } from "../lib/applications-client";
import { validateFoundationResponse } from "../lib/foundation-response-bff";
import { parseJobDetail } from "../lib/job-detail";

export type ManualFormObservation = NonNullable<
  StartManualApplicationSubmissionRequest["observedForm"]
>;
const FAILURE =
  "The current employer form could not be confirmed. Capture it again; changed questions require preparing and reviewing a new packet.";

/** Candidate attestation only. It neither fills nor submits an employer form. */
export function ManualFormConfirmation({
  application,
  fetchImplementation = fetch,
  onChange,
}: {
  application: Application;
  fetchImplementation?: typeof fetch;
  onChange(observation: ManualFormObservation | undefined): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [observation, setObservation] = useState<ManualFormObservation>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const generation = useRef(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const notify = useRef(onChange);
  notify.current = onChange;
  const clear = useCallback((message?: string) => {
    generation.current++;
    pending.current?.abort();
    pending.current = undefined;
    setDraft("");
    setObservation(undefined);
    setConfirmed(false);
    setBusy(false);
    setNotice(message);
    notify.current(undefined);
  }, []);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") clear();
    };
    const leave = () => clear();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      generation.current++;
      pending.current?.abort();
      notify.current(undefined);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
    };
  }, [clear]);
  useEffect(() => {
    if (!observation) return;
    const timer = setTimeout(
      () => clear(FAILURE),
      Math.max(0, observation.capturedAtEpochMs + 60_000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [observation, clear]);

  async function check() {
    if (pending.current) return;
    const captured = parseObservedApplicationForm(draft, Date.now());
    clear();
    const binding = application.currentPacket?.form;
    if (
      !binding ||
      !captured ||
      captured.applicationId !== application.id ||
      captured.jobId !== application.canonicalJobId
    ) {
      setNotice(FAILURE);
      return;
    }
    const token = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const response = await fetchImplementation(
            `/api/platform/jobs/${application.canonicalJobId}`,
            {
              signal: controller.signal,
              credentials: "same-origin",
              cache: "no-store",
            },
          );
          const validated = await validateFoundationResponse(
            response,
            200,
            "CanonicalJobDetail",
            controller.signal,
            20_000,
          );
          if (!response.ok || !validated.ok) throw new Error();
          const job = parseJobDetail(await validated.json());
          const hash = await sha256Hex(formStructureDigestInput(captured.form));
          if (
            !job ||
            job.id !== captured.jobId ||
            Date.parse(job.expiresAt) <= Date.now() ||
            (job.validThrough && Date.parse(job.validThrough) <= Date.now()) ||
            !job.sources.some(
              (source) =>
                employerPageForSource(source.canonicalUrl, captured.destination) ===
                captured.destination,
            ) ||
            hash !== binding.formHash ||
            !parseObservedApplicationForm(JSON.stringify(captured), Date.now())
          )
            throw new Error();
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error());
          }, 20_000);
        }),
      ]);
      if (token !== generation.current || controller.signal.aborted) return;
      setObservation({ form: binding, capturedAtEpochMs: captured.capturedAt, confirmed: true });
      setNotice(
        `The question structure matches your approved packet. Confirm below before continuing.${captured.form.challengePresent ? ` ${CHALLENGE_SUBMISSION_NOTICE}` : ""}`,
      );
    } catch {
      if (token === generation.current) clear(FAILURE);
    } finally {
      clearTimeout(timeout);
      if (token === generation.current) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  }

  return (
    <div>
      <h4>Confirm the current employer form</h4>
      <p>
        Before submitting on the employer site, use the extension's Application review handoff to
        copy the current question structure. Paste it here and confirm the match. This expires 60
        seconds after capture.
      </p>
      <label htmlFor={id}>Current employer question structure</label>
      <textarea
        id={id}
        value={draft}
        maxLength={65_536}
        disabled={busy}
        onChange={(event) => {
          clear();
          setDraft(event.target.value);
        }}
      />
      <button type="button" disabled={busy || !draft} onClick={() => void check()}>
        Check current form
      </button>
      <button type="button" onClick={() => clear()}>
        Clear current form
      </button>
      {observation ? (
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              const checked =
                event.target.checked && Date.now() < observation.capturedAtEpochMs + 60_000;
              setConfirmed(checked);
              notify.current(checked ? observation : undefined);
            }}
          />
          I confirm these are the current employer questions and I will use the answers and
          materials I approved.
        </label>
      ) : null}
      <p role="status">{notice}</p>
    </div>
  );
}
