/**
 * Choice questions on a Greenhouse board for AI-chosen answers (ADR-061): which required single-choice
 * questions the candidate has not answered, with their option labels, and choosing one option. A
 * question is a radio group, a native select, or the board's custom dropdown (react-select). The
 * custom dropdown lists its options only once opened, so its labels come from the board's own question
 * data in the page, and are checked again against the opened list before anything is chosen.
 */
import type { ApplicationInspection, FillAuthority } from "../providers/types";
import { selectExactOption, showsOption } from "./combobox";
import { requireActionable } from "./fill";

const normalize = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();

/** The board's single-choice questions by field name, from its page data. Read once per document. */
const pageQuestions = new WeakMap<Document, Promise<ReadonlyMap<string, readonly string[]>>>();
const DATA = /^\s*window\.__remixContext\s*=/u;
const MAXIMUM_PAGE = 2_000_000;

/** Field name to option labels for each single-select question in one `__remixContext` script. */
function questionOptionsFrom(text: string, found: Map<string, readonly string[]>) {
  if (!DATA.test(text) || text.length > MAXIMUM_PAGE) return;
  let state: unknown;
  try {
    state = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return;
  }
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "questions" && Array.isArray(child)) {
        for (const question of child) {
          const fields = (question as { fields?: unknown })?.fields;
          if (!Array.isArray(fields)) continue;
          for (const field of fields) {
            const { name, type, values } = (field ?? {}) as {
              name?: unknown;
              type?: unknown;
              values?: unknown;
            };
            if (
              typeof name !== "string" ||
              type !== "multi_value_single_select" ||
              !Array.isArray(values) ||
              found.has(name)
            )
              continue;
            const labels = values.map((entry) =>
              normalize(
                typeof (entry as { label?: unknown })?.label === "string"
                  ? (entry as { label: string }).label
                  : "",
              ),
            );
            if (labels.every((label) => label.length > 0)) found.set(name, labels);
          }
        }
      } else visit(child, depth + 1);
    }
  };
  visit(state, 0);
}

/**
 * Field name to option labels for every single-select question in the board's page data
 * (`window.__remixContext`, an inline script the board removes once its page has started). It is
 * read from the page while still there, otherwise from the page's own HTML fetched again from the
 * same address without cookies. Untrusted employer data, used only to know which labels to offer;
 * the chosen label must still be exactly one option of the opened list. Empty when unreadable.
 */
export function greenhouseQuestionOptions(
  document: Document,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const cached = pageQuestions.get(document);
  if (cached) return cached;
  const read = (async () => {
    const found = new Map<string, readonly string[]>();
    for (const script of Array.from(document.querySelectorAll("script:not([src])")))
      questionOptionsFrom(script.textContent ?? "", found);
    if (found.size > 0) return found;
    const view = document.defaultView;
    if (!view) return found;
    try {
      const response = await view.fetch(document.location.href, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      const length = Number(response.headers.get("content-length") ?? 0);
      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "").startsWith("text/html") ||
        length > MAXIMUM_PAGE
      )
        return found;
      const html = await response.text();
      if (html.length > MAXIMUM_PAGE) return found;
      const page = new view.DOMParser().parseFromString(html, "text/html");
      for (const script of Array.from(page.querySelectorAll("script:not([src])")))
        questionOptionsFrom(script.textContent ?? "", found);
    } catch {
      // Unreadable data offers no dropdown question; the candidate answers it as before.
    }
    return found;
  })();
  pageQuestions.set(document, read);
  return read;
}

/** See {@link ApplicationProvider.unansweredChoice}. */
export async function greenhouseUnansweredChoice(
  inspection: ApplicationInspection,
  ref: string,
): Promise<readonly string[] | undefined> {
  const field = inspection.form.fields.find((candidate) => candidate.ref === ref);
  if (!field?.required) return undefined;
  let controls: readonly Element[];
  try {
    controls = inspection.resolve(ref);
  } catch {
    return undefined;
  }
  const control = controls[0];
  const view = control?.ownerDocument.defaultView;
  if (!control || !view) return undefined;
  if (field.type === "radio")
    return controls.some((radio) => radio instanceof view.HTMLInputElement && radio.checked)
      ? undefined
      : field.options;
  if (controls.length !== 1) return undefined;
  if (control instanceof view.HTMLSelectElement) {
    if (control.multiple || control.value !== "") return undefined;
    return Array.from(control.options)
      .filter((option) => option.value !== "" && !option.disabled)
      .map((option) => normalize(option.textContent));
  }
  if (
    control instanceof view.HTMLInputElement &&
    control.getAttribute("role") === "combobox" &&
    control.type === "text" &&
    showsOption(control, "")
  )
    return (await greenhouseQuestionOptions(control.ownerDocument)).get(field.name);
  return undefined;
}

/** See {@link ApplicationProvider.chooseOption}. */
export async function chooseGreenhouseOption(
  inspection: ApplicationInspection,
  ref: string,
  option: string,
  authority: Pick<FillAuthority, "signal" | "deadline">,
): Promise<boolean> {
  const field = inspection.form.fields.find((candidate) => candidate.ref === ref);
  const controls = inspection.resolve(ref);
  const first = controls[0];
  const view = first?.ownerDocument.defaultView as (Window & typeof globalThis) | null | undefined;
  const live = () => !authority.signal.aborted && Date.now() < authority.deadline;
  if (!field || !first || !view || !live()) return false;
  const wanted = normalize(option);

  if (field.type === "radio") {
    // Never over an answer the candidate has already given.
    if (controls.some((radio) => radio instanceof view.HTMLInputElement && radio.checked))
      return false;
    const matches = controls.filter((_, index) => normalize(field.options[index]) === wanted);
    const radio = matches[0];
    if (
      controls.length !== field.options.length ||
      matches.length !== 1 ||
      !(radio instanceof view.HTMLInputElement) ||
      radio.type !== "radio"
    )
      return false;
    try {
      requireActionable(radio, view);
    } catch {
      return false;
    }
    radio.click();
    inspection.resolve(ref);
    return (
      radio.checked &&
      controls.every((other) => other === radio || !(other as HTMLInputElement).checked)
    );
  }

  if (controls.length !== 1) return false;
  try {
    requireActionable(first, view);
  } catch {
    return false;
  }

  if (first instanceof view.HTMLSelectElement) {
    if (first.multiple || first.value !== "") return false;
    const matches = Array.from(first.options).filter(
      (candidate) =>
        candidate.value !== "" &&
        !candidate.disabled &&
        normalize(candidate.textContent) === wanted,
    );
    const chosen = matches[0];
    if (matches.length !== 1 || !chosen) return false;
    // The native setter, so a framework that tracks the value sees a real change.
    Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, "value")?.set?.call(
      first,
      chosen.value,
    );
    for (const event of ["input", "change"])
      first.dispatchEvent(new view.Event(event, { bubbles: true }));
    inspection.resolve(ref);
    return first.value === chosen.value && first.selectedOptions[0] === chosen;
  }

  if (
    first instanceof view.HTMLInputElement &&
    first.getAttribute("role") === "combobox" &&
    first.type === "text"
  ) {
    // Only a label the page data offered, and only when the opened list has exactly that one.
    const offered = (await greenhouseQuestionOptions(first.ownerDocument)).get(field.name);
    if (!offered?.includes(wanted)) return false;
    const chosen = await selectExactOption(first, view, "choice.answer", wanted, {
      current: live,
      wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });
    inspection.resolve(ref);
    return chosen !== undefined && !chosen.fallback && showsOption(first, wanted);
  }
  return false;
}
