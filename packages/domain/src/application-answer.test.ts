import { describe, expect, it } from "vitest";
import {
  isRestrictedQuestion,
  normalizeQuestionKey,
  restrictedQuestionCategory,
} from "./application-answer.js";

describe("application answer question keys", () => {
  it("normalizes case, spacing, list markers and trailing punctuation", () => {
    expect(normalizeQuestionKey("  Why do you want to work here?  ")).toBe(
      "why do you want to work here",
    );
    expect(normalizeQuestionKey("1) Why   do you  want to work here?!")).toBe(
      "why do you want to work here",
    );
    expect(normalizeQuestionKey("Why do you want to work here")).toBe(
      normalizeQuestionKey("WHY DO YOU WANT TO WORK HERE?"),
    );
  });

  it("keeps different questions distinct", () => {
    expect(normalizeQuestionKey("What is your favorite language?")).not.toBe(
      normalizeQuestionKey("What is your favorite framework?"),
    );
  });
});

describe("restricted question guard (ADR-052, ADR-010)", () => {
  it.each([
    ["Are you legally authorized to work in the United States?", "work_authorization"],
    ["Will you now or in the future require visa sponsorship?", "work_authorization"],
    ["Do you require sponsorship?", "sponsorship"],
    ["Are you a protected veteran?", "demographic"],
    ["What is your gender identity?", "demographic"],
    ["Do you have a disability?", "demographic"],
    ["Race / ethnicity", "demographic"],
    ["Have you ever been convicted of a felony?", "legal_disclosure"],
    ["Are you subject to a non-compete agreement?", "legal_disclosure"],
    ["Do you hold an active security clearance?", "export_control"],
    ["What is your current salary?", "health_or_compensation_history"],
    ["Date of birth", "demographic"],
    ["   ?  ", "unclassifiable"],
  ])("refuses %s", (question, category) => {
    expect(restrictedQuestionCategory(question)).toBe(category);
    expect(isRestrictedQuestion(question)).toBe(true);
  });

  it.each([
    "Why do you want to work at this company?",
    "Tell us about a project you are proud of.",
    "How did you hear about this role?",
    "Describe your experience with TypeScript.",
    "What are your salary expectations?",
    "Are you willing to relocate?",
  ])("allows general question %s", (question) => {
    expect(isRestrictedQuestion(question)).toBe(false);
  });
});
