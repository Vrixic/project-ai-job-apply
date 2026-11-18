import type { ChoiceAnswers, DecideChoiceAnswersRequest } from "@ai-job-apply/api-contracts";

/**
 * Choice questions decided for the candidate (ADR-061). The decisions are returned once to the
 * candidate's own browser and are never stored: no packet field, no database row, no log, no
 * idempotency record. The candidate sees every AI-chosen answer, and confirms each restricted one,
 * before anything is submitted.
 */
export interface ApplicationChoiceAnswers {
  decide(input: {
    ownerUserId: string;
    applicationId: string;
    canonicalJobId: string;
    request: DecideChoiceAnswersRequest;
  }): Promise<ChoiceAnswers>;
}

/** Deciding is switched off (the kill switch) or the provider could not be reached. */
export class ChoiceAnswersUnavailableError extends Error {
  constructor() {
    super("Choice answers are unavailable");
    this.name = "ChoiceAnswersUnavailableError";
  }
}

/** The candidate asked for more decisions than the short window allows. */
export class ChoiceAnswerLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many choice answer requests");
    this.name = "ChoiceAnswerLimitError";
  }
}

/** The application is finished, so there is nothing left to answer. */
export class ChoiceAnswerStateError extends Error {
  constructor() {
    super("The application is not open for answers");
    this.name = "ChoiceAnswerStateError";
  }
}
