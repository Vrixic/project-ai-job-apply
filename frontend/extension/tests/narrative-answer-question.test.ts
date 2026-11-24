// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isOpenQuestion, questionOf } from "../lib/narrative-answer-page";

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

describe("questionOf", () => {
  it("reads a Lever question from its heading, without the required mark", () => {
    document.body.innerHTML =
      '<ul><li class="application-question custom-question"><div>' +
      '<div class="application-label full-width textarea"><div class="text">' +
      'Why Acme / this position?<span class="required">✱</span></div></div>' +
      '<div class="application-field full-width required-field">' +
      '<textarea class="card-field-input" name="cards[x][field0]" required></textarea>' +
      "</div></div></li></ul>";
    const lever = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(questionOf(lever)).toBe("Why Acme / this position?");
    expect(isOpenQuestion(lever, questionOf(lever))).toBe(true);
  });

  it("does not guess a question for a box in a block with other controls", () => {
    document.body.innerHTML =
      '<ul><li class="application-question"><div class="application-label">' +
      '<div class="text">Tell us more</div></div><input type="text"><textarea></textarea></li></ul>';
    expect(questionOf(document.querySelector("textarea") as HTMLTextAreaElement)).toBe("");
  });
});
