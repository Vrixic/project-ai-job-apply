/**
 * The question the panel asks when a submit run found required open questions the candidate has not
 * answered and the answer engine can draft (ADR-057): have them written, or fill the rest and leave
 * those to the candidate. The employer's question text is shown as text only, and the employer's
 * own request for a hand-written answer is never hidden: the candidate is told and decides.
 */
export type DraftChoice = "draft" | "manual" | "cancel";

export interface DraftOffer {
  answer: Promise<DraftChoice>;
  /** Withdraws the question (Clear, or the panel is closing). */
  cancel(): void;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function offerDrafts(
  after: HTMLElement,
  details: {
    /** Required questions only the candidate can answer that are still empty. */
    needs: number;
    /** Of those, how many the answer icon can write. */
    draftable: number;
    /** The employer's own wording of the first few, as plain text. */
    names: readonly string[];
    /** The employer asked for a hand-written answer to one of them. */
    noAi: boolean;
  },
): DraftOffer {
  const needs = Math.max(details.needs, details.draftable, 1);
  const everyOne = details.draftable >= needs;
  const doc = after.ownerDocument;
  const box = doc.createElement("div");
  box.dataset.draftChoice = "";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Answers the employer is asking for");

  const text = doc.createElement("p");
  const list = details.names.map((name) => `"${name}"`).join("; ");
  const more = needs > details.names.length ? ` and ${needs - details.names.length} more` : "";
  text.textContent = `${needs} required ${plural(needs, "question", "questions")} on the employer page ${plural(needs, "needs", "need")} your answer${list ? `: ${list}${more}` : ""}.${
    everyOne
      ? ` Should AI write ${plural(needs, "it", "them")} from your profile?`
      : ` AI can write ${details.draftable} of them from your profile; you answer the rest.`
  }`;
  box.append(text);

  if (details.noAi) {
    const note = doc.createElement("p");
    note.dataset.draftNote = "";
    note.textContent =
      needs === 1
        ? "The employer asks for this answer to be written without AI. You decide."
        : "The employer asks for at least one of these answers to be written without AI. You decide.";
    box.append(note);
  }

  const yes = doc.createElement("button");
  yes.type = "button";
  yes.dataset.draftYes = "";
  yes.textContent = everyOne
    ? "Write with AI, then fill and submit"
    : "Write what AI can, then fill for my review";
  const no = doc.createElement("button");
  no.type = "button";
  no.dataset.draftNo = "";
  no.className = "secondary";
  no.textContent = "Fill the rest, I will answer and submit myself";
  box.append(yes, no);
  after.insertAdjacentElement("afterend", box);

  let settle: (choice: DraftChoice) => void = () => undefined;
  const answer = new Promise<DraftChoice>((resolve) => {
    settle = (choice) => {
      box.remove();
      resolve(choice);
    };
  });
  yes.addEventListener("click", () => settle("draft"));
  no.addEventListener("click", () => settle("manual"));
  yes.focus({ preventScroll: false });
  return { answer, cancel: () => settle("cancel") };
}
