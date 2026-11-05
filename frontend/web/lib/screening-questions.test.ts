import { describe, expect, it } from "vitest";
import {
  SCREENING_QUESTIONS,
  savedAnswerFor,
  screeningAnswers,
  yesNo,
} from "./screening-questions";

const [authorized, sponsorship] = SCREENING_QUESTIONS;

describe("screening questions", () => {
  it("reads Yes and No, and nothing else, as an answer", () => {
    expect(yesNo(" yes ")).toBe(true);
    expect(yesNo("NO")).toBe(false);
    expect(yesNo("Maybe")).toBeUndefined();
    expect(yesNo("")).toBeUndefined();
    expect(yesNo(undefined)).toBeUndefined();
  });
  it("finds a saved answer by its exact question, ignoring case and spacing", () => {
    const records = [
      { question: "  ARE you legally authorized  to work in the United States? ", answer: "Yes" },
    ];
    expect(savedAnswerFor(records, authorized.question)).toBe(records[0]);
    expect(savedAnswerFor(records, "Are you authorized to work in the US?")).toBeUndefined();
  });
  it("turns saved Yes and No answers into one boolean per question", () => {
    expect(
      screeningAnswers([
        { question: authorized.question, answer: "Yes" },
        { question: sponsorship.question, answer: "No" },
        { question: "Why do you want to work here?", answer: "Yes" },
      ]),
    ).toEqual({ [authorized.fieldKey]: true, [sponsorship.fieldKey]: false });
  });
  it("leaves out a question whose saved answer is not Yes or No", () => {
    expect(screeningAnswers([{ question: authorized.question, answer: "It depends" }])).toEqual({});
  });
});
