import type { GenerateNarrativeAnswerRequest, NarrativeAnswer } from "@ai-job-apply/api-contracts";

/**
 * Short free-text answers drafted for the candidate (ADR-057). The draft is returned once to the
 * candidate's own browser and is never stored: no packet field, no database row, no log, no
 * idempotency record. The candidate reads and edits it before anything is submitted.
 */
export interface ApplicationNarrativeAnswers {
  generate(input: {
    ownerUserId: string;
    applicationId: string;
    canonicalJobId: string;
    request: GenerateNarrativeAnswerRequest;
  }): Promise<NarrativeAnswer>;
}

/** Live drafting is switched off (the kill switch) or the provider could not be reached. */
export class NarrativeAnswersUnavailableError extends Error {
  constructor() {
    super("Narrative answers are unavailable");
    this.name = "NarrativeAnswersUnavailableError";
  }
}

/** The candidate asked for more drafts than the short window allows. */
export class NarrativeAnswerLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many narrative answer requests");
    this.name = "NarrativeAnswerLimitError";
  }
}

/** The application is finished, so there is nothing left to answer. */
export class NarrativeAnswerStateError extends Error {
  constructor() {
    super("The application is not open for answers");
    this.name = "NarrativeAnswerStateError";
  }
}
