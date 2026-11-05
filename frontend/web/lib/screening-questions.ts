/**
 * The screening questions nearly every employer asks. The candidate answers them once in their
 * Profile, as ordinary saved answers, and an application uses them as given. Matching is by the
 * exact question text, so a saved answer is never applied to a question worded differently.
 */
export const SCREENING_QUESTIONS = [
  {
    fieldKey: "authorization.us_authorized",
    question: "Are you legally authorized to work in the United States?",
  },
  {
    fieldKey: "authorization.sponsorship_required",
    question:
      "Will you now or in the future require visa sponsorship to work in the United States?",
  },
] as const;

export type ScreeningFieldKey = (typeof SCREENING_QUESTIONS)[number]["fieldKey"];

const normalize = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

interface SavedAnswer {
  question: string;
  answer: string;
}

/** The saved answer to a screening question, if the candidate has saved one. */
export function savedAnswerFor<T extends SavedAnswer>(
  records: readonly T[],
  question: string,
): T | undefined {
  const wanted = normalize(question);
  return records.find((record) => normalize(record.question) === wanted);
}

/** Yes or No as the candidate saved it; anything else is no answer. */
export function yesNo(answer: string | undefined): boolean | undefined {
  const text = answer?.trim().toLowerCase();
  return text === "yes" ? true : text === "no" ? false : undefined;
}

/** The candidate's screening answers as packet entries: a boolean per answered question. */
export function screeningAnswers(
  records: readonly SavedAnswer[],
): Partial<Record<ScreeningFieldKey, boolean>> {
  const answers: Partial<Record<ScreeningFieldKey, boolean>> = {};
  for (const item of SCREENING_QUESTIONS) {
    const value = yesNo(savedAnswerFor(records, item.question)?.answer);
    if (value !== undefined) answers[item.fieldKey] = value;
  }
  return answers;
}
