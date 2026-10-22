import type { ApplicationProvider } from "../providers/types";
import { ashbyAdapterId, fillAshbyFields } from "./fill";
import {
  ashbyApplicationIdentity,
  ashbyChallengePresent,
  ashbyContainerSelector,
  ashbyPaneSelector,
  describeAshbyEntry,
  inspectAshbyApplication,
} from "./inspect";
import { ashbyExecutionProfile, ashbyVariantId } from "./profiles";

const unavailable = () => Error("AshbyExecutionUnavailable");

function controlsSatisfied(controls: readonly Element[], required: boolean): boolean {
  const view = controls[0]?.ownerDocument.defaultView;
  if (!view || controls.length === 0) return false;
  const first = controls[0];
  // A custom widget the extension cannot read: only a not-required one can be assumed fine.
  if (
    !(
      first instanceof view.HTMLInputElement ||
      first instanceof view.HTMLSelectElement ||
      first instanceof view.HTMLTextAreaElement ||
      first instanceof view.HTMLButtonElement
    )
  )
    return !required;
  for (const control of controls) {
    if (
      (control instanceof view.HTMLInputElement ||
        control instanceof view.HTMLSelectElement ||
        control instanceof view.HTMLTextAreaElement) &&
      !control.validity.valid
    )
      return false;
  }
  if (!required) return true;
  if (first instanceof view.HTMLButtonElement)
    return controls.some((control) => control.getAttribute("aria-pressed") === "true");
  if (first instanceof view.HTMLInputElement) {
    if (first.type === "radio")
      return controls.some(
        (control) => control instanceof view.HTMLInputElement && control.checked,
      );
    if (first.type === "checkbox")
      return controls.some(
        (control) => control instanceof view.HTMLInputElement && control.checked,
      );
    if (first.type === "file") return (first.files?.length ?? 0) > 0;
  }
  return (first as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value.trim() !== "";
}

export const ashbyProvider: ApplicationProvider = {
  id: "ashby",
  adapterId: ashbyAdapterId,
  variantId: ashbyVariantId,
  identity: ashbyApplicationIdentity,
  challengePresent: ashbyChallengePresent,
  inspect: inspectAshbyApplication,
  fill: fillAshbyFields,
  /** The right pane holds the field container and the submit control, which is not in a form. */
  root(document) {
    const panes = document.querySelectorAll(ashbyPaneSelector);
    const pane = panes[0];
    if (panes.length !== 1 || !pane || pane.querySelectorAll(ashbyContainerSelector).length !== 1)
      throw unavailable();
    return pane;
  },
  submitControl(root, profile) {
    const view = root.ownerDocument.defaultView;
    const buttons = root.querySelectorAll(profile.submitSelector);
    const button = buttons[0];
    if (
      !view ||
      buttons.length !== 1 ||
      !(button instanceof view.HTMLButtonElement) ||
      button.type !== "submit" ||
      button.closest(ashbyContainerSelector)
    )
      throw unavailable();
    return button;
  },
  /** Page validity here is each required entry: Ashby does not use a form for it. */
  rootValid(root) {
    const container = root.querySelector(ashbyContainerSelector);
    if (!container) return false;
    for (const entry of Array.from(
      container.querySelectorAll(".ashby-application-form-field-entry"),
    )) {
      const described = describeAshbyEntry(entry);
      if (!controlsSatisfied(described.controls, described.field.required)) return false;
    }
    return true;
  },
  controlsSatisfied,
  profile: ashbyExecutionProfile,
};
