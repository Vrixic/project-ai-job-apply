"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { useId, useState } from "react";
import {
  APPROVAL_EXPIRY_NOTE,
  approvalBlockers,
  canApprove,
  formatFieldValue,
  REASON_COPY,
  reviewGroups,
} from "./application-review-state";

export interface ApplicationReviewActions {
  onApprove(input: { packetHash: string; acknowledgedFieldKeys: string[] }): Promise<void> | void;
  onProvideEntry(entry: { fieldKey: string; value: string | boolean }): Promise<void> | void;
  onReopen(): Promise<void> | void;
  onCancel(): Promise<void> | void;
  onReconcile(
    input:
      | { attemptId: string; kind: "submitted" }
      | { attemptId: string; kind: "not_submitted"; acknowledgesDuplicateRisk: true },
  ): Promise<void> | void;
}

const STATUS_COPY: Record<Application["status"], string> = {
  preparing: "Preparing your application packet.",
  review_required: "Review what will be sent. Nothing is submitted until you approve.",
  approved: "Approved. The packet is ready to submit from the browser extension.",
  submitting: "A submission is in progress.",
  takeover: "Finish this step yourself in the browser. We never bypass verification steps.",
  reconciliation_required:
    "We could not confirm whether this was submitted. Do not submit again until you confirm below.",
  applied: "Submitted and confirmed.",
  cancelled: "This application was cancelled.",
};

function FieldRow({
  application,
  field,
  acknowledged,
  onToggle,
  onProvide,
}: {
  application: Application;
  field: NonNullable<Application["currentPacket"]>["fields"][number];
  acknowledged: boolean;
  onToggle(): void;
  onProvide(value: string | boolean): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const empty = field.value === null;
  const editable = application.status === "review_required";
  return (
    <li>
      <p id={`${id}-label`}>
        <strong>{field.fieldKey}</strong>
      </p>
      {empty ? (
        <p>No value yet.</p>
      ) : (
        <p aria-labelledby={`${id}-label`}>{formatFieldValue(field.value)}</p>
      )}
      <ul aria-label={`Why ${field.fieldKey} is shown`}>
        {field.reasons.map((reason) => (
          <li key={reason}>{REASON_COPY[reason]}</li>
        ))}
      </ul>
      {field.sourceFactIds.length > 0 ? (
        <p>Based on {field.sourceFactIds.length} confirmed fact(s) in your profile.</p>
      ) : null}
      {editable && (empty || field.origin === "user_entered") ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onProvide(draft.trim());
          }}
        >
          <label htmlFor={`${id}-input`}>Your answer for {field.fieldKey}</label>
          <input
            id={`${id}-input`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" disabled={!draft.trim()}>
            Save answer
          </button>
        </form>
      ) : null}
      {editable && field.requiresReview && !empty ? (
        <label>
          <input type="checkbox" checked={acknowledged} onChange={onToggle} /> I reviewed{" "}
          {field.fieldKey}
        </label>
      ) : null}
    </li>
  );
}

