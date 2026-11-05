// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEGREE_OPTIONS, FIELD_OF_STUDY_OPTIONS } from "../../lib/education-options";
import { EntryForm } from "./entry-form";
import { createBody, emptyValues, PROFILE_SECTIONS } from "./sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const education = PROFILE_SECTIONS.education;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("React", React);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(initial: Record<string, string>, onSubmit = vi.fn()) {
  act(() =>
    root.render(
      <EntryForm
        section={education}
        initialValues={{ ...emptyValues(education), ...initial }}
        submitLabel="Add"
        busy={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    ),
  );
  return onSubmit;
}
const select = (name: string) =>
  container.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
const optionTexts = (name: string) => Array.from(select(name).options).map((o) => o.textContent);

describe("the education form", () => {
  it("offers Degree and Field of study as dropdowns of the lists employer forms use", () => {
    render({ school: "Synthetic University" });
    expect(container.querySelector('input[name="degree"]')).toBeNull();
    expect(container.querySelector('input[name="fieldOfStudy"]')).toBeNull();
    expect(optionTexts("degree")).toEqual(["Choose…", ...DEGREE_OPTIONS]);
    expect(optionTexts("fieldOfStudy")).toEqual(["Choose…", ...FIELD_OF_STUDY_OPTIONS]);
    expect(DEGREE_OPTIONS).toContain("Bachelor's Degree");
    expect(FIELD_OF_STUDY_OPTIONS).toContain("Computer Science");
  });
  it("saves the chosen options exactly as listed", () => {
    const onSubmit = render({ school: "Synthetic University" });
    for (const [name, value] of [
      ["degree", "Bachelor's Degree"],
      ["fieldOfStudy", "Computer Science"],
    ] as const)
      act(() => {
        select(name).value = value;
        select(name).dispatchEvent(new Event("change", { bubbles: true }));
      });
    act(() => {
      (container.querySelector("form") as HTMLFormElement).requestSubmit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(createBody(education, onSubmit.mock.calls[0]?.[0])).toMatchObject({
      school: "Synthetic University",
      degree: "Bachelor's Degree",
      fieldOfStudy: "Computer Science",
    });
  });
  it("keeps a value saved before the lists existed selectable, and marks it", () => {
    render({
      school: "Synthetic University",
      degree: "Bachelors",
      fieldOfStudy: "Computer Science",
    });
    expect(select("degree").value).toBe("Bachelors");
    expect(optionTexts("degree")).toContain("Bachelors (saved)");
    expect(select("fieldOfStudy").value).toBe("Computer Science");
    expect(optionTexts("fieldOfStudy").some((text) => text?.endsWith("(saved)"))).toBe(false);
  });
  it("lists no option twice", () => {
    expect(new Set(DEGREE_OPTIONS).size).toBe(DEGREE_OPTIONS.length);
    expect(new Set(FIELD_OF_STUDY_OPTIONS).size).toBe(FIELD_OF_STUDY_OPTIONS.length);
  });
});
