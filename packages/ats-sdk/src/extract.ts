import type { ApplicationFormModel, FormField, FormFieldType } from "./form-model.js";

/**
 * Provider-neutral extraction from standard form semantics only (labels, aria, fieldsets). It reads
 * structure and never reads or records any value a candidate typed. Hidden, disabled, and
 * submit-like controls are excluded. Throws RangeError rather than returning a partial model when
 * field, option or normalized text limits are exceeded. Callers must leave the page to the candidate.
 */
export function extractGenericForm(root: ParentNode = document): ApplicationFormModel {
  const CHALLENGE_SELECTOR =
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey], [class*="captcha" i], [id*="captcha" i]';

  const MAX_FIELDS = 200;
  const MAX_OPTIONS = 250;
  const MAX_LABEL = 300;

  function clean(value: string | null | undefined): string {
    const text = (value ?? "").replace(/\s+/gu, " ").trim();
    if (text.length > MAX_LABEL)
      throw new RangeError("Application form text exceeds extraction limit");
    return text;
  }

  function byId(root: ParentNode, id: string): Element | undefined {
    return Array.from(root.querySelectorAll("[id]")).find(
      (candidate) => candidate.getAttribute("id") === id,
    );
  }

  function structureText(element: Element | undefined): string {
    if (!element) return "";
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    const pieces: string[] = [];
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement?.closest("input, textarea, select, option, script, style"))
        pieces.push(node.textContent ?? "");
      node = walker.nextNode();
    }
    return pieces.join(" ");
  }

  function labelFor(root: ParentNode, element: Element): string {
    const aria = clean(element.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/u)
        .map((id) => clean(structureText(byId(root, id))))
        .filter(Boolean)
        .join(" ");
      if (text) return clean(text);
    }
    const id = element.getAttribute("id");
    if (id) {
      const explicit = Array.from(root.querySelectorAll("label")).find(
        (candidate) => candidate.getAttribute("for") === id,
      );
      if (explicit) return clean(structureText(explicit));
    }
    const wrapping = element.closest("label");
    if (wrapping) return clean(structureText(wrapping));
    const fieldset = element.closest("fieldset");
    const legend = fieldset?.querySelector("legend");
    if (legend) return clean(structureText(legend));
    return clean(element.getAttribute("placeholder") || element.getAttribute("name"));
  }

  function fieldType(element: Element): FormFieldType {
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    switch (type) {
      case "radio":
      case "checkbox":
      case "file":
      case "date":
      case "number":
        return type;
      case "text":
      case "email":
      case "tel":
      case "url":
        return "text";
      default:
        return "unknown";
    }
  }

  /** A legend-less fieldset's own heading label: a direct child naming no control inside it. */
  function groupHeading(fieldset: HTMLFieldSetElement | null): Element | undefined {
    if (!fieldset) return undefined;
    const controlIds = new Set(
      Array.from(fieldset.querySelectorAll("input, textarea, select"), (element) =>
        element.getAttribute("id"),
      ),
    );
    return Array.from(fieldset.children).find(
      (child) =>
        child.tagName.toLowerCase() === "label" &&
        !child.querySelector("input, textarea, select") &&
        !controlIds.has(child.getAttribute("for")),
    );
  }
  function isRequired(element: Element): boolean {
    return (
      element.hasAttribute("required") ||
      element.getAttribute("aria-required") === "true" ||
      /\*\s*$/u.test(labelFor(element.ownerDocument, element))
    );
  }

  const fields: FormField[] = [];
  const radioGroups = new Map<string, FormField>();
  const controls = root.querySelectorAll("input, textarea, select");
  let index = 0;
  for (const control of Array.from(controls)) {
    const type = fieldType(control);
    const inputType = (control.getAttribute("type") ?? "").toLowerCase();
    if (
      ["hidden", "submit", "button", "reset", "image", "password"].includes(inputType) ||
      control.hasAttribute("disabled")
    ) {
      continue;
    }
    const name = clean(control.getAttribute("name") || control.getAttribute("id"));
    if (type === "radio" && name) {
      const existing = radioGroups.get(name);
      const optionLabel = labelFor(control.ownerDocument, control);
      if (existing) {
        if (existing.options.length >= MAX_OPTIONS)
          throw new RangeError("Application form options exceed extraction limit");
        existing.options.push(optionLabel);
        existing.required ||= isRequired(control);
        continue;
      }
      if (fields.length >= MAX_FIELDS)
        throw new RangeError("Application form fields exceed extraction limit");
      const field: FormField = {
        ref: `f${index++}`,
        label:
          clean(structureText(control.closest("fieldset")?.querySelector("legend") ?? undefined)) ||
          clean(structureText(groupHeading(control.closest("fieldset")))) ||
          optionLabel,
        name,
        type: "radio",
        required: isRequired(control),
        options: [optionLabel],
      };
      radioGroups.set(name, field);
      fields.push(field);
      continue;
    }
    if (fields.length >= MAX_FIELDS)
      throw new RangeError("Application form fields exceed extraction limit");
    const optionElements = type === "select" ? control.querySelectorAll("option") : [];
    if (optionElements.length > MAX_OPTIONS)
      throw new RangeError("Application form options exceed extraction limit");
    const options =
      type === "select"
        ? Array.from(optionElements)
            .map((option) => clean(option.textContent))
            .filter(Boolean)
        : [];
    fields.push({
      ref: `f${index++}`,
      label: labelFor(control.ownerDocument, control),
      name,
      type,
      required: isRequired(control),
      options,
    });
  }
  return { fields, challengePresent: root.querySelector(CHALLENGE_SELECTOR) !== null };
}
