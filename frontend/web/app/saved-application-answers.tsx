"use client";

import type {
  Application,
  PrepareApplicationPacketRequest,
  RestrictedAnswerCollection,
} from "@ai-job-apply/api-contracts";
import { mapFormFields } from "@ai-job-apply/ats-sdk/mapping";
import {
  formStructureDigestInput,
  type ObservedApplicationForm,
  parseObservedApplicationForm,
  questionStructureDigestInput,
} from "@ai-job-apply/ats-sdk/observed-form";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { sha256Hex } from "../lib/applications-client";
import { validateFoundationResponse } from "../lib/foundation-response-bff";
import { parseJobDetail } from "../lib/job-detail";
import { restrictedAnswerField } from "../lib/restricted-answer-fields";

export type SavedApplicationAnswerSelection = Required<
  Pick<PrepareApplicationPacketRequest, "form" | "vaultSelections">
>;
const FAILURE =
  "This question structure or saved-answer list is unavailable, changed or expired. Capture the current employer form again.";

export function SavedApplicationAnswers({
  application,
  onPrepare,
  fetchImplementation = fetch,
}: {
  application: Application;
  onPrepare(selection: SavedApplicationAnswerSelection): Promise<void>;
  fetchImplementation?: typeof fetch;
}) {
  const id = useId();
  const [link] = useState(
    () =>
      `${window.location.origin}/jobs?application=${application.id}&job=${application.canonicalJobId}`,
  );
  const [draft, setDraft] = useState("");
  const [observed, setObserved] = useState<ObservedApplicationForm>();
  const [answers, setAnswers] = useState<RestrictedAnswerCollection["answers"]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const generation = useRef(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const active = useRef(false);
  const discard = useCallback((message?: string) => {
    generation.current++;
    pending.current?.abort();
    pending.current = undefined;
    setDraft("");
    setObserved(undefined);
    setAnswers([]);
    setChoices({});
    setConfirmed({});
    setBusy(false);
    active.current = false;
    setNotice(message);
  }, []);
  useEffect(() => {
    const clear = () => discard();
    const visibility = () => {
      if (document.visibilityState === "hidden") clear();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", clear);
    return () => {
      generation.current++;
      pending.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", clear);
    };
  }, [discard]);
  const deadline = observed
    ? Math.min(
        observed.capturedAt + 60_000,
        ...answers.map((answer) => (answer.expiresAt ? Date.parse(answer.expiresAt) : Infinity)),
      )
    : undefined;
  useEffect(() => {
    if (deadline === undefined) return;
    const timer = setTimeout(() => discard(FAILURE), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, discard]);

  async function importStructure() {
    if (active.current) return;
    const structure = parseObservedApplicationForm(draft, Date.now());
    discard();
    if (
      !structure ||
      structure.applicationId !== application.id ||
      structure.jobId !== application.canonicalJobId
    ) {
      setNotice(FAILURE);
      return;
    }
    active.current = true;
    setBusy(true);
    const current = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = async (
        path: string,
        schema: "RestrictedAnswerCollection" | "CanonicalJobDetail",
      ) => {
        const response = await fetchImplementation(path, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        const validated = await validateFoundationResponse(
          response,
          200,
          schema,
          controller.signal,
          20_000,
        );
        if (!response.ok || !validated.ok) throw new Error();
        return validated.json();
      };
      const result = await Promise.race([
        Promise.all([
          read("/api/platform/restricted-answers", "RestrictedAnswerCollection"),
          read(`/api/platform/jobs/${application.canonicalJobId}`, "CanonicalJobDetail"),
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error());
          }, 20_000);
        }),
      ]);
      if (current !== generation.current || controller.signal.aborted) return;
      const collection = result[0] as RestrictedAnswerCollection;
      const job = parseJobDetail(result[1]);
      if (
        !job ||
        job.id !== structure.jobId ||
        Date.parse(job.expiresAt) <= Date.now() ||
        (job.validThrough && Date.parse(job.validThrough) <= Date.now()) ||
        !job.sources.some((source) => source.canonicalUrl === structure.destination) ||
        !parseObservedApplicationForm(JSON.stringify(structure), Date.now())
      )
        throw new Error();
      setAnswers(
        collection.answers.filter(
          (answer) =>
            answer.state === "active" &&
            restrictedAnswerField(answer.fieldKey)?.valueType === answer.valueType &&
            Date.parse(answer.confirmedAt) <= Date.now() &&
            (!answer.expiresAt || Date.parse(answer.expiresAt) > Date.now()),
        ),
      );
      setObserved(structure);
      setNotice(
        "Choose exact saved versions and confirm each question's meaning and context. Values appear in the new packet for final review.",
      );
    } catch {
      if (current === generation.current) discard(FAILURE);
    } finally {
      clearTimeout(timer);
      if (current === generation.current) {
        pending.current = undefined;
        active.current = false;
        setBusy(false);
      }
    }
  }

  const mappings = observed ? mapFormFields(observed.form) : [];
  const selectable =
    observed?.form.fields.filter((field) => {
      const mapping = mappings.find((candidate) => candidate.ref === field.ref);
      // This taxonomy key is US-specific. Generic wording cannot establish jurisdiction.
      if (
        mapping?.fieldKey === "authorization.us_authorized" &&
        !/\bunited states\b/iu.test(field.label)
      )
        return false;
      return (
        mapping?.reason === "matched" &&
        mapping.fieldKey &&
        restrictedAnswerField(mapping.fieldKey) &&
        field.label &&
        !["file", "unknown"].includes(field.type)
      );
    }) ?? [];
  async function prepareSelection() {
    if (active.current || !observed || !deadline || Date.now() >= deadline) {
      if (observed) discard(FAILURE);
      return;
    }
    const current = generation.current;
    active.current = true;
    setBusy(true);
    try {
      const vaultSelections: SavedApplicationAnswerSelection["vaultSelections"] = [];
      for (const field of selectable) {
        const answer = answers.find(
          (entry) => `${entry.id}:${entry.version}` === choices[field.ref],
        );
        if (!answer) continue;
        const mapping = mappings.find((entry) => entry.ref === field.ref);
        if (
          !confirmed[field.ref] ||
          mapping?.fieldKey !== answer.fieldKey ||
          (answer.expiresAt && Date.now() >= Date.parse(answer.expiresAt))
        )
          throw new Error();
        vaultSelections.push({
          id: answer.id,
          version: answer.version,
          fieldKey: answer.fieldKey,
          context: answer.context ?? "",
          questionHash: await sha256Hex(questionStructureDigestInput(field)),
          meaningConfirmed: true,
        });
      }
      if (!vaultSelections.length || vaultSelections.length > 20) throw new Error();
      const formHash = await sha256Hex(formStructureDigestInput(observed.form));
      if (current !== generation.current || Date.now() >= deadline) return;
      await onPrepare({
        form: { adapterId: "generic-assisted-v1", variantId: "generic", formHash },
        vaultSelections,
      });
      if (current === generation.current) discard();
    } catch {
      if (current === generation.current)
        setNotice(
          "Saved answers were not prepared. Review your selections or capture again; nothing was approved.",
        );
    } finally {
      if (current === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section aria-label="Select saved application answers">
      <h3>Select saved application answers</h3>
      <p>
        Copy this link into the extension on the employer page and choose “Copy employer question
        structure”. Paste that structure here within 60 seconds. Entered answers are excluded.
        Nothing is filled or submitted.
      </p>
      <label>
        Question capture review link
        <input readOnly value={link} onFocus={(event) => event.target.select()} />
      </label>
      <fieldset disabled={busy}>
        <legend>Observed questions and saved versions</legend>
        <label>
          Employer question structure
          <textarea
            autoComplete="off"
            maxLength={65_536}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button type="button" disabled={!draft} onClick={() => void importStructure()}>
          Review captured questions
        </button>
        {selectable.map((field) => {
          const key = mappings.find((entry) => entry.ref === field.ref)?.fieldKey;
          return (
            <div key={field.ref}>
              <p>
                <strong>{field.label}</strong>
              </p>
              {field.options.length ? <p>Employer options: {field.options.join(" · ")}</p> : null}
              <label htmlFor={`${id}-${field.ref}`}>Saved answer for {field.label}</label>
              <select
                id={`${id}-${field.ref}`}
                value={choices[field.ref] ?? ""}
                onChange={(event) => {
                  setChoices({ ...choices, [field.ref]: event.target.value });
                  setConfirmed({ ...confirmed, [field.ref]: false });
                }}
              >
                <option value="">Enter this answer yourself</option>
                {answers
                  .filter((answer) => answer.fieldKey === key)
                  .map((answer) => (
                    <option key={answer.id} value={`${answer.id}:${answer.version}`}>
                      {restrictedAnswerField(answer.fieldKey)?.label} · context:{" "}
                      {answer.context ?? "none specified"} · version {answer.version} · confirmed{" "}
                      {new Date(answer.confirmedAt).toUTCString()}
                    </option>
                  ))}
              </select>
              {choices[field.ref] ? (
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed[field.ref] === true}
                    onChange={(event) =>
                      setConfirmed({ ...confirmed, [field.ref]: event.target.checked })
                    }
                  />
                  I checked this employer question means exactly the same thing in the selected
                  saved context.
                </label>
              ) : null}
            </div>
          );
        })}
        {observed && !selectable.length ? (
          <p>
            No unambiguous supported restricted questions were found. Answer these questions
            yourself.
          </p>
        ) : null}
        <button
          type="button"
          disabled={
            !selectable.some((field) => choices[field.ref]) ||
            selectable.some((field) => choices[field.ref] && !confirmed[field.ref])
          }
          onClick={() => void prepareSelection()}
        >
          Prepare with selected saved answers
        </button>
      </fieldset>
      <button type="button" onClick={() => discard()}>
        Clear saved-answer selection
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
