import type { Application } from "@ai-job-apply/api-contracts";
import React, { useId } from "react";

/** The Yes/No questions most applications ask. An answer is the candidate's own and is used as given. */
export const COMMON_QUESTIONS = [
  {
    fieldKey: "authorization.us_authorized",
    label: "Are you legally authorized to work in the United States?",
  },
  {
    fieldKey: "authorization.sponsorship_required",
    label: "Will you now or in the future require visa sponsorship to work in the United States?",
  },
  {
    fieldKey: "job.salary_acceptable",
    label: "Does this job's posted salary meet your expectations?",
  },
] as const;

/** What the packet already holds for a question: the candidate's own Yes or No, or nothing. */
export function answerFor(application: Application, fieldKey: string): "yes" | "no" | "" {
  const field = application.currentPacket?.fields.find(
    (candidate) => candidate.fieldKey === fieldKey && candidate.origin === "user_entered",
  );
  return field?.value === true ? "yes" : field?.value === false ? "no" : "";
}

/**
 * Yes/No answers to the questions every employer asks. Choosing one saves it for this application;
 * the extension then fills the employer's matching question with exactly that answer.
 */
export function CommonQuestions({
  application,
  onAnswer,
}: {
  application: Application;
  onAnswer(entry: { fieldKey: string; value: boolean }): void;
}) {
  const id = useId();
  return (
    <section aria-label="Your answers to common questions">
      <h4>Your answers to common questions</h4>
      <p className="field-help">
        The extension uses these exactly as you choose them. Leave one empty to answer it yourself
        on the employer's page.
      </p>
      <ul>
        {COMMON_QUESTIONS.map((question) => (
          <li key={question.fieldKey}>
            <label htmlFor={`${id}-${question.fieldKey}`}>{question.label}</label>
            <select
              id={`${id}-${question.fieldKey}`}
              value={answerFor(application, question.fieldKey)}
              onChange={(event) => {
                if (event.target.value === "yes" || event.target.value === "no")
                  onAnswer({ fieldKey: question.fieldKey, value: event.target.value === "yes" });
              }}
            >
              <option value="" disabled>
                Choose your answer
              </option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
