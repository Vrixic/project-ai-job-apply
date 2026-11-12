import { mapFormFields } from "@ai-job-apply/ats-sdk/mapping";
import {
  GUIDANCE_MAX,
  NARRATIVE_ANSWER_REQUEST,
  type NarrativeAnswerReply,
  type NarrativeAnswerRequest,
  QUESTION_MAX,
} from "./narrative-answer-protocol";

/**
 * The "Generate answer" icon on a free-text employer question (ADR-057). It lives in a closed
 * shadow root so the page cannot read or restyle it, sends only the question text and the
 * employer's help text to the extension, and writes the draft into the box for the candidate to
 * read and edit. It never submits anything and keeps no copy of any text.
 */

const SPARK =
  '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
const CHECK =
  '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const STYLE = `
:host { all: initial; }
.layer { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483000; font: 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.slot { position: absolute; pointer-events: none; }
.slot > * { pointer-events: auto; }
.row { display: flex; align-items: center; gap: 6px; }
.btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; height: 28px; min-width: 28px; padding: 0 5px; border-radius: 14px; cursor: pointer; color: #4338ca; background: #fff; border: 1px solid rgba(67, 56, 202, 0.28); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18); overflow: hidden; transition: box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease, padding 0.2s ease; }
.btn:hover, .btn:focus-visible { background: #eef2ff; border-color: rgba(67, 56, 202, 0.55); box-shadow: 0 2px 8px rgba(67, 56, 202, 0.28); }
.btn:focus-visible { outline: 2px solid #4338ca; outline-offset: 2px; }
.btn[aria-busy="true"] { cursor: progress; }
.spark, .check { flex: none; width: 16px; height: 16px; margin: 0 1px; }
.spark { fill: currentColor; stroke: none; transform-origin: 50% 50%; }
.check { fill: none; stroke: #15803d; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.label { display: inline-block; max-width: 0; opacity: 0; margin-left: 0; white-space: nowrap; font-weight: 600; transition: max-width 0.26s ease, opacity 0.18s ease, margin 0.26s ease; }
.btn:hover .label, .btn:focus-visible .label, .btn[data-open="true"] .label { max-width: 150px; opacity: 1; margin-left: 6px; margin-right: 6px; }
.btn[data-state="loading"] .spark { animation: spin 1.15s linear infinite; }
.btn[data-state="done"] { color: #15803d; border-color: rgba(21, 128, 61, 0.4); }
.btn[data-state="problem"] { color: #b45309; border-color: rgba(180, 83, 9, 0.45); }
.undo { all: unset; pointer-events: auto; position: absolute; left: 0; bottom: calc(100% + 6px); box-sizing: border-box; cursor: pointer; height: 24px; padding: 0 10px; border-radius: 12px; background: #fff; color: #334155; border: 1px solid rgba(51, 65, 85, 0.3); font-weight: 600; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.15); display: inline-flex; align-items: center; }
.undo:hover, .undo:focus-visible { background: #f1f5f9; }
.undo:focus-visible { outline: 2px solid #334155; outline-offset: 2px; }
.tip { position: absolute; left: 0; bottom: calc(100% + 6px); width: max-content; max-width: 260px; padding: 6px 9px; border-radius: 8px; background: #1e293b; color: #fff; box-shadow: 0 2px 8px rgba(15, 23, 42, 0.3); }
.tip[hidden], .undo[hidden] { display: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.85); } }
@media (prefers-reduced-motion: reduce) {
  .btn, .label { transition: none; }
  .btn[data-state="loading"] .spark { animation: pulse 1.4s ease-in-out infinite; }
}
`;

const NO_AI =
  /\b(?:without|no|not|avoid|never|don'?t|do\s+not)\b[^.!?]{0,40}\b(?:ai|a\.i\.|artificial\s+intelligence|chat\s?gpt|gpt|llms?|generative)\b/iu;
const NO_AI_NOTE = "This question asks for an answer written without AI. You decide.";
const NOT_AN_ANSWER = /\b(?:cover\s*letter|resume|curriculum\s+vitae|cv)\b/iu;

const DECLINED: Record<string, string> = {
  no_profile_evidence: "Add your work history or skills to your ApplyDash profile first.",
  sensitive_question: "This question needs your own answer.",
  answered_from_profile: "Your ApplyDash profile already answers this one.",
  not_grounded: "Couldn't write a reliable answer this time. Try again, or write your own.",
};
const FAILED: Record<string, string> = {
  signin: "Sign in to ApplyDash in the side panel, then try again.",
  limit: "Too many drafts in a short time. Try again in a minute.",
  unavailable: "AI answers are off right now.",
  closed: "Open this job from ApplyDash again to use AI answers.",
  failed: "Couldn't write an answer. Try again.",
};

const ADDED_MS = 1800;
const UNDO_MS = 15_000;
const PROBLEM_MS = 6_000;

/** The employer's question as the candidate reads it, without the required-star. */
export function questionOf(box: HTMLTextAreaElement): string {
  const doc = box.ownerDocument;
  const byLabelledBy = (box.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/u)
    .map((id) => (id ? doc.getElementById(id)?.textContent : ""))
    .join(" ");
  const labelFor = box.id ? doc.querySelector(`label[for="${CSS.escape(box.id)}"]`) : null;
  const text =
    box.getAttribute("aria-label") ||
    byLabelledBy.trim() ||
    labelFor?.textContent ||
    box.closest("label")?.textContent ||
    "";
  return text
    .replace(/\s+/gu, " ")
    .replace(/\s*\*\s*$/u, "")
    .trim();
}

/** The employer's help text under the question (length, style), when the form links one. */
export function guidanceOf(box: HTMLTextAreaElement, question: string): string {
  const doc = box.ownerDocument;
  const text = (box.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .map((id) => (id ? (doc.getElementById(id)?.textContent ?? "") : ""))
    .map((part) => part.replace(/\s+/gu, " ").trim())
    .filter((part) => part && part !== question)
    .join(" ");
  return text.slice(0, GUIDANCE_MAX);
}

export function usable(box: HTMLTextAreaElement, view: Window): boolean {
  if (!box.isConnected || box.disabled || box.readOnly) return false;
  const style = view.getComputedStyle(box);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = box.getBoundingClientRect();
  return rect.width >= 120 && rect.height >= 36;
}

/** Only an open question the candidate writes themselves; fields the Profile answers are skipped. */
export function isOpenQuestion(box: HTMLTextAreaElement, question: string): boolean {
  if (question.length < 8 || question.length > QUESTION_MAX || NOT_AN_ANSWER.test(question))
    return false;
  const [mapping] = mapFormFields({
    fields: [
      {
        ref: "q",
        label: question,
        name: box.name,
        type: "textarea",
        required: false,
        options: [],
      },
    ],
    challengePresent: false,
  });
  return mapping?.fieldKey === null;
}

export function writeValue(box: HTMLTextAreaElement, value: string) {
  const view = box.ownerDocument.defaultView;
  const setter = view
    ? Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, "value")?.set
    : undefined;
  // The native setter, so a controlled field (the Greenhouse form is React) sees a real change.
  if (setter) setter.call(box, value);
  else box.value = value;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * What the answer icon would draft for this control: an open, usable, EMPTY text box that no Profile
 * answer maps to. The employer's question and help text come from the page; whether the employer
 * asked for a hand-written answer is reported so the candidate is told, and decides.
 */
export function draftableQuestion(
  control: Element,
  view: Window,
): { box: HTMLTextAreaElement; question: string; guidance: string; noAi: boolean } | undefined {
  if (!(control instanceof (view as Window & typeof globalThis).HTMLTextAreaElement))
    return undefined;
  const box = control;
  if (!usable(box, view) || box.value.trim() !== "") return undefined;
  const question = questionOf(box);
  if (!isOpenQuestion(box, question)) return undefined;
  const guidance = guidanceOf(box, question);
  return { box, question, guidance, noAi: NO_AI.test(`${question} ${guidance}`) };
}

interface Control {
  box: HTMLTextAreaElement;
  slot: HTMLDivElement;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  icon: HTMLSpanElement;
  tip: HTMLDivElement;
  undo: HTMLButtonElement;
  status: HTMLDivElement;
  question: string;
  guidance: string;
  noAi: boolean;
  state: "idle" | "loading" | "done" | "problem";
  timers: ReturnType<typeof setTimeout>[];
  restore?: string | undefined;
}

/** Installs the icons on the page and returns the function that removes them. */
export function installNarrativeAnswerUi(options: {
  document: Document;
  send(request: NarrativeAnswerRequest): Promise<NarrativeAnswerReply>;
}): () => void {
  const doc = options.document;
  const maybeView = doc.defaultView;
  if (!maybeView) return () => undefined;
  const view: Window & typeof globalThis = maybeView;
  const host = doc.createElement("div");
  host.setAttribute("data-applydash", "answer-icons");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = doc.createElement("style");
  style.textContent = STYLE;
  const layer = doc.createElement("div");
  layer.className = "layer";
  shadow.append(style, layer);
  (doc.body ?? doc.documentElement).append(host);

  const controls = new Map<HTMLTextAreaElement, Control>();

  function setState(control: Control, state: Control["state"], text?: string) {
    control.state = state;
    control.button.dataset.state = state;
    control.button.setAttribute("aria-busy", String(state === "loading"));
    control.button.dataset.open = state === "idle" ? "false" : "true";
    control.icon.innerHTML = state === "done" ? CHECK : SPARK;
    control.label.textContent =
      state === "loading"
        ? "Writing your answer…"
        : state === "done"
          ? "Added"
          : state === "problem"
            ? "Not written"
            : "Generate answer";
    const note =
      text ?? (control.noAi && (state === "loading" || state === "problem") ? NO_AI_NOTE : "");
    control.tip.textContent = note;
    control.tip.hidden = !note;
    control.status.textContent = text ?? (state === "loading" ? "Writing your answer" : "");
  }

  function clearTimers(control: Control) {
    for (const timer of control.timers) clearTimeout(timer);
    control.timers = [];
  }

  function later(control: Control, ms: number, action: () => void) {
    control.timers.push(setTimeout(action, ms));
  }

  async function generate(control: Control) {
    if (control.state === "loading") return;
    clearTimers(control);
    control.undo.hidden = true;
    const before = control.box.value;
    setState(control, "loading");
    let reply: NarrativeAnswerReply;
    try {
      reply = await options.send({
        schema: NARRATIVE_ANSWER_REQUEST,
        question: control.question,
        ...(control.guidance ? { guidance: control.guidance } : {}),
      });
    } catch {
      reply = { status: "error", reason: "failed" };
    }
    if (!controls.has(control.box)) return;
    if (reply.status === "ready") {
      // Never overwrite what the candidate typed while the draft was being written.
      if (control.box.value !== before && control.box.value.trim()) {
        setState(control, "problem", "You started typing, so your text was kept.");
        later(control, PROBLEM_MS, () => setState(control, "idle"));
        return;
      }
      control.restore = before;
      writeValue(control.box, reply.text);
      setState(control, "done");
      control.undo.hidden = false;
      later(control, ADDED_MS, () => setState(control, "idle"));
      later(control, UNDO_MS, () => {
        control.undo.hidden = true;
        control.restore = undefined;
      });
      return;
    }
    setState(
      control,
      "problem",
      reply.status === "declined"
        ? (DECLINED[reply.reason] ?? DECLINED.not_grounded)
        : (FAILED[reply.reason] ?? FAILED.failed),
    );
    later(control, PROBLEM_MS, () => setState(control, "idle"));
  }

  function create(box: HTMLTextAreaElement, question: string): Control {
    const slot = doc.createElement("div");
    slot.className = "slot";
    const row = doc.createElement("div");
    row.className = "row";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.dataset.state = "idle";
    button.setAttribute("aria-label", "Generate answer");
    const icon = doc.createElement("span");
    icon.innerHTML = SPARK;
    icon.style.display = "inline-flex";
    const label = doc.createElement("span");
    label.className = "label";
    label.textContent = "Generate answer";
    button.append(icon, label);
    const undo = doc.createElement("button");
    undo.type = "button";
    undo.className = "undo";
    undo.textContent = "Undo";
    undo.hidden = true;
    row.append(button);
    const tip = doc.createElement("div");
    tip.className = "tip";
    tip.hidden = true;
    tip.setAttribute("role", "note");
    const status = doc.createElement("div");
    status.className = "sr";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    slot.append(tip, undo, row, status);
    layer.append(slot);
    const guidance = guidanceOf(box, question);
    const control: Control = {
      box,
      slot,
      button,
      label,
      icon,
      tip,
      undo,
      status,
      question,
      guidance,
      noAi: NO_AI.test(`${question} ${guidance}`),
      state: "idle",
      timers: [],
    };
    // The heads-up shows on hover or focus too, not only once a draft has been asked for.
    const showNote = () => {
      if (control.noAi && control.state === "idle" && control.undo.hidden) {
        tip.textContent = NO_AI_NOTE;
        tip.hidden = false;
      }
    };
    const hideNote = () => {
      if (control.state === "idle") tip.hidden = true;
    };
    button.addEventListener("mouseenter", showNote);
    button.addEventListener("focus", showNote);
    button.addEventListener("mouseleave", hideNote);
    button.addEventListener("blur", hideNote);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void generate(control);
    });
    undo.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (control.restore !== undefined) writeValue(box, control.restore);
      control.restore = undefined;
      undo.hidden = true;
      clearTimers(control);
      setState(control, "idle");
    });
    return control;
  }

  function place(control: Control) {
    const rect = control.box.getBoundingClientRect();
    const size = 28;
    const inset = 8;
    // Bottom left inside the box; a very short box keeps the icon at its top left instead.
    const top = Math.max(rect.top + 4, rect.bottom - size - inset);
    control.slot.style.left = `${Math.round(rect.left + view.scrollX + inset)}px`;
    control.slot.style.top = `${Math.round(top + view.scrollY)}px`;
  }

  function sync() {
    const live = new Set<HTMLTextAreaElement>();
    for (const box of Array.from(doc.querySelectorAll("textarea"))) {
      if (!usable(box, view)) continue;
      live.add(box);
      let control = controls.get(box);
      if (!control) {
        const question = questionOf(box);
        if (!isOpenQuestion(box, question)) continue;
        control = create(box, question);
        controls.set(box, control);
      }
      place(control);
    }
    for (const [box, control] of controls) {
      if (live.has(box)) continue;
      clearTimers(control);
      control.slot.remove();
      controls.delete(box);
    }
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    view.requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
  const resizes = new ResizeObserver(schedule);
  resizes.observe(doc.documentElement);
  view.addEventListener("resize", schedule, { passive: true });
  view.addEventListener("scroll", schedule, { passive: true });
  // Layout can move without any event the page tells us about (fonts, images, validation text).
  const tick = setInterval(schedule, 1000);
  sync();

  const dispose = () => {
    clearInterval(tick);
    mutations.disconnect();
    resizes.disconnect();
    view.removeEventListener("resize", schedule);
    view.removeEventListener("scroll", schedule);
    view.removeEventListener("pagehide", dispose);
    for (const control of controls.values()) clearTimers(control);
    controls.clear();
    host.remove();
  };
  view.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}
