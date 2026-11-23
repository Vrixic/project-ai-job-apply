import {
  PROFILE_QUESTIONS,
  type ProfileQuestion,
  profileQuestionAnswers,
} from "@ai-job-apply/ats-sdk/profile-questions";

/**
 * The recurring questions the candidate answers once in their Profile (ADR-062, amended 2026-11-23),
 * each a fixed choice saved as an ordinary saved answer under its exact question text. Work
 * authorization and eligibility are on the Screening tab, voluntary self-identification on the Equal
 * employment tab. An application carries the answers as the candidate's own entries.
 */
export const SCREENING_QUESTIONS: readonly ProfileQuestion[] = PROFILE_QUESTIONS.filter(
  (item) => item.group === "screening",
);
export const EQUAL_EMPLOYMENT_QUESTIONS: readonly ProfileQuestion[] = PROFILE_QUESTIONS.filter(
  (item) => item.group === "equal_employment",
);

/** Field key to value: a boolean for Yes/No, the chosen option, or countries as "US, CA". */
export type ScreeningAnswers = Readonly<Record<string, boolean | string>>;

const normalize = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

interface SavedAnswer {
  question: string;
  answer: string;
}

/** The saved answer to a question, if the candidate has saved one. */
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

/** The candidate's answered Profile questions as packet entries. */
export function screeningAnswers(records: readonly SavedAnswer[]): ScreeningAnswers {
  return profileQuestionAnswers(records);
}

/** True for a saved answer one of these tabs (or the Salary tab) owns, not the Answers tab. */
export function isProfileQuestion(question: string, salaryQuestion: string): boolean {
  const text = normalize(question);
  return (
    text === normalize(salaryQuestion) ||
    PROFILE_QUESTIONS.some((item) => normalize(item.question) === text)
  );
}
