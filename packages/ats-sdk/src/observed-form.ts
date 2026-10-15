import type { ApplicationFormModel, FormField } from "./form-model.js";

/** Candidate-controlled structure handoff, never a provider authorization or an answer payload. */
export interface ObservedApplicationForm {
  schema: "application-observed-form.v1";
  applicationId: string;
  jobId: string;
  destination: string;
  capturedAt: number;
  form: ApplicationFormModel;
}

export function formStructureDigestInput(form: ApplicationFormModel): string {
  const fields = form.fields.map((field) => [
    field.label.trim().toLowerCase(),
    field.name,
    field.type,
    field.required,
    field.options.map((option) => option.trim().toLowerCase()),
  ]);
  return JSON.stringify({ v: 1, challenge: form.challengePresent, fields });
}

export function questionStructureDigestInput(field: FormField): string {
  return formStructureDigestInput({ fields: [field], challengePresent: false });
}

/** Provider application subpages of one exact posting (ADR-045 amendment, 2026-10-15). */
const APPLICATION_SUBPAGES: Readonly<Record<string, string>> = {
  "jobs.ashbyhq.com": "/application",
  "jobs.lever.co": "/apply",
};

/**
 * Returns the employer page bound to a canonical job source, or undefined. The page must be the
 * exact source URL, or that same posting's provider application subpage on the same origin. A
 * subpage is returned without its query string (provider tracking), so no query is recorded.
 */
export function employerPageForSource(sourceUrl: string, pageUrl: string): string | undefined {
  let source: URL;
  let page: URL;
  try {
    source = new URL(sourceUrl);
    page = new URL(pageUrl);
  } catch {
    return undefined;
  }
  for (const url of [source, page])
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined;
  if (page.href === source.href) return source.href;
  const suffix = APPLICATION_SUBPAGES[source.hostname];
  if (!suffix || source.search || page.origin !== source.origin) return undefined;
  const posting = source.pathname.replace(/\/$/u, "");
  return posting && page.pathname === `${posting}${suffix}`
    ? `${page.origin}${page.pathname}`
    : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length <= 300;
}

/** Strict bounded import. Unknown fields (including answer values) are refused, never stripped. */
export function parseObservedApplicationForm(
  textValue: string,
  now: number,
): ObservedApplicationForm | undefined {
  if (new TextEncoder().encode(textValue).byteLength > 65_536) return undefined;
  try {
    const value: unknown = JSON.parse(textValue);
    if (
      !object(value, ["schema", "applicationId", "jobId", "destination", "capturedAt", "form"]) ||
      value.schema !== "application-observed-form.v1" ||
      typeof value.applicationId !== "string" ||
      !UUID.test(value.applicationId) ||
      typeof value.jobId !== "string" ||
      !UUID.test(value.jobId) ||
      typeof value.destination !== "string" ||
      value.destination.length > 2048 ||
      typeof value.capturedAt !== "number" ||
      !Number.isSafeInteger(value.capturedAt) ||
      value.capturedAt > now ||
      now >= value.capturedAt + 60_000 ||
      !object(value.form, ["fields", "challengePresent"]) ||
      value.form.challengePresent !== false ||
      !Array.isArray(value.form.fields) ||
      value.form.fields.length < 1 ||
      value.form.fields.length > 200
    )
      return undefined;
    const url = new URL(value.destination);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.href !== value.destination
    )
      return undefined;
    const refs = new Set<string>();
    for (const field of value.form.fields) {
      if (
        !object(field, ["ref", "label", "name", "type", "required", "options"]) ||
        typeof field.ref !== "string" ||
        !/^f\d{1,3}$/u.test(field.ref) ||
        refs.has(field.ref) ||
        !text(field.label) ||
        !text(field.name) ||
        typeof field.required !== "boolean" ||
        ![
          "text",
          "textarea",
          "select",
          "radio",
          "checkbox",
          "file",
          "date",
          "number",
          "unknown",
        ].includes(String(field.type)) ||
        !Array.isArray(field.options) ||
        field.options.length > 250 ||
        !field.options.every(text)
      )
        return undefined;
      refs.add(field.ref);
    }
    return value as unknown as ObservedApplicationForm;
  } catch {
    return undefined;
  }
}
