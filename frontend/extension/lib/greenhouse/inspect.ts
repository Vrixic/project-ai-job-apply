import { extractGenericForm } from "@ai-job-apply/ats-sdk/extract";
import { formStructureDigestInput } from "@ai-job-apply/ats-sdk/observed-form";

export interface GreenhouseInspection {
  identity: { tenant: string; jobId: string };
  form: ReturnType<typeof extractGenericForm>;
  structure: string;
  resolve(ref: string): readonly Element[];
  dispose(): void;
}

const HOSTS = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io"]);
const TENANT = /^[a-zA-Z0-9_-]{1,100}$/u;
const JOB = /^[0-9]{1,20}$/u;
const CHALLENGE =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey], [class*="captcha" i], [id*="captcha" i], input[autocomplete="one-time-code"], input[type="password"]';
const refused = () => new Error("GreenhouseInspectionUnavailable");

/** Global stop signal also applies after the application form has disappeared. */
export function greenhouseChallengePresent(document: Document): boolean {
  const walker = document.createTreeWalker(document, 1);
  let nodes = 0;
  while (walker.nextNode()) {
    if (++nodes > 10_000) throw refused();
  }
  return document.querySelector(CHALLENGE) !== null;
}

/** Exact supported host/path metadata only. This is not provider fixture acceptance. */
export function greenhouseApplicationIdentity(
  value: string,
): { tenant: string; jobId: string } | undefined {
  try {
    const url = new URL(value);
    if (
      value.length > 2048 ||
      url.protocol !== "https:" ||
      !HOSTS.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return undefined;
    const path = /^\/([a-zA-Z0-9_-]+)\/jobs\/([0-9]+)\/?$/u.exec(url.pathname);
    if (path?.[1] && path[2] && TENANT.test(path[1]) && JOB.test(path[2]))
      return { tenant: path[1], jobId: path[2] };
    if (url.pathname !== "/embed/job_app") return undefined;
    const tenant = url.searchParams.get("for") ?? "";
    const jobId = url.searchParams.get("token") ?? "";
    if (
      url.searchParams.getAll("for").length !== 1 ||
      url.searchParams.getAll("token").length !== 1 ||
      !TENANT.test(tenant) ||
      !JOB.test(jobId)
    )
      return undefined;
    return { tenant, jobId };
  } catch {
    return undefined;
  }
}

/**
 * Inspect only the exact top-frame document. Never enters an iframe or reads entered values.
 * Returned structure is a plan input, not authorization to fill, attach or submit.
 */
function captureGreenhouseApplication(document: Document, expectedUrl: string) {
  const identity = greenhouseApplicationIdentity(expectedUrl);
  const challengePresent = greenhouseChallengePresent(document);
  if (
    !identity ||
    document.location.href !== expectedUrl ||
    !document.defaultView ||
    document.defaultView.top !== document.defaultView
  )
    throw refused();
  const roots = document.querySelectorAll("form#application_form, form#application-form");
  if (roots.length !== 1) throw refused();
  const root = roots[0];
  if (!root || root.querySelector("iframe")) throw refused();
  const form = extractGenericForm(root);
  form.challengePresent ||= challengePresent;
  if (form.fields.length === 0) throw refused();

  // Resolve by stable provider attributes, never by the extractor's positional fN handles.
  // The complete normalized structure is checked again before any later consumer uses a handle.
  const controls = Array.from(root.querySelectorAll("input, textarea, select")).filter(
    (control) =>
      !control.hasAttribute("disabled") &&
      !["hidden", "submit", "button", "reset", "image", "password"].includes(
        (control.getAttribute("type") ?? "").toLowerCase(),
      ),
  );
  const handles = new Map<string, readonly Element[]>();
  const idCounts = new Map<string, number>();
  for (const element of Array.from(document.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id") ?? "";
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const field of form.fields) {
    if (!field.name) throw refused();
    const matches = controls.filter(
      (control) =>
        (control.getAttribute("name") || control.getAttribute("id") || "")
          .replace(/\s+/gu, " ")
          .trim() === field.name,
    );
    if (
      matches.length === 0 ||
      (field.type !== "radio" && matches.length !== 1) ||
      (field.type === "radio" &&
        matches.some((control) => control.getAttribute("type")?.toLowerCase() !== "radio"))
    )
      throw refused();
    for (const control of matches) {
      const id = control.getAttribute("id");
      if (id && idCounts.get(id) !== 1) throw refused();
    }
    handles.set(field.ref, Object.freeze(matches));
  }
  return { identity, form, root, handles, structure: formStructureDigestInput(form) };
}

export function inspectGreenhouseApplication(
  document: Document,
  expectedUrl: string,
): GreenhouseInspection {
  const captured = captureGreenhouseApplication(document, expectedUrl);
  const { identity, form, root, handles, structure } = captured;
  let disposed = false;
  return {
    identity,
    form,
    structure,
    /** A changed URL, root, structure, challenge or control identity invalidates all handles. */
    resolve(ref: string): readonly Element[] {
      if (disposed) throw refused();
      const fresh = captureGreenhouseApplication(document, expectedUrl);
      if (fresh.structure !== structure || fresh.root !== root) throw refused();
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
