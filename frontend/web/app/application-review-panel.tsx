"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { useId, useRef, useState } from "react";
import { restrictedAnswerField } from "../lib/restricted-answer-fields";
import {
  explicitReviewFields,
  formatFieldValue,
  REASON_COPY,
  reviewGroups,
} from "./application-review-state";
import { CommonQuestions } from "./common-questions";

export interface ApplicationReviewActions {
  onProvideEntry(entry: { fieldKey: string; value: string | boolean }): Promise<void> | void;
}

const STATUS_COPY: Partial<Record<Application["status"], string>> = {
  applied: "Submitted",
  cancelled: "This application was cancelled.",
};

type PacketField = NonNullable<Application["currentPacket"]>["fields"][number];

function FieldRow({
  application,
  field,
  acknowledged,
  onToggle,
  onProvide,
}: {
  application: Application;
  field: PacketField;
  acknowledged: boolean;
  onToggle(): void;
  onProvide(value: string | boolean): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const empty = field.value === null;
  const editable = application.status === "review_required";
  const booleanAnswer =
    restrictedAnswerField(field.fieldKey)?.valueType === "boolean" ||
    typeof field.value === "boolean";
  return (
    <li>
      <p id={`${id}-label`}>
        <strong>{field.fieldKey}</strong>
      </p>
      {empty ? <p>No value yet.</p> : <p>{formatFieldValue(field.value)}</p>}
      <ul aria-label={`Why ${field.fieldKey} is shown`}>
        {field.reasons.map((reason) => (
          <li key={reason}>{REASON_COPY[reason]}</li>
        ))}
      </ul>
      {field.origin === "answer_vault" && field.vaultReference ? (
        <p>
          Saved answer version {field.vaultReference.version}. Context:{" "}
          {field.vaultReference.context || "none specified"}. Check this answer against the
          employer's exact question before applying.
        </p>
      ) : field.origin === "confirmed_fact" && field.sourceFactIds.length > 0 ? (
        <p>Based on {field.sourceFactIds.length} confirmed fact(s) in your profile.</p>
      ) : null}
      {editable && (empty || field.origin === "user_entered" || field.origin === "answer_vault") ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onProvide(booleanAnswer ? draft === "true" : draft.trim());
          }}
        >
          <label htmlFor={`${id}-input`}>Your answer for {field.fieldKey}</label>
          {booleanAnswer ? (
            <select
              id={`${id}-input`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            >
              <option value="">Choose your answer</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              id={`${id}-input`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoComplete="off"
            />
          )}
          <button type="submit" disabled={!draft.trim()}>
            Save answer
          </button>
        </form>
      ) : null}
      {editable && field.requiresReview && !empty ? (
        <label>
          <input type="checkbox" checked={acknowledged} onChange={onToggle} /> I checked{" "}
          {field.fieldKey}
        </label>
      ) : null}
    </li>
  );
}

/**
 * What the candidate must still decide before Apply, and nothing else: answers only they can give,
 * and sensitive or uncertain answers to confirm. The generated resume is not listed here; its
 * identity and exact preview are shown beside the Apply button. Reconciliation of an ambiguous
 * submission also lives here so the candidate can never be left without a way to resolve it.
 */
export function ApplicationReviewPanel({
  application,
  actions,
  acknowledged,
  onToggle,
}: {
  application: Application;
  actions: ApplicationReviewActions;
  acknowledged: ReadonlySet<string>;
  onToggle(fieldKey: string): void;
}) {
  return (
    <PacketReview
      key={`${application.id}:${application.revision}:${application.currentPacket?.id}:${application.currentPacket?.packetHash}`}
      application={application}
      actions={actions}
      acknowledged={acknowledged}
      onToggle={onToggle}
    />
  );
}

function PacketReview({
  application,
  actions,
  acknowledged,
  onToggle,
}: {
  application: Application;
  actions: ApplicationReviewActions;
  acknowledged: ReadonlySet<string>;
  onToggle(fieldKey: string): void;
}) {
  const headingId = useId();
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const groups = reviewGroups(application);
  const confirm = explicitReviewFields(groups);
  const editable = application.status === "review_required" || application.status === "approved";

  async function run(action: () => Promise<void> | void, success: string) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
    } catch {
      setMessage("That did not go through. Check the state below and try again.");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  const statusCopy = STATUS_COPY[application.status];
  const showAnswers = editable && (groups.needsInput.length > 0 || confirm.length > 0);
  const showCommon = application.status === "review_required";
  if (!statusCopy && !showAnswers && !showCommon && application.packetAvailability !== "withheld")
    return null;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Before you apply</h3>
      {statusCopy ? <p>{statusCopy}</p> : null}
      {application.packetAvailability === "withheld" ? (
        <p role="status">
          A saved answer changed, was removed or expired. The previous packet is withheld.
          {editable
            ? " Generate or apply again to build a new packet with your current answers."
            : " Your submission status is retained below."}
        </p>
      ) : null}
      <fieldset disabled={busy}>
        <legend>Answers and checks</legend>
        {showCommon ? (
          <CommonQuestions
            application={application}
            onAnswer={(entry) => void run(() => actions.onProvideEntry(entry), "Answer saved.")}
          />
        ) : null}
        {showAnswers && groups.needsInput.length > 0 ? (
          <section aria-label="Answers that need your input">
            <h4>We need your answer</h4>
            <ul>
              {groups.needsInput.map((field) => (
                <FieldRow
                  key={field.fieldKey}
                  application={application}
                  field={field}
                  acknowledged={false}
                  onToggle={() => undefined}
                  onProvide={(value) =>
                    run(
                      () => actions.onProvideEntry({ fieldKey: field.fieldKey, value }),
                      "Answer saved.",
                    )
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}
        {showAnswers && confirm.length > 0 ? (
          <section aria-label="Items to confirm">
            <h4>Check these answers</h4>
            <ul>
              {confirm.map((field) => (
                <FieldRow
                  key={field.fieldKey}
                  application={application}
                  field={field}
                  acknowledged={acknowledged.has(field.fieldKey)}
                  onToggle={() => onToggle(field.fieldKey)}
                  onProvide={(value) =>
                    run(
                      () => actions.onProvideEntry({ fieldKey: field.fieldKey, value }),
                      "Answer saved.",
                    )
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}

        <p role="status" aria-live="polite">
          {message}
        </p>
      </fieldset>
    </section>
  );
}
