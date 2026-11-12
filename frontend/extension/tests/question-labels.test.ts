import { describe, expect, it } from "vitest";
import { questionLabels } from "../lib/question-labels";

describe("questionLabels", () => {
  it("keeps the first five, as plain one-line text", () => {
    const labels = questionLabels(["A", "B", "C", "D", "E", "F", "G"]);
    expect(labels).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("collapses whitespace and removes control, zero-width and direction characters", () => {
    const zeroWidth = String.fromCodePoint(0x200b);
    const rightToLeft = String.fromCodePoint(0x202e);
    const nul = String.fromCodePoint(0);
    const lineSeparator = String.fromCodePoint(0x2028);
    const paragraphSeparator = String.fromCodePoint(0x2029);
    expect(
      questionLabels([
        `  Why
 do	 you${zeroWidth} want${rightToLeft} this${nul} role? `,
        `${lineSeparator}Where${paragraphSeparator} from?`,
      ]),
    ).toEqual(["Why do you want this role?", "Where from?"]);
  });

  it("drops the required-star a board puts inside a label", () => {
    expect(questionLabels(["Why this role? *", "Why this role? **", "A * B"])).toEqual([
      "Why this role?",
      "Why this role?",
      "A * B",
    ]);
  });

  it("bounds a long label to 120 characters, ending in an ellipsis", () => {
    const [label = ""] = questionLabels(["x".repeat(500)]);
    expect([...label]).toHaveLength(120);
    expect(label.endsWith("…")).toBe(true);
  });

  it("never returns an empty label", () => {
    expect(questionLabels(["", "   ", String.fromCodePoint(0x200b)])).toEqual([
      "(an unnamed question)",
      "(an unnamed question)",
      "(an unnamed question)",
    ]);
  });
});
