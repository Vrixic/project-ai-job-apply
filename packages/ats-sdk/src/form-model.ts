import { createHash } from "node:crypto";

export type FormFieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file"
  | "date"
  | "number"
  | "unknown";

/**
 * One control on an application form. `ref` is an opaque, page-local handle that lets a later step
 * find the control again; it never carries a value the candidate entered.
 */
export interface FormField {
  ref: string;
  label: string;
  name: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
}

export interface ApplicationFormModel {
  fields: FormField[];
  /** True when a CAPTCHA/anti-automation challenge element is present. It is never bypassed. */
  challengePresent: boolean;
}

/**
 * Structural hash of the form: labels, names, types, required flags and options, in order. Values
 * are never included. A changed form yields a new hash, which invalidates approvals bound to the
 * old one.
 */
export function formStructureHash(form: ApplicationFormModel): string {
  const structure = form.fields.map((field) => [
    field.label.trim().toLowerCase(),
    field.name,
    field.type,
    field.required,
    field.options.map((option) => option.trim().toLowerCase()),
  ]);
  return createHash("sha256")
    .update(JSON.stringify({ v: 1, challenge: form.challengePresent, fields: structure }))
    .digest("hex");
}
