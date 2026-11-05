import type { ApplicationProvider } from "../providers/types";
import { fillGreenhouseFields } from "./fill";
import {
  greenhouseApplicationIdentity,
  greenhouseChallengePresent,
  inspectGreenhouseApplication,
} from "./inspect";
import { greenhouseExecutionProfile } from "./profiles";

const unavailable = () => Error("GreenhouseExecutionUnavailable");
const ROOT = "form#application_form, form#application-form";

/**
 * A board page moves to `/<tenant>/jobs/<id>/confirmation` after a successful submit (public
 * confirmation pages exist at that path). Same origin and exact path only; the query is ignored.
 */
function isConfirmationUrl(employerUrl: string, currentUrl: string): boolean {
  try {
    const identity = greenhouseApplicationIdentity(employerUrl);
    const employer = new URL(employerUrl);
    const current = new URL(currentUrl);
    return (
      identity !== undefined &&
      employer.pathname === `/${identity.tenant}/jobs/${identity.jobId}` &&
      current.origin === employer.origin &&
      !current.username &&
      !current.password &&
      current.pathname === `${employer.pathname}/confirmation`
    );
  } catch {
    return false;
  }
}

export const greenhouseProvider: ApplicationProvider = {
  id: "greenhouse",
  adapterId: "greenhouse-application-v1",
  variantId: "greenhouse-standard-v1",
  identity: greenhouseApplicationIdentity,
  challengePresent: greenhouseChallengePresent,
  inspect: inspectGreenhouseApplication,
  fill: fillGreenhouseFields,
  root(document) {
    const roots = document.querySelectorAll(ROOT);
    const root = roots[0];
    const view = document.defaultView;
    if (roots.length !== 1 || !view || !(root instanceof view.HTMLFormElement)) throw unavailable();
    return root;
  },
  submitControl(root, profile) {
    const view = root.ownerDocument.defaultView;
    const buttons = root.querySelectorAll(profile.submitSelector);
    const button = buttons[0];
    if (
      !view ||
      buttons.length !== 1 ||
      !(button instanceof view.HTMLButtonElement || button instanceof view.HTMLInputElement) ||
      button.type !== "submit" ||
      button.form !== root
    )
      throw unavailable();
    return button;
  },
  rootValid(root) {
    const view = root.ownerDocument.defaultView;
    return Boolean(view && root instanceof view.HTMLFormElement && root.checkValidity());
  },
  controlsSatisfied(controls, required) {
    const view = controls[0]?.ownerDocument.defaultView;
    if (!view || controls.length === 0) return false;
    for (const control of controls) {
      if (
        !(
          control instanceof view.HTMLInputElement ||
          control instanceof view.HTMLSelectElement ||
          control instanceof view.HTMLTextAreaElement
        ) ||
        !control.validity.valid
      )
        return false;
    }
    if (!required) return true;
    const first = controls[0];
    if (first instanceof view.HTMLInputElement) {
      // A custom combobox keeps its choice outside the input; the form's own required shim then
      // makes the root invalid, and the root check runs before any click.
      if (first.getAttribute("role") === "combobox") return true;
      if (first.type === "radio")
        return controls.some(
          (control) => control instanceof view.HTMLInputElement && control.checked,
        );
      if (first.type === "checkbox") return first.checked;
      if (first.type === "file") return (first.files?.length ?? 0) > 0;
    }
    return (
      (first as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value.trim() !== ""
    );
  },
  isConfirmationUrl,
  attachmentAccepted(root, fileName) {
    return Array.from(root.querySelectorAll(".file-upload__filename")).some(
      (element) => element.textContent?.includes(fileName) === true,
    );
  },
  profile: greenhouseExecutionProfile,
};
