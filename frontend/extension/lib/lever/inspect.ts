import { formStructureDigestInput } from "@ai-job-apply/ats-sdk/observed-form";
import type { ApplicationInspection } from "../providers/types";

/**
 * Lever application pages (`jobs.lever.co/<site>/<posting>/apply`) are one server-rendered
 * `form#application-form`. Each question is an `.application-question` block: its text is in
 * `.application-label` and its standard controls are in `.application-field`. The resume input is a
 * transparent file input laid over the visible "Attach resume" button, and the location box is an
 * autocomplete that keeps its choice in a hidden input. Structure observed read-only on a public
 * posting on 2026-11-24 (ADR-053 amendment); it is not provider fixture acceptance.
 *
 * The page always carries an invisible hCaptcha that only runs when the candidate presses the
 * page's own submit button. The extension never presses that button on Lever.
 */
export const leverFormSelector = "form#application-form";
export const leverEntrySelector = ".application-question";
const ENTRY = leverEntrySelector;
const HOST = "jobs.lever.co";
const SITE = /^[A-Za-z0-9_.-]{1,100}$/u;
const POSTING = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_ENTRIES = 100;
const MAX_OPTIONS = 50;
const MAX_TEXT = 300;
const MAXIMUM_NODES = 10_000;
// A credential or one-time-code prompt always needs the candidate (ADR-046, ADR-053).
const CREDENTIAL_PROMPT = 'input[autocomplete="one-time-code"], input[type="password"]';
const CHALLENGE_FRAME =
  'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="turnstile"], .cf-turnstile';
const refused = () => new Error("LeverInspectionUnavailable");

type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file"
  | "date"
  | "number"
  | "unknown";

export interface LeverEntry {
  field: {
    label: string;
    name: string;
    type: FieldType;
    required: boolean;
    options: string[];
  };
  controls: readonly Element[];
}

/** Exact supported host and the application path only. The posting overview is not the form. */
export function leverApplicationIdentity(
  value: string,
): { tenant: string; jobId: string } | undefined {
  try {
    const url = new URL(value);
    if (
      value.length > 2048 ||
      url.protocol !== "https:" ||
      url.hostname !== HOST ||
      url.port ||
      url.username ||
      url.password
    )
      return undefined;
    const path = /^\/([^/]+)\/([^/]+)\/apply\/?$/u.exec(url.pathname);
    if (path?.[1] && path[2] && SITE.test(path[1]) && POSTING.test(path[2]))
      return { tenant: path[1], jobId: path[2].toLowerCase() };
    return undefined;
  } catch {
    return undefined;
  }
}

/** Shown to the candidate: not hidden by its own style or an ancestor's. */
function shown(element: Element, view: Window): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (
      node.hasAttribute("hidden") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return false;
  }
  return true;
}

/**
 * A challenge the candidate has to act on: a credential prompt, or a CAPTCHA frame that is actually
 * shown. Lever's idle hCaptcha (frames hidden by style inside `#h-captcha`) is not one; it only
 * opens after the candidate presses submit. Nothing is ever solved, read or bypassed.
 */
export function leverChallengePresent(document: Document): boolean {
  const walker = document.createTreeWalker(document, 1);
  let nodes = 0;
  while (walker.nextNode()) {
    if (++nodes > MAXIMUM_NODES) throw refused();
  }
  if (document.querySelector(CREDENTIAL_PROMPT) !== null) return true;
  const view = document.defaultView;
  // Visibility cannot be told without a window, so treat any frame as a challenge (fail closed).
  return Array.from(document.querySelectorAll(CHALLENGE_FRAME)).some(
    (frame) => !view || shown(frame, view),
  );
}

function clean(value: string | null | undefined): string {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length > MAX_TEXT) throw refused();
  return text;
}