export function ApplicationReviewPanel({
  application,
  actions,
}: {
  application: Application;
  actions: ApplicationReviewActions;
}) {
  const headingId = useId();
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const [showAutomatic, setShowAutomatic] = useState(false);
  const [duplicateRisk, setDuplicateRisk] = useState(false);
  const [message, setMessage] = useState<string>();
  const groups = reviewGroups(application);
  const packet = application.currentPacket;
  const blockers = approvalBlockers(groups, acknowledged);
  const approvable = canApprove(groups, acknowledged);
  const openAttempt = application.attempts.find(
    (attempt) => attempt.status === "ambiguous" || attempt.status === "taken_over",
  );

  function toggle(fieldKey: string) {
    setAcknowledged((current) => {
      const next = new Set(current);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  }

  async function run(action: () => Promise<void> | void, success: string) {
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
    } catch {
      setMessage("That did not go through. Check the state below and try again.");
    }
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Application review</h2>
      <p>{STATUS_COPY[application.status]}</p>

      {application.status === "review_required" && packet ? (
        <>
          <p>{APPROVAL_EXPIRY_NOTE}</p>
          {groups.needsInput.length > 0 ? (
            <section aria-label="Answers that need your input">
              <h3>Needs your input</h3>
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
                        "Answer saved. A new packet was prepared.",
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-label="Items to confirm">
            <h3>Confirm before approving</h3>
            {groups.needsReview.filter((field) => field.value !== null).length === 0 ? (
              <p>Nothing else needs a decision.</p>
            ) : (
              <ul>
                {groups.needsReview
                  .filter((field) => field.value !== null)
                  .map((field) => (
                    <FieldRow
                      key={field.fieldKey}
                      application={application}
                      field={field}
                      acknowledged={acknowledged.has(field.fieldKey)}
                      onToggle={() => toggle(field.fieldKey)}
                      onProvide={(value) =>
                        run(
                          () => actions.onProvideEntry({ fieldKey: field.fieldKey, value }),
                          "Answer saved. A new packet was prepared.",
                        )
                      }
                    />
                  ))}
              </ul>
            )}
          </section>
          <section aria-label="Automatically filled fields">
            <button
              type="button"
              aria-expanded={showAutomatic}
              onClick={() => setShowAutomatic((v) => !v)}
            >
              {showAutomatic ? "Hide" : "Show"} {groups.automatic.length} automatically filled
              field(s)
            </button>
            {showAutomatic ? (
              <ul>
                {groups.automatic.map((field) => (
                  <li key={field.fieldKey}>
                    <strong>{field.fieldKey}</strong>: {formatFieldValue(field.value)}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <p>
            Resume: {packet.artifactHashes.resume ? "attached" : "not attached"}. Cover letter:{" "}
            {packet.artifactHashes.coverLetter ? "attached" : "not attached"}.
          </p>
          {blockers.length > 0 ? (
            <ul aria-label="Why you cannot approve yet">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            disabled={!approvable}
            onClick={() =>
              run(
                () =>
                  actions.onApprove({
                    packetHash: packet.packetHash,
                    acknowledgedFieldKeys: groups.needsReview.map((field) => field.fieldKey).sort(),
                  }),
                "Approved.",
              )
            }
          >
            Approve this packet
          </button>
        </>
      ) : null}

      {application.status === "approved" && application.approval ? (
        <>
          <p>Approval expires {new Date(application.approval.expiresAt).toUTCString()}.</p>
          <button type="button" onClick={() => run(actions.onReopen, "Reopened for editing.")}>
            Edit again
          </button>
        </>
      ) : null}

      {(application.status === "reconciliation_required" || application.status === "takeover") &&
      openAttempt ? (
        <section aria-label="Confirm the submission status">
          <label>
            <input
              type="checkbox"
              checked={duplicateRisk}
              onChange={(event) => setDuplicateRisk(event.target.checked)}
            />{" "}
            I understand that submitting again could create a duplicate application.
          </label>
          <button
            type="button"
            onClick={() =>
              run(
                () => actions.onReconcile({ attemptId: openAttempt.id, kind: "submitted" }),
                "Recorded as submitted.",
              )
            }
          >
            I submitted it
          </button>
          <button
            type="button"
            disabled={!duplicateRisk}
            onClick={() =>
              run(
                () =>
                  actions.onReconcile({
                    attemptId: openAttempt.id,
                    kind: "not_submitted",
                    acknowledgesDuplicateRisk: true,
                  }),
                "Recorded as not submitted.",
              )
            }
          >
            It was not submitted
          </button>
        </section>
      ) : null}

      {["preparing", "review_required", "approved"].includes(application.status) ? (
        <button type="button" onClick={() => run(actions.onCancel, "Application cancelled.")}>
          Cancel application
        </button>
      ) : null}

      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
