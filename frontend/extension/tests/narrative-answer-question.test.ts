// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isOpenQuestion } from "../lib/narrative-answer-page";

afterEach(() => {
  document.body.innerHTML = "";
});

function box(): HTMLTextAreaElement {
  document.body.innerHTML = '<textarea id="q"></textarea>';
  return document.getElementById("q") as HTMLTextAreaElement;
}

describe("isOpenQuestion", () => {
  it("offers the answer icon on a why-this-company question, which the Profile never answers", () => {
    for (const question of [
      "Why are you interested in Mintlify?",
      "Why do you want to work at Mintlify?",
      "What interests you about this role?",
    ])
      expect(isOpenQuestion(box(), question)).toBe(true);
  });

  it("still skips questions the Profile answers, and resumes and cover letters", () => {
    for (const question of [
      "LinkedIn URL",
      "Do you require visa sponsorship?",
      "Are you willing to relocate?",
      "Attach your resume or cover letter",
    ])
      expect(isOpenQuestion(box(), question)).toBe(false);
  });
});
