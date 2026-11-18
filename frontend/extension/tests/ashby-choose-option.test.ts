// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/application"}
import { afterEach, describe, expect, it } from "vitest";
import { chooseAshbyOption } from "../lib/ashby/fill";
import { inspectAshbyApplication } from "../lib/ashby/inspect";

const URL = "https://jobs.ashbyhq.com/synthetic/00000000-0000-4000-8000-000000000001/application";

// Synthetic markup in the shape ADR-053 inspected: a Yes/No button pair and a radio group.
const PAGE = `
<div class="ashby-job-posting-right-pane">
  <div class="ashby-application-form-container">
    <div class="ashby-application-form-section-container">
      <div class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="onsite">
        <label class="_heading_x _required_x" for="onsite">Are you willing to work in our office?</label>
        <div class="_yesno_x"><button aria-pressed="false" data-option="yes">Yes</button>
          <button aria-pressed="false" data-option="no">No</button>
          <input type="checkbox" tabindex="-1" name="onsite"></div></div>
      <fieldset class="_fieldEntry_x ashby-application-form-field-entry" data-field-path="visa">
        <label class="_heading_x _required_x" for="visa-group">Will you require visa sponsorship?</label>
        <div><input type="radio" id="visa-0" name="visa"><label for="visa-0">No</label></div>
        <div><input type="radio" id="visa-1" name="visa"><label for="visa-1">Yes</label></div></fieldset>
    </div>
  </div>
  <button class="_button_x ashby-application-form-submit-button">Submit Application</button>
</div>`;

function mount() {
  document.body.innerHTML = PAGE;
  // The page records a pressed button, as Ashby does on its next render.
  for (const button of Array.from(document.querySelectorAll("button[data-option]")))
    button.addEventListener("click", () => {
      for (const other of Array.from(document.querySelectorAll("button[data-option]")))
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
    });
  return inspectAshbyApplication(document, URL);
}

const authority = () => ({ signal: new AbortController().signal, deadline: Date.now() + 30_000 });
const refOf = (inspection: ReturnType<typeof mount>, label: string) => {
  const field = inspection.form.fields.find((candidate) => candidate.label.startsWith(label));
  if (!field) throw new Error(`no field ${label}`);
  return field.ref;
};
const pressed = () =>
  Array.from(document.querySelectorAll("button[data-option]")).map((button) =>
    button.getAttribute("aria-pressed"),
  );

afterEach(() => {
  document.body.innerHTML = "";
});

describe("chooseAshbyOption (ADR-061)", () => {
  it("presses exactly the named button of an unanswered Yes/No question", async () => {
    const inspection = mount();
    const ref = refOf(inspection, "Are you willing");
    expect(await chooseAshbyOption(inspection, ref, "No", authority())).toBe(true);
    expect(pressed()).toEqual(["false", "true"]);
  });

  it("chooses one radio of an unanswered group", async () => {
    const inspection = mount();
    const ref = refOf(inspection, "Will you require");
    expect(await chooseAshbyOption(inspection, ref, "No", authority())).toBe(true);
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
  });

  it("never replaces an answer the candidate already gave", async () => {
    const inspection = mount();
    const ref = refOf(inspection, "Are you willing");
    document.querySelector<HTMLButtonElement>('button[data-option="yes"]')?.click();
    expect(await chooseAshbyOption(inspection, ref, "No", authority())).toBe(false);
    expect(pressed()).toEqual(["true", "false"]);
  });

  it("refuses an option the page does not offer, a disabled control and a stopped run", async () => {
    const inspection = mount();
    const ref = refOf(inspection, "Will you require");
    expect(await chooseAshbyOption(inspection, ref, "Maybe", authority())).toBe(false);
    for (const radio of Array.from(
      document.querySelectorAll<HTMLInputElement>("input[type=radio]"),
    ))
      radio.disabled = true;
    expect(await chooseAshbyOption(inspection, ref, "No", authority())).toBe(false);
    const stopped = new AbortController();
    stopped.abort();
    const again = mount();
    expect(
      await chooseAshbyOption(again, refOf(again, "Are you willing"), "No", {
        signal: stopped.signal,
        deadline: Date.now() + 30_000,
      }),
    ).toBe(false);
    expect(pressed()).toEqual(["false", "false"]);
  });
});