/** Visible text, without the page's own required marker. */
function textOf(element: Element | null | undefined): string {
  if (!element) return "";
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const pieces: string[] = [];
  let node = walker.nextNode();
  while (node) {
    if (!node.parentElement?.closest(".required")) pieces.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return clean(pieces.join(" "));
}

/** The text of one radio or checkbox choice: its own label, without the control. */
export function leverOptionLabel(control: Element): string {
  return textOf(control.closest("label"));
}

function inputType(control: Element): FieldType {
  const type = (control.getAttribute("type") ?? "text").toLowerCase();
  // The location box keeps its choice in a hidden input the page fills from its own suggestions.
  if (
    control.classList.contains("location-input") ||
    control.getAttribute("role") === "combobox" ||
    control.hasAttribute("aria-haspopup")
  )
    return "unknown";
  if (["text", "email", "tel", "url", "search"].includes(type)) return "text";
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "unknown";
}

/** One question block: its label, type, requiredness and the controls that carry its answer. */
export function describeLeverEntry(entry: Element): LeverEntry {
  const heading = entry.querySelector(".application-label");
  const label = textOf(heading?.querySelector(".text") ?? heading);
  const radios = Array.from(entry.querySelectorAll('input[type="radio"]'));
  const checkboxes = Array.from(entry.querySelectorAll('input[type="checkbox"]'));
  const fileInputs = Array.from(entry.querySelectorAll('input[type="file"]'));
  const textareas = Array.from(entry.querySelectorAll("textarea"));
  const selects = Array.from(entry.querySelectorAll("select"));
  const inputs = Array.from(
    entry.querySelectorAll(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"])',
    ),
  );
  let type: FieldType = "unknown";
  let controls: Element[] = [entry];
  let options: string[] = [];
  if (radios.length > 0) {
    type = "radio";
    controls = radios;
    options = radios.map(leverOptionLabel);
  } else if (checkboxes.length > 0) {
    // A lone checkbox is a checkbox; a group of options is a multi-select left to the candidate.
    type = checkboxes.length === 1 ? "checkbox" : "unknown";
    controls = checkboxes;
  } else if (fileInputs.length === 1) {
    type = "file";
    controls = fileInputs;
  } else if (textareas.length === 1) {
    type = "textarea";
    controls = textareas;
  } else if (selects.length === 1 && selects[0]) {
    type = selects[0].hasAttribute("multiple") ? "unknown" : "select";
    controls = selects;
    // The placeholder option has no value and is not an answer.
    options = Array.from(selects[0].querySelectorAll("option"))
      .filter((option) => (option.getAttribute("value") ?? "") !== "")
      .map((option) => clean(option.textContent))
      .filter(Boolean);
  } else if (inputs.length === 1 && inputs[0]) {
    type = inputType(inputs[0]);
    controls = inputs;
  }
  if (options.length > MAX_OPTIONS) throw refused();
  const required =
    heading?.querySelector(".required") != null ||
    controls.some(
      (control) =>
        control.hasAttribute("required") || control.getAttribute("aria-required") === "true",
    );
  const name = clean(controls[0]?.getAttribute("name") || controls[0]?.getAttribute("id"));
  if (!name) throw refused();
  return { field: { label, name, type, required, options }, controls };
}

function capture(document: Document, expectedUrl: string) {
  const identity = leverApplicationIdentity(expectedUrl);
  const view = document.defaultView;
  if (!identity || document.location.href !== expectedUrl || !view || view.top !== view)
    throw refused();
  const forms = document.querySelectorAll(leverFormSelector);
  const container = forms[0];
  if (forms.length !== 1 || !container) throw refused();
  // A block with no control of its own (a heading or a note) is not a question.
  const entries = Array.from(container.querySelectorAll(ENTRY)).filter(
    (entry) => entry.querySelector("input:not([type='hidden']), textarea, select") !== null,
  );
  if (entries.length === 0 || entries.length > MAX_ENTRIES) throw refused();
  const fields: {
    ref: string;
    label: string;
    name: string;
    type: FieldType;
    required: boolean;
    options: string[];
  }[] = [];
  const handles = new Map<string, readonly Element[]>();
  const names = new Set<string>();
  entries.forEach((entry, index) => {
    if (entry.parentElement?.closest(ENTRY) || entry.querySelector("iframe")) throw refused();
    const { field, controls } = describeLeverEntry(entry);
    if (names.has(field.name)) throw refused();
    names.add(field.name);
    const ref = `f${index}`;
    fields.push({ ref, ...field });
    handles.set(ref, Object.freeze(controls));
  });
  const form = { fields, challengePresent: leverChallengePresent(document) };
  return { identity, form, container, handles, structure: formStructureDigestInput(form) };
}

/**
 * Inspect only the exact top-frame document. Never enters an iframe or reads entered values.
 * Returned structure is a plan input, not authorization to fill, attach or submit.
 */
export function inspectLeverApplication(
  document: Document,
  expectedUrl: string,
): ApplicationInspection {
  const first = capture(document, expectedUrl);
  const { identity, form, container, handles, structure } = first;
  let disposed = false;
  return {
    identity,
    form,
    structure,
    resolve(ref: string): readonly Element[] {
      if (disposed) throw refused();
      const fresh = capture(document, expectedUrl);
      if (fresh.structure !== structure || fresh.container !== container) throw refused();
      const original = handles.get(ref);
      const current = fresh.handles.get(ref);
      if (
        !original ||
        !current ||
        original.length !== current.length ||
        original.some((control, index) => control !== current[index] || !control.isConnected)
      )
        throw refused();
      return original;
    },
    dispose() {
      disposed = true;
      handles.clear();
    },
  };
}
