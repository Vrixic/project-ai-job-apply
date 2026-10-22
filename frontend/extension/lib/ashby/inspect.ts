import { formStructureDigestInput } from "@ai-job-apply/ats-sdk/observed-form";
import { pageChallengePresent } from "../providers/challenge";
import type { ApplicationInspection } from "../providers/types";

/**
 * Ashby application pages (`jobs.ashbyhq.com/<org>/<job>/application`) have no `<form>` element.
 * Fields live in `.ashby-application-form-field-entry` blocks inside one
 * `.ashby-application-form-container`, the submit control is a sibling inside the right pane, and a
 * Yes/No question is a pair of `button[data-option]` backed by a hidden checkbox. Structure observed
 * read-only on a public posting on 2026-10-22 (ADR-053); it is not provider fixture acceptance.
 */
export const ashbyContainerSelector = ".ashby-application-form-container";
export const ashbyPaneSelector = ".ashby-job-posting-right-pane";
const ENTRY = ".ashby-application-form-field-entry";
const HOST = "jobs.ashbyhq.com";
const ORG = /^[A-Za-z0-9_.-]{1,100}$/u;
const JOB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_ENTRIES = 100;
const MAX_OPTIONS = 50;
const MAX_TEXT = 300;
const refused = () => new Error("AshbyInspectionUnavailable");

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

export interface AshbyEntry {
  field: {
    label: string;
    name: string;
    type: FieldType;
    required: boolean;
    options: string[];
  };
  controls: readonly Element[];
}

/** Exact supported host and path only. The overview tab and the application tab share a job. */
export function ashbyApplicationIdentity(
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
    const path = /^\/([^/]+)\/([^/]+)(?:\/application)?\/?$/u.exec(url.pathname);
    if (path?.[1] && path[2] && ORG.test(path[1]) && JOB.test(path[2]))
      return { tenant: path[1], jobId: path[2].toLowerCase() };
    return undefined;
  } catch {
    return undefined;
  }
}

/** Global stop signal, also after the form has been replaced by a confirmation message. */
export function ashbyChallengePresent(document: Document): boolean {
  return pageChallengePresent(document, refused);
}

function clean(value: string | null | undefined): string {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length > MAX_TEXT) throw refused();
  return text;
}

function textOf(element: Element | undefined): string {
  if (!element) return "";
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const pieces: string[] = [];
  let node = walker.nextNode();
  while (node) {
    pieces.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return clean(pieces.join(" "));
}

function optionLabel(control: Element): string {
  const id = control.getAttribute("id");
  const labels = id
    ? Array.from(control.ownerDocument.querySelectorAll("label")).filter(
        (label) => label.getAttribute("for") === id,
      )
    : [];
  return textOf(labels[0] ?? control.closest("label") ?? undefined);
}

function inputType(control: Element): FieldType {
  const type = (control.getAttribute("type") ?? "text").toLowerCase();
  // A custom combobox keeps its choice outside the input; hand it to the candidate.
  if (control.getAttribute("role") === "combobox" || control.hasAttribute("aria-haspopup"))
    return "unknown";
  if (["text", "email", "tel", "url", "search"].includes(type)) return "text";
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "unknown";
}

/** One field-entry block: its label, type, requiredness and the controls that carry its answer. */
export function describeAshbyEntry(entry: Element): AshbyEntry {
  const heading =
    Array.from(entry.children).find((child) => ["LABEL", "LEGEND"].includes(child.tagName)) ??
    entry.querySelector("label") ??
    undefined;
  const label = textOf(heading);
  const buttons = Array.from(entry.querySelectorAll("button[data-option]"));
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
  if (buttons.length >= 2) {
    // Yes/No: the visible choice is the buttons; the hidden checkbox only mirrors it.
    type = "radio";
    controls = buttons;
    options = buttons.map((button) => textOf(button));
  } else if (radios.length > 0) {
    type = "radio";
    controls = radios;
    options = radios.map(optionLabel);
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
    type = "select";
    controls = selects;
    options = Array.from(selects[0].querySelectorAll("option"))
      .map((option) => clean(option.textContent))
      .filter(Boolean);
  } else if (inputs.length === 1 && inputs[0]) {
    type = inputType(inputs[0]);
    controls = inputs;
  }
  if (options.length > MAX_OPTIONS) throw refused();
  const requiredMarker = entry.querySelector('[class*="_required_"]') !== null;
  const required =
    requiredMarker ||
    controls.some(
      (control) =>
        control.hasAttribute("required") || control.getAttribute("aria-required") === "true",
    );
  const name = clean(
    entry.getAttribute("data-field-path") ||
      controls[0]?.getAttribute("name") ||
      controls[0]?.getAttribute("id"),
  );
  if (!name) throw refused();
  return { field: { label, name, type, required, options }, controls };
}

function capture(document: Document, expectedUrl: string) {
  const identity = ashbyApplicationIdentity(expectedUrl);
  const view = document.defaultView;
  if (!identity || document.location.href !== expectedUrl || !view || view.top !== view)
    throw refused();
  const containers = document.querySelectorAll(ashbyContainerSelector);
  const container = containers[0];
  if (containers.length !== 1 || !container || container.querySelector("iframe")) throw refused();
  const entries = Array.from(container.querySelectorAll(ENTRY));
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
    if (entry.parentElement?.closest(ENTRY)) throw refused();
    const { field, controls } = describeAshbyEntry(entry);
    if (names.has(field.name)) throw refused();
    names.add(field.name);
    const ref = `f${index}`;
    fields.push({ ref, ...field });
    handles.set(ref, Object.freeze(controls));
  });
  const form = { fields, challengePresent: ashbyChallengePresent(document) };
  return { identity, form, container, handles, structure: formStructureDigestInput(form) };
}

/**
 * Inspect only the exact top-frame document. Never enters an iframe or reads entered values.
 * Returned structure is a plan input, not authorization to fill, attach or submit.
 */
export function inspectAshbyApplication(
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
