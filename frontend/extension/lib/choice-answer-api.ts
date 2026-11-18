import type { ChoiceAnswers } from "@ai-job-apply/api-contracts";
import { validateChoiceAnswers } from "@ai-job-apply/api-contracts/browser-validators";
import { safeApiOrigin } from "./config";

const REQUEST_TIMEOUT_MS = 20_000;
const RESPONSE_LIMIT_BYTES = 16_384;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export interface ChoiceQuestion {
  ref: string;
  question: string;
  options: readonly string[];
}

/** Why no decisions came back. Nothing here is a reason to stop: the questions stay the candidate's. */
export type ChoiceAnswerFailure = "signin" | "limit" | "unavailable" | "failed";

/**
 * Asks the Gateway to decide the choice questions the page left unanswered (ADR-061), with the
 * candidate's own signed-in session. The questions and answers are never stored or logged here, and
 * every failure is quiet: it only means the candidate answers them.
 */
export async function decideChoiceAnswers(options: {
  apiOrigin: string;
  accessToken: string;
  applicationId: string;
  questions: readonly ChoiceQuestion[];
  signal: AbortSignal;
  fetchImplementation?: typeof fetch;
}): Promise<{ ok: true; answers: ChoiceAnswers } | { ok: false; reason: ChoiceAnswerFailure }> {
  const origin = safeApiOrigin(options.apiOrigin);
  if (!origin || !UUID.test(options.applicationId)) return { ok: false, reason: "unavailable" };
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const timeout = new AbortController();
  const signal = AbortSignal.any([options.signal, timeout.signal]);
  try {
    const response = await (options.fetchImplementation ?? fetch)(
      new URL(`/v1/applications/${options.applicationId}/choice-answers`, origin),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.accessToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          questions: options.questions.map(({ ref, question, options: labels }) => ({
            ref,
            question,
            options: [...labels],
          })),
        }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal,
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403)
        return { ok: false, reason: "signin" };
      if (response.status === 429) return { ok: false, reason: "limit" };
      // A Gateway that does not have this route yet answers 404; it is the same as switched off.
      if (response.status === 503 || response.status === 404)
        return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "failed" };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > RESPONSE_LIMIT_BYTES) return { ok: false, reason: "failed" };
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!validateChoiceAnswers(value)) return { ok: false, reason: "failed" };
    // Exactly the questions asked, in order: anything else is not an answer to them.
    if (
      value.answers.length !== options.questions.length ||
      value.answers.some((answer, index) => answer.ref !== options.questions[index]?.ref)
    )
      return { ok: false, reason: "failed" };
    // A decided option must be one of the question's own options.
    for (const [index, answer] of value.answers.entries()) {
      if (answer.status === "decided" && !options.questions[index]?.options.includes(answer.option))
        return { ok: false, reason: "failed" };
    }
    return { ok: true, answers: value };
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
