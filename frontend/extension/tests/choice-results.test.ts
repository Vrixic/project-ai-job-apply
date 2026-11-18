// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { choiceSummary, isChoiceResult, showChoiceResults } from "../lib/choice-results";

const result = {
  asked: 3,
  applied: [{ question: "Office <b>days</b>?", option: "No" }],
  proposals: [{ ref: "f4", question: "Sponsorship?", option: "No", probability: 0.93 }],
  left: 1,
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isChoiceResult", () => {
  it("accepts a well-formed result and rejects anything else", () => {
    expect(isChoiceResult(result)).toBe(true);
    expect(isChoiceResult({ ...result, asked: -1 })).toBe(false);
    expect(isChoiceResult({ ...result, proposals: [{ ...result.proposals[0], ref: "a b" }] })).toBe(
      false,
    );
    expect(
      isChoiceResult({ ...result, proposals: [{ ...result.proposals[0], probability: 2 }] }),
    ).toBe(false);
    expect(isChoiceResult(null)).toBe(false);
  });
});

describe("choiceSummary", () => {
  it("says what AI chose, what waits for confirmation and what is still the candidate's", () => {
    const text = choiceSummary(result);
    expect(text).toContain("AI chose 1 answer");
    expect(text).toContain("1 restricted answer waits for your confirmation");
    expect(text).toContain("1 choice question still needs your own answer");
  });

  it("is quiet when nothing was asked, and plain when the answers were unavailable", () => {
    expect(choiceSummary({ ...result, asked: 0 })).toBe("");
    expect(
      choiceSummary({ asked: 2, applied: [], proposals: [], left: 2, unavailable: "unavailable" }),
    ).toContain("not available right now");
  });
});

describe("showChoiceResults", () => {
  it("shows the employer's words as text, and chooses a restricted answer only when confirmed", async () => {
    document.body.innerHTML = '<p id="status"></p>';
    const status = document.getElementById("status") as HTMLElement;
    const confirm = vi.fn(async () => true);
    showChoiceResults(status, result, confirm);
    // Markup in a question is text, never elements.
    expect(document.querySelector("[data-choice-applied] b")).toBeNull();
    expect(document.querySelector("[data-choice-applied]")?.textContent).toContain("<b>days</b>");
    expect(confirm).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>("[data-choice-use=f4]")?.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith("f4", true));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-choice-proposal=f4]")?.textContent).toContain(
        "Chosen on the page",
      ),
    );
  });

  it("forgets a restricted proposal the candidate declines", async () => {
    document.body.innerHTML = '<p id="status"></p>';
    const confirm = vi.fn(async () => false);
    showChoiceResults(document.getElementById("status") as HTMLElement, result, confirm);
    document.querySelector<HTMLButtonElement>("[data-choice-skip=f4]")?.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith("f4", false));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-choice-proposal=f4]")?.textContent).toBe("Left to you."),
    );
  });
});
