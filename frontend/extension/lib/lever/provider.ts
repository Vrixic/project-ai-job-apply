import type { ApplicationProvider } from "../providers/types";
import { chooseLeverOption, fillLeverFields, leverAdapterId, leverSelectionWritten } from "./fill";
import {
  describeLeverEntry,
  inspectLeverApplication,
  leverApplicationIdentity,
  leverChallengePresent,
  leverEntrySelector,
  leverFormSelector,
} from "./inspect";
import { leverExecutionProfile, leverVariantId } from "./profiles";

const unavailable = () => Error("LeverExecutionUnavailable");

function controlsSatisfied(controls: readonly Element[], required: boolean): boolean {
  const view = controls[0]?.ownerDocument.defaultView;
  if (!view || controls.length === 0) return false;
  const first = controls[0];
  // A widget the extension cannot read: only a not-required one can be assumed fine.
  if (
    !(
      first instanceof view.HTMLInputElement ||
      first instanceof view.HTMLSelectElement ||
      first instanceof view.HTMLTextAreaElement
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
  if (first instanceof view.HTMLInputElement) {
    if (first.type === "radio" || first.type === "checkbox")
      return controls.some(
        (control) => control instanceof view.HTMLInputElement && control.checked,
      );
    if (first.type === "file") return (first.files?.length ?? 0) > 0;
  }
  return first.value.trim() !== "";
}

export const leverProvider: ApplicationProvider = {
  id: "lever",
  adapterId: leverAdapterId,
  variantId: leverVariantId,
  // The page's submit button starts its hCaptcha, so pressing it is always the candidate's.
  candidateSubmits: true,
  identity: leverApplicationIdentity,
  challengePresent: leverChallengePresent,
  inspect: inspectLeverApplication,
  fill: fillLeverFields,
  chooseOption: chooseLeverOption,
  selectionWritten: leverSelectionWritten,
  root(document) {
    const roots = document.querySelectorAll(leverFormSelector);
    const root = roots[0];
    const view = document.defaultView;
    if (roots.length !== 1 || !view || !(root instanceof view.HTMLFormElement)) throw unavailable();
    return root;
  },
  submitControl(root, profile) {
    const view = root.ownerDocument.defaultView;
    const buttons = root.querySelectorAll(profile.submitSelector);
    const button = buttons[0];
    if (!view || buttons.length !== 1 || !(button instanceof view.HTMLButtonElement))
      throw unavailable();
    return button;
  },
  rootValid(root) {
    for (const entry of Array.from(root.querySelectorAll(leverEntrySelector))) {
      if (!entry.querySelector("input:not([type='hidden']), textarea, select")) continue;
      const described = describeLeverEntry(entry);
      if (!controlsSatisfied(described.controls, described.field.required)) return false;
    }
    return true;
  },
  controlsSatisfied,
  profile: leverExecutionProfile,
};
