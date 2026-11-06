import { buildFillPlan, type PacketValue } from "@ai-job-apply/ats-sdk/plan";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { RUN_BUDGET_MS } from "../execution-budget";
import { writtenValueMatches } from "../field-value";
import { selectExactOption } from "./combobox";
import type { GreenhouseInspection } from "./inspect";

function requireActionable(control: Element, view: Window) {
  if (control.hasAttribute("readonly") || control.matches(":disabled"))
    throw new Error("GreenhouseFillUnavailable");
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
      throw new Error("GreenhouseFillUnavailable");
  }
}

/** Internal adapter primitive. Caller must supply fresh owning approval checks, never page data. */
export async function fillGreenhouseFields(
  inspection: GreenhouseInspection,
  packet: readonly PacketValue[],
  authority: {
    registry: AdapterRegistry;
    variantId: string;
    deadline: number;
    /** The furthest the deadline may be from now: the short lease unless a fill-only run has more. */
    maximumMs?: number;
    signal: AbortSignal;
    revalidateApproval(): Promise<void>;
    /** Submission composition must distinguish a stopped fill from candidate-only review. */
    throwOnFailure?: boolean;
    onField?(fieldKey: string): void;
    reveal?(control: Element): Promise<void>;
  },
): Promise<{
  filled: readonly string[];
  /** Custom dropdowns chosen by exact option. Counted apart: an unmatched one is left to the candidate. */
  selected: readonly string[];
  /** Short codes for the candidate, such as `other:education.school`. Never any value. */
  notes?: readonly string[];
  reviewRequired: boolean;
}> {
  const filled: string[] = [];
  const selected: string[] = [];
  const notes: string[] = [];
  const deadline = authority.deadline;
  const variantId = authority.variantId;
  const current = () =>
    !authority.signal.aborted &&
    Number.isFinite(deadline) &&
    Date.now() < deadline &&
    deadline <= Date.now() + (authority.maximumMs ?? RUN_BUDGET_MS) &&
    authority.registry.status("greenhouse-application-v1", variantId, new Date()).mode ===
      "autofill";
  if (!current()) return { filled, selected, reviewRequired: true };
  const plan = buildFillPlan(inspection.form, structuredClone(packet), {
    resume: false,
    coverLetter: false,
  });
  let rejectWait: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    rejectWait = () => reject(new Error("GreenhouseFillUnavailable"));
  });
  const abort = () => rejectWait?.();
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  authority.signal.addEventListener("abort", abort, { once: true });
  if (authority.signal.aborted) abort();
  try {
    for (const action of plan.actions) {
      if (action.kind !== "fill" && action.kind !== "select") continue;
      authority.onField?.(action.fieldKey);
      await Promise.race([authority.revalidateApproval(), stopped]);
      if (!current()) throw new Error("GreenhouseFillUnavailable");
      const controls = inspection.resolve(action.ref);
      const field = inspection.form.fields.find((candidate) => candidate.ref === action.ref);
      const control = controls[0];
      const view = control?.ownerDocument.defaultView;
      if (!field || !control || !view) throw new Error("GreenhouseFillUnavailable");
      // Unsupported custom widgets and files are left to the candidate. No synthetic click.
      if (controls.length !== 1) throw new Error("GreenhouseFillUnavailable");
      requireActionable(control, view);
      if (authority.reveal) {
        await Promise.race([authority.reveal(control), stopped]);
        if (!current()) throw new Error("GreenhouseFillUnavailable");
        inspection.resolve(action.ref);
        requireActionable(control, view);
      }
      let matchesApproved: () => boolean;
      if (action.kind === "select") {
        if (!(control instanceof view.HTMLSelectElement) || control.multiple)
          throw new Error("GreenhouseFillUnavailable");
        const options = Array.from(control.options).filter(
          (option) => option.textContent?.replace(/\s+/gu, " ").trim() === action.option,
        );
        const option = options[0];
        if (
          options.length !== 1 ||
          !option ||
          option.disabled ||
          option.parentElement?.hasAttribute("disabled")
        )
          throw new Error("GreenhouseFillUnavailable");
        const intended = option.value;
        // The native setter, so a framework that tracks the value sees a real change.
        Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, "value")?.set?.call(
          control,
          intended,
        );
        matchesApproved = () =>
          control.value === intended &&
          control.selectedOptions.length === 1 &&
          control.selectedOptions[0] === option &&
          !option.disabled &&
          !option.parentElement?.hasAttribute("disabled");
      } else if (control instanceof view.HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, "value")?.set?.call(
          control,
          String(action.value),
        );
        matchesApproved = () => control.value === String(action.value);
      } else if (control instanceof view.HTMLInputElement && field.type !== "file") {
        if (field.type === "checkbox") {
          if (typeof action.value !== "boolean") throw new Error("GreenhouseFillUnavailable");
          if (control.checked !== action.value) control.click();
          matchesApproved = () => control.checked === action.value;
        } else {
          if (!["text", "date", "number"].includes(field.type))
            throw new Error("GreenhouseFillUnavailable");
          // A controlled field (the current job-boards form is React) discards a value set the
          // ordinary way, so the native setter is used and the input event then reports it.
          Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set?.call(
            control,
            String(action.value),
          );
          matchesApproved = () => writtenValueMatches(control, String(action.value));
        }
      } else throw new Error("GreenhouseFillUnavailable");
      // A synchronous employer event handler can replace a control or introduce a challenge.
      // Revalidate before each subsequent effect, including the next event on this field.
      filled.push(action.ref);
      const requireWritten = () => {
        if (!matchesApproved()) throw new Error("GreenhouseFillUnavailable");
        if (
          (control instanceof view.HTMLInputElement ||
            control instanceof view.HTMLTextAreaElement ||
            control instanceof view.HTMLSelectElement) &&
          !control.validity.valid
        )
          throw new Error("GreenhouseFillUnavailable");
      };
      requireWritten();
      for (const event of ["input", "change"]) {
        if (!current()) throw new Error("GreenhouseFillUnavailable");
        inspection.resolve(action.ref);
        requireActionable(control, view);
        requireWritten();
        control.dispatchEvent(new view.Event(event, { bubbles: true }));
      }
      inspection.resolve(action.ref);
      requireActionable(control, view);
      if (!current()) throw new Error("GreenhouseFillUnavailable");
      requireWritten();
    }
    // Custom dropdowns the plan cannot fill as plain values: choose the one option that is exactly
    // the approved value. No exact option, or any doubt, leaves the dropdown to the candidate.
    const approved = new Map(packet.map((entry) => [entry.fieldKey, entry]));
    for (const action of plan.actions) {
      if (action.kind !== "require_user" || action.reason !== "unsupported_control") continue;
      const entry = action.fieldKey ? approved.get(action.fieldKey) : undefined;
      // A Yes/No answer is a boolean in the packet and the words Yes and No in the dropdown.
      const wanted =
        typeof entry?.value === "boolean"
          ? entry.value
            ? "Yes"
            : "No"
          : typeof entry?.value === "string"
            ? entry.value.trim()
            : "";
      if (!action.fieldKey || !entry || entry.needsUserAction || !wanted) {
        // An education dropdown with nothing saved for it: the candidate adds it to their profile.
        if (action.fieldKey?.startsWith("education.")) notes.push(`empty:${action.fieldKey}`);
        continue;
      }
      authority.onField?.(action.fieldKey);
      await Promise.race([authority.revalidateApproval(), stopped]);
      if (!current()) throw new Error("GreenhouseFillUnavailable");
      const controls = inspection.resolve(action.ref);
      const control = controls[0];
      const view = control?.ownerDocument.defaultView;
      if (
        controls.length !== 1 ||
        !control ||
        !view ||
        !(control instanceof view.HTMLInputElement) ||
        control.getAttribute("role") !== "combobox" ||
        control.type !== "text"
      )
        continue;
      requireActionable(control, view);
      if (authority.reveal) {
        await Promise.race([authority.reveal(control), stopped]);
        if (!current()) throw new Error("GreenhouseFillUnavailable");
        inspection.resolve(action.ref);
        requireActionable(control, view);
      }
      // "No" to a United States question says nothing about the other country it also names.
      const label = inspection.form.fields.find((field) => field.ref === action.ref)?.label ?? "";
      if (
        action.fieldKey === "authorization.us_authorized" &&
        entry.value === false &&
        /\b(?:canada|united kingdom|u\.?k\.?|europe\w*|e\.?u\.?|mexico|australia)\b/iu.test(label)
      ) {
        notes.push(`check:${action.fieldKey}`);
        continue;
      }
      const chosen = await selectExactOption(control, view, action.fieldKey, wanted, {
        current,
        wait: (ms) =>
          Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), stopped]),
      });
      inspection.resolve(action.ref);
      if (chosen) {
        selected.push(action.ref);
        if (chosen.fallback) notes.push(`other:${action.fieldKey}`);
      }
    }
    return {
      filled,
      selected,
      ...(notes.length ? { notes } : {}),
      reviewRequired:
        plan.requiresTakeover || plan.actions.some((action) => action.kind === "require_user"),
    };
  } catch {
    if (authority.throwOnFailure) throw new Error("GreenhouseFillUnavailable");
    // Partial effects require review. Never replay or restore a previous value automatically.
    return { filled, selected, reviewRequired: true };
  } finally {
    clearTimeout(timer);
    authority.signal.removeEventListener("abort", abort);
  }
}
