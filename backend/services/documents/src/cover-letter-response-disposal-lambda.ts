import type { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import {
  CoverLetterResponseDisposalError,
  type CoverLetterResponseDisposalInput,
  type CoverLetterResponseDisposalOutput,
  validateResponseDisposalInput,
} from "./cover-letter-response-disposal-contract.js";
import { createCoverLetterResponseDisposalHandler } from "./cover-letter-response-disposal-handler.js";
import { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";
import {
  createPrivateDocumentsLambda,
  type PrivateDocumentsEnvironment,
} from "./private-documents-lambda.js";

type Responses = Parameters<typeof createCoverLetterResponseDisposalHandler>[0]["responses"];

/** Private maintenance inventory/positive-receipt bootstrap only; default off. Exact target
 * binding is not caller authentication. No capture, provider, work settlement, renewal,
 * object, renderer, Invoke, finalization or purge capability is supplied.
 */
export function createCoverLetterResponseDisposalLambda(
  options: {
    environment?: () => PrivateDocumentsEnvironment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createPool?: (
      url: string,
      options: { max: 1; idle_timeout: 20; connect_timeout: 10 },
    ) => postgres.Sql;
    createResponses?: (url: string, enabled: () => boolean) => Responses;
  } = {},
) {
  const createPool = options.createPool ?? postgres;
  const createResponses =
    options.createResponses ??
    ((url, enabled) => {
      const client = createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 });
      const responses = new PostgresCoverLetterResponseStore(client, enabled);
      return {
        read: responses.read.bind(responses),
        readCompleted: responses.readCompleted.bind(responses),
        readFailed: responses.readFailed.bind(responses),
        recordDisposal: responses.recordDisposal.bind(responses),
      };
    });
  return createPrivateDocumentsLambda<
    CoverLetterResponseDisposalInput,
    CoverLetterResponseDisposalOutput
  >({
    flag: "COVER_LETTER_RESPONSE_DISPOSAL_ENABLED",
    validateInput: validateResponseDisposalInput,
    invalidInput: () => new CoverLetterResponseDisposalError(),
    unavailable: (input): CoverLetterResponseDisposalOutput =>
      input.action === "record_disposal"
        ? { ...input, outcome: "unavailable" }
        : { ...input, outcome: "unavailable", inventory: null },
    createControl: (url, functionArn, enabled) =>
      createCoverLetterResponseDisposalHandler({
        functionArn,
        responses: createResponses(url, enabled),
        enabled,
      }),
    environment: options.environment,
    resolveDatabaseUrl: options.resolveDatabaseUrl,
  });
}

// No secret, SQL or cloud I/O at module load.
export const handler = createCoverLetterResponseDisposalLambda();
