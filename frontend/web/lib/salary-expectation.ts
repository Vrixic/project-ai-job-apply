/**
 * The annual salary the candidate wants, set once in their Profile. It is kept as an ordinary saved
 * answer (the same storage the screening answers use), under a question no employer form asks, so
 * it is never applied to a question by accident. An application carries it as `job.salary_expectation`
 * and the extension answers salary questions from it: an input box gets the number, a list of ranges
 * gets the range that holds it, and "does the posted salary meet your expectations?" gets Yes unless
 * the posted range tops out below it.
 */
export const SALARY_QUESTION = "Desired annual salary (ApplyDash profile)";
export const SALARY_FIELD_KEY = "job.salary_expectation";

const MINIMUM = 1_000;
const MAXIMUM = 99_999_999;

export type SalaryInput = { ok: true; amount: number } | { ok: false; message: string };

/** A salary as people type it: 120000, 120,000, $120,000 or 120k. Whole dollars a year. */
export function parseSalaryInput(text: string): SalaryInput {
  const clean = text
    .trim()
    .replace(/^\$\s*/u, "")
    .replace(/[,\s]/gu, "")
    .toLowerCase();
  const match = /^(\d+)(k?)$/u.exec(clean);
  const amount = match ? Number(match[1]) * (match[2] ? 1_000 : 1) : Number.NaN;
  if (!Number.isSafeInteger(amount) || amount < MINIMUM || amount > MAXIMUM)
    return {
      ok: false,
      message: "Enter your desired annual salary in whole dollars, for example 120000.",
    };
  return { ok: true, amount };
}

interface SavedAnswer {
  question: string;
  answer: string;
}

const normalize = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

/** The saved record that holds the salary, if the candidate has set one. */
export function salaryRecord<T extends SavedAnswer>(records: readonly T[]): T | undefined {
  const wanted = normalize(SALARY_QUESTION);
  return records.find((record) => normalize(record.question) === wanted);
}

/** The candidate's desired annual salary, or undefined when none is saved (or it is unreadable). */
export function savedSalary(records: readonly SavedAnswer[]): number | undefined {
  const record = salaryRecord(records);
  if (!record) return undefined;
  const parsed = parseSalaryInput(record.answer);
  return parsed.ok ? parsed.amount : undefined;
}

/** A salary as it is shown back: 120,000. */
export function formatSalary(amount: number): string {
  return amount.toLocaleString("en-US");
}
