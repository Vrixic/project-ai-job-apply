import { describe, expect, it } from "vitest";
import { isSafeContributionDescription } from "./contribution-description.js";

describe("selected contribution description plaintext", () => {
  it.each([
    "Threshold < 10, throughput > 5.",
    "Threshold <= 10, throughput >= 5.",
    "Range 1 < 2 > 1; budget <$100 and headcount >500.",
    "Ratios <.5 or >-1.5; limits <=0.5 and >=-10.",
    "Keep x < y and y > z unchanged.",
    "Spacing matters: < p> is plaintext, not an HTML tag.",
    "Literal entity spelling &lt;script&gt; remains plain text.",
    "Unicode comparison ≤ 10, ≥ 5, ＜ 10 and ＞ 5.",
    "First paragraph.\nSecond\tparagraph.\r\nThird paragraph.",
  ])("accepts comparison text without modifying it: %s", (description) => {
    const before = description;
    expect(isSafeContributionDescription(description)).toBe(true);
    expect(description).toBe(before);
  });

  it.each([
    "<script>alert(1)</script>",
    "<b>Selected text</b>",
    "<img src=x onerror=alert(1)>",
    "Threshold < 10 followed by <img",
    "Incomplete <script",
    "Incomplete </div",
    "Incomplete <!-- comment",
    "Incomplete <!DOCTYPE",
    "Incomplete <?xml",
    "Complete <!-- comment -->",
    "Full-width ＜script＞hidden＜/script＞",
    "Mixed-width <ｓｃｒｉｐｔ",
    "Unsafe\u0000control",
    "Unsafe\u000bcontrol",
    "Unsafe\u000ccontrol",
    "Unsafe\u001fcontrol",
    "Unsafe\u007fcontrol",
    "Unsafe\u0085control",
    "Unsafe\u009fcontrol",
    "Unsafe\u202eoverride",
    "Unsafe\u2066isolate",
    "Unsafe\u2069isolate",
  ])("rejects markup starts and controls: %s", (description) => {
    expect(isSafeContributionDescription(description)).toBe(false);
  });
});
