import type { ApplicationFormModel, FormField, FormFieldType } from "./form-model.js";

const WIDGET_CHALLENGE_SELECTOR =
  'iframe[src*="hcaptcha"], iframe[src*="turnstile"], .h-captcha, .cf-turnstile, [class*="captcha" i]:not([class*="recaptcha" i]), [id*="captcha" i]:not([id*="recaptcha" i])';
const RECAPTCHA_WIDGET_SELECTOR = ".g-recaptcha, [data-sitekey]";

/** Whether the element, or any ancestor, is not shown. Computed style only; no layout is read. */
function hiddenByStyle(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false; // cannot tell, so treat it as shown (fail closed)
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (
      node.hasAttribute("hidden") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return true;
  }
  return false;
}

/**
 * An interactive CAPTCHA the candidate would have to solve (ADR-053). The invisible reCAPTCHA
 * badge, its response field and its hidden challenge frame are not one: they sit on most ATS pages
 * and need no action. A visible challenge frame, a checkbox widget, hCaptcha or Turnstile is one.
 * This only classifies the page; nothing is ever solved, read or bypassed.
 */
export function interactiveCaptchaPresent(root: ParentNode): boolean {
  if (root.querySelector(WIDGET_CHALLENGE_SELECTOR) !== null) return true;
  for (const widget of Array.from(root.querySelectorAll(RECAPTCHA_WIDGET_SELECTOR))) {
    if (widget.closest(".grecaptcha-badge") || widget.getAttribute("data-size") === "invisible")
      continue;
    return true;
  }
  for (const frame of Array.from(root.querySelectorAll('iframe[src*="recaptcha"]'))) {
    if (frame.closest(".grecaptcha-badge")) continue;
    if (!hiddenByStyle(frame)) return true;
  }
  return false;
}

/**
 * Provider-neutral extraction from standard form semantics only (labels, aria, fieldsets). It reads
 * structure and never reads or records any value a candidate typed. Hidden, disabled, and
 * submit-like controls are excluded. Throws RangeError rather than returning a partial model when
 * field, option or normalized text limits are exceeded. Callers must leave the page to the candidate.
 */
export function extractGenericForm(root: ParentNode = document): ApplicationFormModel {
  // Serialized into the page with this function, so it cannot import the exported classifier; a test
  // keeps the two identical in behavior.
  function captchaPresent(scope: ParentNode): boolean {
    const hidden = (element: Element): boolean => {
      const view = element.ownerDocument.defaultView;
      if (!view) return false; // cannot tell, so treat it as shown (fail closed)
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (
          node.hasAttribute("hidden") ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0"
        )
          return true;
      }
      return false;
    };
    if (
      scope.querySelector(
        'iframe[src*="hcaptcha"], iframe[src*="turnstile"], .h-captcha, .cf-turnstile, [class*="captcha" i]:not([class*="recaptcha" i]), [id*="captcha" i]:not([id*="recaptcha" i])',
      ) !== null
    )
      return true;
    for (const widget of Array.from(scope.querySelectorAll(".g-recaptcha, [data-sitekey]"))) {
      if (widget.closest(".grecaptcha-badge") || widget.getAttribute("data-size") === "invisible")
        continue;
      return true;
    }
    for (const frame of Array.from(scope.querySelectorAll('iframe[src*="recaptcha"]'))) {
      if (frame.closest(".grecaptcha-badge")) continue;
      if (!hidden(frame)) return true;
    }
    return false;
  }
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
    // A custom combobox (for example react-select) holds its chosen value outside the input, so
    // writing text into it selects nothing. Hand it to the candidate rather than guess.
    if (
      element.getAttribute("role") === "combobox" ||
      element.hasAttribute("aria-haspopup") ||
      element.hasAttribute("aria-autocomplete")
    )
      return "unknown";
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
    // A control hidden from assistive technology and the tab order is not something a person can
    // operate; custom widgets use one as a validation shim for the visible combobox.
    if (
      ["hidden", "submit", "button", "reset", "image", "password"].includes(inputType) ||
      control.hasAttribute("disabled") ||
      (control.getAttribute("aria-hidden") === "true" && control.getAttribute("tabindex") === "-1")
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
  return { fields, challengePresent: captchaPresent(root) };
}
