/**
 * What AI did with the choice questions the fill left to the candidate (ADR-061), shown in the panel.
 * Standard answers are already chosen on the page and are listed to be checked; a restricted answer
 * is only a proposal, and is used only when the candidate confirms that one. Every question and
 * option here is the employer's own text, so it is set as text, never as markup.
 */
export interface ChoiceResult {
  asked: number;
  applied: ReadonlyArray<{ question: string; option: string }>;
  proposals: ReadonlyArray<{ ref: string; question: string; option: string; probability: number }>;
  left: number;
  /** Why the Gateway could not decide: the questions simply stay the candidate's. */
  unavailable?: string;
}

const MAX_LINES = 10;
const shorten = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

export function isChoiceResult(value: unknown): value is ChoiceResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const count = (entry: unknown) =>
    typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 && entry <= 200;
  const text = (entry: unknown, limit: number) =>
    typeof entry === "string" && entry.length >= 1 && entry.length <= limit;
  return (
    count(record.asked) &&
    count(record.left) &&
    Array.isArray(record.applied) &&
    record.applied.length <= MAX_LINES &&
    record.applied.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        text((entry as Record<string, unknown>).question, 1000) &&
        text((entry as Record<string, unknown>).option, 200),
    ) &&
    Array.isArray(record.proposals) &&
    record.proposals.length <= MAX_LINES &&
    record.proposals.every((entry) => {
      const item = entry as Record<string, unknown>;
      return (
        typeof entry === "object" &&
        entry !== null &&
        typeof item.ref === "string" &&
        /^[A-Za-z0-9_-]{1,40}$/u.test(item.ref) &&
        text(item.question, 1000) &&
        text(item.option, 200) &&
        typeof item.probability === "number" &&
        item.probability >= 0 &&
        item.probability <= 1
      );
    }) &&
    (record.unavailable === undefined || typeof record.unavailable === "string")
  );
}

/**
 * The sentence for the panel's status line; the list below it carries the detail. Once the candidate
 * has answered every restricted proposal, `confirmed` says how many were chosen on the page.
 */
export function choiceSummary(
  result: ChoiceResult,
  confirmed?: { chosen: number; declined: number },
): string {
  if (result.asked === 0) return "";
  if (result.unavailable && result.applied.length === 0 && result.proposals.length === 0)
    return result.unavailable === "signin"
      ? " AI could not answer the choice questions: sign in to the extension and press Fill again."
      : " AI answers for the choice questions are not available right now, so they are yours to answer.";
  const parts: string[] = [];
  const chosen = result.applied.length + (confirmed?.chosen ?? 0);
  if (chosen)
    parts.push(
      `AI chose ${chosen} ${chosen === 1 ? "answer" : "answers"}: check ${chosen === 1 ? "it" : "them"} on the page and change any that is wrong.`,
    );
  if (result.proposals.length && !confirmed)
    parts.push(
      `${result.proposals.length} restricted ${result.proposals.length === 1 ? "answer waits" : "answers wait"} for your confirmation below.`,
    );
  const own = result.left + (confirmed?.declined ?? 0);
  if (own > 0)
    parts.push(
      `${own} choice ${own === 1 ? "question still needs" : "questions still need"} your own answer.`,
    );
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export interface ChoiceResultsView {
  /** Resolves "done" when every restricted proposal is answered, "cancelled" if the view is closed first. */
  settled: Promise<"done" | "cancelled">;
  dispose(): void;
}

export function showChoiceResults(
  after: HTMLElement,
  result: ChoiceResult,
  /** Resolves true when the answer is now chosen on the page. */
  confirm: (ref: string, accept: boolean) => Promise<boolean>,
): ChoiceResultsView {
  const doc = after.ownerDocument;
  const box = doc.createElement("div");
  box.dataset.choiceResults = "";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Answers chosen by AI");
  let open = result.proposals.length;
  let finish: (outcome: "done" | "cancelled") => void = () => undefined;
  const settled = new Promise<"done" | "cancelled">((resolve) => {
    finish = resolve;
  });
  if (open === 0) finish("done");

  if (result.applied.length) {
    const heading = doc.createElement("p");
    heading.textContent = "Chosen by AI (check them on the page):";
    const list = doc.createElement("ul");
    for (const entry of result.applied) {
      const item = doc.createElement("li");
      item.dataset.choiceApplied = "";
      item.textContent = `${shorten(entry.question, 140)}: ${shorten(entry.option, 60)}`;
      list.append(item);
    }
    box.append(heading, list);
  }

  for (const proposal of result.proposals) {
    const row = doc.createElement("div");
    row.dataset.choiceProposal = proposal.ref;
    const text = doc.createElement("p");
    text.textContent = `Restricted question: ${shorten(proposal.question, 140)} AI suggests "${shorten(proposal.option, 60)}" (${Math.round(proposal.probability * 100)}% sure, from your own saved statement). Nothing is chosen until you confirm.`;
    const use = doc.createElement("button");
    use.type = "button";
    use.dataset.choiceUse = proposal.ref;
    use.textContent = "Use this answer";
    const skip = doc.createElement("button");
    skip.type = "button";
    skip.dataset.choiceSkip = proposal.ref;
    skip.className = "secondary";
    skip.textContent = "I will answer it myself";
    row.append(text, use, skip);
    const settle = (message: string) => {
      row.replaceChildren();
      const done = doc.createElement("p");
      done.textContent = message;
      row.append(done);
    };
    const answer = async (accept: boolean) => {
      use.disabled = true;
      skip.disabled = true;
      let applied = false;
      try {
        applied = await confirm(proposal.ref, accept);
      } catch {
        applied = false;
      }
      open -= 1;
      if (open <= 0) finish("done");
      settle(
        !accept
          ? "Left to you."
          : applied
            ? "Chosen on the page: check it."
            : "It could not be chosen: answer it yourself on the page.",
      );
    };
    use.addEventListener("click", () => void answer(true));
    skip.addEventListener("click", () => void answer(false));
    box.append(row);
  }

  after.insertAdjacentElement("afterend", box);
  return {
    settled,
    dispose: () => {
      box.remove();
      finish("cancelled");
    },
  };
}
