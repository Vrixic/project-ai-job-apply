import { interactiveCaptchaPresent } from "@ai-job-apply/ats-sdk/extract";

// A credential or one-time-code prompt always needs the candidate (ADR-046, ADR-053).
const CREDENTIAL_PROMPT = 'input[autocomplete="one-time-code"], input[type="password"]';
const MAXIMUM_NODES = 10_000;

/**
 * Global stop signal for a whole document, also after the application form has disappeared. An
 * invisible reCAPTCHA badge is not a challenge; a visible challenge, widget or prompt is.
 * Throws through `refuse` when the document is too large to scan, which stops the run.
 */
export function pageChallengePresent(document: Document, refuse: () => Error): boolean {
  const walker = document.createTreeWalker(document, 1);
  let nodes = 0;
  while (walker.nextNode()) {
    if (++nodes > MAXIMUM_NODES) throw refuse();
  }
  return document.querySelector(CREDENTIAL_PROMPT) !== null || interactiveCaptchaPresent(document);
}
