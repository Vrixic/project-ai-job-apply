/**
 * Exact selection in the board's custom dropdowns (react-select). Only a value from the approved
 * packet is ever chosen, only when exactly one listed option is that value, and anything else is
 * handed back to the candidate with the dropdown left as it was found. Nothing is guessed or
 * matched to a nearest option.
 */

const normalize = (text: string | null | undefined) =>
  (text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[‘’ʼ`´]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

/**
 * The listed labels a packet value may mean. The value itself always counts. A degree is also
 * recognised by its level, because boards list levels ("Bachelor's Degree") where a resume says
 * "B.S." or "Bachelor of Science". This fixed table is the only place a value is mapped.
 */
export function acceptableLabels(fieldKey: string, value: string): string[] {
  const labels = [value];
  if (fieldKey !== "education.degree") return labels;
  const text = normalize(value).replace(/\./gu, "");
  if (/\b(mba|master of business administration)\b/u.test(text))
    labels.push("Master of Business Administration (M.B.A.)");
  else if (/^(?:bs|ba|bsc|bse|beng|btech|bfa|bba)\b|^bachelor/u.test(text))
    labels.push("Bachelor's Degree");
  else if (/^(?:ms|ma|msc|mse|meng|mtech|mfa|mph)\b|^master/u.test(text))
    labels.push("Master's Degree");
  else if (/^(?:phd|dphil)\b|^doctor of philosophy|^doctorate/u.test(text))
    labels.push("Doctor of Philosophy (Ph.D.)");
  else if (/^(?:jd)\b|^juris doctor/u.test(text)) labels.push("Juris Doctor (J.D.)");
  else if (/^(?:md)\b|^doctor of medicine/u.test(text)) labels.push("Doctor of Medicine (M.D.)");
  else if (/^(?:aa|as|aas)\b|^associate/u.test(text)) labels.push("Associate's Degree");
  else if (/^(?:high school|ged)\b|^secondary school/u.test(text)) labels.push("High School");
  return labels;
}

/** The one option that is exactly an acceptable label, if there is exactly one. */
export function exactOption(
  options: readonly Element[],
  fieldKey: string,
  value: string,
): Element | undefined {
  for (const label of acceptableLabels(fieldKey, value)) {
    const wanted = normalize(label);
    if (!wanted) continue;
    const matches = options.filter((option) => normalize(option.textContent) === wanted);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

const listboxOf = (control: HTMLInputElement) => {
  const id = control.getAttribute("aria-controls") || `react-select-${control.id}-listbox`;
  return control.ownerDocument.getElementById(id);
};
const optionsOf = (control: HTMLInputElement) =>
  Array.from(listboxOf(control)?.querySelectorAll('[role="option"]') ?? []);
const shownValue = (control: HTMLInputElement) =>
  normalize(
    control.closest(".select__control")?.querySelector(".select__single-value")?.textContent,
  );

/** Fields whose dropdown the board gives an "Other" entry for a value it does not list. */
const OTHER_FALLBACK = new Set(["education.school", "education.degree", "education.field"]);

export interface ComboboxHooks {
  /** False once the run is stopped, past its deadline or no longer approved. */
  current(): boolean;
  /** Resolves after the time, or rejects when the run is stopped. */
  wait(ms: number): Promise<void>;
}

/**
 * Chooses the option that is exactly the approved value. For education fields a value the board
 * does not list gets the board's own "Other" instead, reported as a fallback. Returns the chosen
 * label, or undefined when there is no single exact option (the dropdown is then left empty for
 * the candidate).
 */
export async function selectExactOption(
  control: HTMLInputElement,
  view: Window & typeof globalThis,
  fieldKey: string,
  value: string,
  hooks: ComboboxHooks,
): Promise<{ label: string; fallback: boolean } | undefined> {
  const setInput = (text: string) => {
    Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set?.call(
      control,
      text,
    );
    control.dispatchEvent(new view.Event("input", { bubbles: true }));
  };
  // The board opens a dropdown on a press and release of the mouse over it, as a click does.
  const press = async (target: Element) => {
    const box = target.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: box.left + Math.min(10, box.width / 2),
      clientY: box.top + Math.min(10, box.height / 2),
    };
    target.dispatchEvent(new view.MouseEvent("mousedown", init));
    await hooks.wait(100);
    target.dispatchEvent(new view.MouseEvent("mouseup", init));
  };
  const key = (name: string) =>
    control.dispatchEvent(
      new view.KeyboardEvent("keydown", { key: name, code: name, bubbles: true, cancelable: true }),
    );
  const until = async (done: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!done() && Date.now() < end && hooks.current()) await hooks.wait(100);
    return done();
  };
  // A list the board cuts off at a page (a searched list) must be searched; a shorter one is complete.
  const searchable = () =>
    optionsOf(control).length >= 100 ||
    listboxOf(control)?.querySelector(".select__menu-notice--loading") != null;
  // After typing, wait for the board's list to settle. It first filters what it already has, then
  // loads, so "none" and "other options" only count once the board has had time to load.
  const settle = async (label: string) => {
    const start = Date.now();
    let otherSince = 0;
    while (Date.now() < start + 4_000 && hooks.current()) {
      if (exactOption(optionsOf(control), fieldKey, label)) return;
      const list = listboxOf(control);
      const loading = list?.querySelector(".select__menu-notice--loading") != null;
      if (Date.now() - start >= 1_200 && !loading) {
        if (list?.querySelector(".select__menu-notice--no-options")) return;
        if (optionsOf(control).length > 0) {
          otherSince ||= Date.now();
          if (Date.now() - otherSince > 1_000) return;
        }
      } else otherSince = 0;
      await hooks.wait(100);
    }
  };
  const giveUp = async () => {
    if (control.value) setInput("");
    key("Escape");
    control.blur();
    return undefined;
  };
  if (shownValue(control) !== "") return undefined;
  await press(control.closest(".select__control") ?? control);
  if (!(await until(() => control.getAttribute("aria-expanded") === "true", 1_500)))
    return giveUp();
  // The options render a moment after the menu opens; a searched list stays empty until typed into.
  await until(() => optionsOf(control).length > 0, 800);
  let option = exactOption(optionsOf(control), fieldKey, value);
  if (!option && searchable()) {
    // A long list is searched: type the value and wait for the board to list what it has.
    setInput(value);
    await settle(value);
    option = exactOption(optionsOf(control), fieldKey, value);
  }
  let fallback = false;
  if (!option && OTHER_FALLBACK.has(fieldKey) && hooks.current()) {
    if (searchable() || control.value) {
      setInput("Other");
      await settle("Other");
    }
    option = exactOption(optionsOf(control), fieldKey, "Other");
    fallback = option !== undefined;
  }
  if (!option || !hooks.current()) return giveUp();
  const label = option.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  await press(option);
  (option as HTMLElement).click();
  if (!(await until(() => shownValue(control) === normalize(label), 1_500))) return giveUp();
  return { label, fallback };
}

/** Whether the dropdown shows exactly this label as its chosen value. */
export function showsOption(control: HTMLInputElement, label: string): boolean {
  return shownValue(control) === normalize(label);
}
