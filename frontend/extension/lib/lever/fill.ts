import { buildFillPlan, type PacketValue } from "@ai-job-apply/ats-sdk/plan";
import { isActionable, isOverlayChoice } from "../actionable";
import { RUN_BUDGET_MS } from "../execution-budget";
import type { ApplicationInspection, FillAuthority } from "../providers/types";
import { leverOptionLabel } from "./inspect";

const unavailable = () => new Error("LeverFillUnavailable");
export const leverAdapterId = "lever-application-v1";

type View = Window & typeof globalThis;

/** The control must be one the candidate could use; a click target is also hit-tested. */
function requireActionable(control: Element, view: View, click = false) {
  if (click && isOverlayChoice(control, view)) {
    control.scrollIntoView?.({ block: "center", inline: "nearest" });
  }
  if (!isActionable(control, view, { hitTest: click })) throw unavailable();
}

/** The one option of a native select whose text is exactly `option`; the placeholder never is. */
function selectOption(select: HTMLSelectElement, option: string): HTMLOptionElement | undefined {
  const matches = Array.from(select.options).filter(
    (candidate) =>
      candidate.value !== "" &&
      (candidate.textContent ?? "").replace(/\s+/gu, " ").trim() === option,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Whether `option` is the one chosen answer: the selected option of a native select, or the one
 * checked radio of a group. Answers yes or no only.
 */
export function leverSelectionWritten(controls: readonly Element[], option: string): boolean {
  const view = controls[0]?.ownerDocument.defaultView;
  const first = controls[0];
  if (!view || !first) return false;
  if (first instanceof view.HTMLSelectElement) {
    const wanted = selectOption(first, option);
    return (
      controls.length === 1 &&
      !first.multiple &&
      wanted !== undefined &&
      first.selectedOptions.length === 1 &&
      first.selectedOptions[0] === wanted
    );
  }
  if (controls.length < 2) return false;
  const labels = controls.map(leverOptionLabel);
  if (labels.filter((label) => label === option).length !== 1) return false;
  const chosen: number[] = [];
  controls.forEach((control, index) => {
    if (control instanceof view.HTMLInputElement && control.type === "radio" && control.checked)
      chosen.push(index);
  });
  return chosen.length === 1 && labels[chosen[0] ?? -1] === option;
}

/** Chooses `option` on a native select or a radio group. The caller verifies what was written. */
function choose(
  controls: readonly Element[],
  options: readonly string[],
  option: string,
  view: View,
) {
  const first = controls[0];
  if (first instanceof view.HTMLSelectElement) {
    const wanted = selectOption(first, option);
    if (controls.length !== 1 || first.multiple || !wanted) throw unavailable();
    requireActionable(first, view);
    first.value = wanted.value;
    for (const event of ["input", "change"])
      first.dispatchEvent(new view.Event(event, { bubbles: true }));
    return;
  }
  const index = options.indexOf(option);
  const control = controls[index];
  if (
    index < 0 ||
    options.filter((candidate) => candidate === option).length !== 1 ||
    controls.length !== options.length ||
    !(control instanceof view.HTMLInputElement) ||
    control.type !== "radio"
  )
    throw unavailable();
  requireActionable(control, view, true);
  control.click();
}

/**
 * Chooses one option of a required choice question the candidate left unanswered (ADR-061). It acts
 * only on a question with no answer yet and on an option equal to exactly one on the page, and says
 * whether the page now shows that option chosen.
 */
export async function chooseLeverOption(
  inspection: ApplicationInspection,
  ref: string,
  option: string,
  authority: Pick<FillAuthority, "signal" | "deadline">,
): Promise<boolean> {
  const controls = inspection.resolve(ref);
  const field = inspection.form.fields.find((candidate) => candidate.ref === ref);
  const view = controls[0]?.ownerDocument.defaultView as View | null;
  const first = controls[0];
  if (!field || !view || !first || (field.type !== "radio" && field.type !== "select"))
    return false;
  // Never over an answer the candidate has already given.
  const answered =
    first instanceof view.HTMLSelectElement
      ? first.value !== ""
      : controls.some((control) => control instanceof view.HTMLInputElement && control.checked);
  if (answered || authority.signal.aborted || Date.now() >= authority.deadline) return false;
  try {
    choose(controls, field.options, option, view);
  } catch {
    return false;
  }
  inspection.resolve(ref);
  return leverSelectionWritten(controls, option);
}

/** Internal adapter primitive. Caller must supply fresh owning approval checks, never page data. */
export async function fillLeverFields(
  inspection: ApplicationInspection,
  packet: readonly PacketValue[],
  authority: FillAuthority,
): Promise<{
  filled: readonly string[];
  selected: readonly string[];
  reviewRequired: boolean;
}> {
  const filled: string[] = [];
  const selected: string[] = [];
  const deadline = authority.deadline;
  const current = () =>
    !authority.signal.aborted &&
    Number.isFinite(deadline) &&
    Date.now() < deadline &&
    deadline <= Date.now() + (authority.maximumMs ?? RUN_BUDGET_MS) &&
    authority.registry.status(leverAdapterId, authority.variantId, new Date()).mode === "autofill";
  if (!current()) return { filled, selected, reviewRequired: true };
  const plan = buildFillPlan(inspection.form, structuredClone(packet), {
    resume: false,
    coverLetter: false,
  });
  let rejectWait: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectWait = () => reject(unavailable());
  });
  // A stopped run that never awaited `stopped` must not leave an unhandled rejection.
  void stopped.catch(() => undefined);
  const abort = () => rejectWait?.();
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  authority.signal.addEventListener("abort", abort, { once: true });
  if (authority.signal.aborted) abort();
  try {
    for (const action of plan.actions) {
      if (action.kind !== "fill" && action.kind !== "select") continue;
      authority.onField?.(action.fieldKey);
      await Promise.race([authority.revalidateApproval(), stopped]);
      if (!current()) throw unavailable();
      const controls = inspection.resolve(action.ref);
      const field = inspection.form.fields.find((candidate) => candidate.ref === action.ref);
      const view = controls[0]?.ownerDocument.defaultView as View | null;
      if (!field || !view || controls.length === 0) throw unavailable();
      if (authority.reveal && controls[0]) {
        await Promise.race([authority.reveal(controls[0]), stopped]);
        if (!current()) throw unavailable();
        inspection.resolve(action.ref);
      }
      let matchesApproved: () => boolean;
      let eventTarget: Element | undefined;
      if (action.kind === "select") {
        const option = action.option;
        choose(controls, field.options, option, view);
        matchesApproved = () => leverSelectionWritten(controls, option);
      } else {
        const control = controls[0];
        if (controls.length !== 1 || !control) throw unavailable();
        requireActionable(control, view);
        if (
          !(control instanceof view.HTMLTextAreaElement || control instanceof view.HTMLInputElement)
        )
          throw unavailable();
        if (control instanceof view.HTMLInputElement && control.type === "checkbox") {
          const value = action.value;
          if (typeof value !== "boolean") throw unavailable();
          if (control.checked !== value) {
            requireActionable(control, view, true);
            control.click();
          }
          matchesApproved = () => control.checked === value;
        } else {
          if (field.type === "file") throw unavailable();
          const text = String(action.value);
          const prototype =
            control instanceof view.HTMLTextAreaElement
              ? view.HTMLTextAreaElement.prototype
              : view.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, text);
          matchesApproved = () => control.value === text;
          // The page treats a field as the candidate's own once it sees these events, so its resume
          // reader does not write over it afterwards.
          eventTarget = control;
        }
      }
      filled.push(action.ref);
      if (action.kind === "select") selected.push(action.ref);
      const requireWritten = () => {
        if (!matchesApproved()) throw unavailable();
      };
      requireWritten();
      if (eventTarget) {
        for (const event of ["input", "change"]) {
          if (!current()) throw unavailable();
          inspection.resolve(action.ref);
          requireWritten();
          eventTarget.dispatchEvent(new view.Event(event, { bubbles: true }));
        }
      }
      inspection.resolve(action.ref);
      if (!current()) throw unavailable();
      requireWritten();
    }
    return {
      filled,
      selected,
      reviewRequired:
        plan.requiresTakeover || plan.actions.some((action) => action.kind === "require_user"),
    };
  } catch {
    if (authority.throwOnFailure) throw unavailable();
    // Partial effects require review. Never replay or restore a previous value automatically.
    return { filled, selected, reviewRequired: true };
  } finally {
    clearTimeout(timer);
    authority.signal.removeEventListener("abort", abort);
  }
}
