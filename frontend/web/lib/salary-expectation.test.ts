import { describe, expect, it } from "vitest";
import {
  formatSalary,
  parseSalaryInput,
  SALARY_QUESTION,
  salaryRecord,
  savedSalary,
} from "./salary-expectation";

describe("parseSalaryInput", () => {
  it.each([
    ["120000", 120_000],
    ["120,000", 120_000],
    ["$120,000", 120_000],
    ["$ 120 000", 120_000],
    ["120k", 120_000],
    ["120K", 120_000],
    [" 95000 ", 95_000],
    ["1000", 1_000],
  ])("reads %j as %i a year", (text, amount) => {
    expect(parseSalaryInput(text)).toEqual({ ok: true, amount });
  });

  it.each([
    "",
    "abc",
    "12",
    "999",
    "1.5",
    "120,000.50",
    "-1",
    "100000000",
    "120 per hour",
    "€90,000",
  ])("refuses %j", (text) => {
    expect(parseSalaryInput(text).ok).toBe(false);
  });
});

describe("the saved salary", () => {
  const answer = (question: string, text: string) => ({ question, answer: text });

  it("is found by its own question, however it is spaced or cased", () => {
    const records = [
      answer("Are you legally authorized to work in the United States?", "Yes"),
      answer(`  ${SALARY_QUESTION.toUpperCase()}  `, "130000"),
    ];
    expect(salaryRecord(records)).toBe(records[1]);
    expect(savedSalary(records)).toBe(130_000);
  });

  it("is never taken from an answer to some other question", () => {
    expect(savedSalary([answer("What is your desired salary?", "999000")])).toBeUndefined();
    expect(savedSalary([])).toBeUndefined();
  });

  it("is undefined when what is saved cannot be read", () => {
    expect(savedSalary([answer(SALARY_QUESTION, "lots")])).toBeUndefined();
  });

  it("shows with thousands separators", () => {
    expect(formatSalary(120_000)).toBe("120,000");
  });
});
