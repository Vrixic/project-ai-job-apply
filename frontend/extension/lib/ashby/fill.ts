import { buildFillPlan, type PacketValue } from "@ai-job-apply/ats-sdk/plan";
import { RUN_BUDGET_MS } from "../execution-budget";
import type { ApplicationInspection, FillAuthority } from "../providers/types";

const unavailable = () => new Error("AshbyFillUnavailable");
export const ashbyAdapterId = "ashby-application-v1";

function requireActionable(control: Element, view: Window) {
  if (control.hasAttribute("readonly") || control.matches(":disabled")) throw unavailable();
  for (let ancestor: Element | null = control; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor);
    if (
      ancestor.hasAttribute("hidden") ||
      ancestor.hasAttribute("inert") ||
      ancestor.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      throw unavailable();
  }
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Internal adapter primitive. Caller must supply fresh owning approval checks, never page data. */
export async function fillAshbyFields(
  inspection: ApplicationInspection,
  packet: readonly PacketValue[],
  authority: FillAuthority,
): Promise<{ filled: readonly string[]; reviewRequired: boolean }> {
  const filled: string[] = [];
  const deadline = authority.deadline;
  const current = () =>
    !authority.signal.aborted &&
    Number.isFinite(deadline) &&
    Date.now() < deadline &&
    deadline <= Date.now() + (authority.maximumMs ?? RUN_BUDGET_MS) &&
    authority.registry.status(ashbyAdapterId, authority.variantId, new Date()).mode === "autofill";
  if (!current()) return { filled, reviewRequired: true };
  const plan = buildFillPlan(inspection.form, structuredClone(packet), {
    resume: false,
    coverLetter: false,
  });
  let rejectWait: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectWait = () => reject(unavailable());
  });
  const abort = () => rejectWait?.();
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  authority.signal.addEventListener("abort", abort, { once: true });
  if (authority.signal.aborted) abort();
  try {
    for (const action of plan.actions) {
      if (action.kind !== "fill" && action.kind !== "select") continue;
      await Promise.race([authority.revalidateApproval(), stopped]);
      if (!current()) throw unavailable();
      const controls = inspection.resolve(action.ref);
      const field = inspection.form.fields.find((candidate) => candidate.ref === action.ref);
      const view = controls[0]?.ownerDocument.defaultView;
      if (!field || !view || controls.length === 0) throw unavailable();
      if (authority.reveal && controls[0]) {
        await Promise.race([authority.reveal(controls[0]), stopped]);
        if (!current()) throw unavailable();
        inspection.resolve(action.ref);
      }
      let matchesApproved: () => boolean;
      let eventTarget: Element | undefined;
      if (action.kind === "select") {
        // Yes/No buttons or radio inputs: choose the one control whose label is exactly the option.
        const index = field.options.findIndex((option) => option === action.option);
        const matching = field.options.filter((option) => option === action.option);
        const control = controls[index];
        if (matching.length !== 1 || !control || controls.length !== field.options.length)
          throw unavailable();
        requireActionable(control, view);
        if (control instanceof view.HTMLButtonElement) {
          control.click();
          // The page records the choice on its next render.
          for (
            let attempt = 0;
            attempt < 10 && control.getAttribute("aria-pressed") !== "true";
            attempt++
          )
            await Promise.race([sleep(50), stopped]);
          matchesApproved = () =>
            control.getAttribute("aria-pressed") === "true" &&
            controls.every(
              (other) => other === control || other.getAttribute("aria-pressed") !== "true",
            );
        } else if (control instanceof view.HTMLInputElement && control.type === "radio") {
          control.click();
          matchesApproved = () =>
            control.checked &&
            controls.every((other) => other === control || !(other as HTMLInputElement).checked);
        } else throw unavailable();
      } else {
        const control = controls[0];
        if (controls.length !== 1 || !control) throw unavailable();
        requireActionable(control, view);
        if (
          control instanceof view.HTMLTextAreaElement ||
          control instanceof view.HTMLInputElement
        ) {
          if (control instanceof view.HTMLInputElement && control.type === "checkbox") {
            if (typeof action.value !== "boolean") throw unavailable();
            if (control.checked !== action.value) control.click();
            matchesApproved = () => control.checked === action.value;
          } else {
            if (control instanceof view.HTMLInputElement && field.type === "file")
              throw unavailable();
            const text = String(action.value);
            // The native setter, so a framework that tracks the value sees a real change.
            const prototype =
              control instanceof view.HTMLTextAreaElement
                ? view.HTMLTextAreaElement.prototype
                : view.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, text);
            matchesApproved = () => control.value === text;
            eventTarget = control;
          }
        } else throw unavailable();
      }
      filled.push(action.ref);
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
      reviewRequired:
        plan.requiresTakeover || plan.actions.some((action) => action.kind === "require_user"),
    };
  } catch {
    if (authority.throwOnFailure) throw unavailable();
    // Partial effects require review. Never replay or restore a previous value automatically.
    return { filled, reviewRequired: true };
  } finally {
    clearTimeout(timer);
    authority.signal.removeEventListener("abort", abort);
  }
}
