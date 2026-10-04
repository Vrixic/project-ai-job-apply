import type { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import {
  CoverLetterProviderControlError,
  type CoverLetterProviderControlInput,
  type CoverLetterProviderControlOutput,
  validateProviderControlInput,
} from "./cover-letter-provider-control-contract.js";
import { createCoverLetterProviderControlHandler } from "./cover-letter-provider-control-handler.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import {
  createPrivateDocumentsLambda,
  type PrivateDocumentsEnvironment,
} from "./private-documents-lambda.js";

type Work = Parameters<typeof createCoverLetterProviderControlHandler>[0]["work"];

/** Source-only private entrypoint. Not built/deployed or caller-authenticated by this module.
 * Reviewed exact-version caller IAM and isolated database/secret permissions remain mandatory.
 * No model, object, renderer, Invoke, issue, renewal, maintenance or purge capability exists here.
 */
export function createCoverLetterProviderControlLambda(
  options: {
    environment?: () => PrivateDocumentsEnvironment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createPool?: (
      url: string,
      options: { max: 1; idle_timeout: 20; connect_timeout: 10 },
    ) => postgres.Sql;
    createWork?: (url: string, enabled: () => boolean) => Work;
  } = {},
) {
  const createPool = options.createPool ?? postgres;
  const createWork =
    options.createWork ??
    ((url, enabled) => {
      // The ORM helper rewrites timestamp parsers to strings. This raw ledger needs native Dates.
      const client = createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 });
      const work = new PostgresCoverLetterWorkStore(client, enabled);
      return {
        claimProviderDispatch: work.claimProviderDispatch.bind(work),
        settleProviderDispatch: work.settleProviderDispatch.bind(work),
        settleRejectedProviderDispatch: work.settleRejectedProviderDispatch.bind(work),
        settleUndispatchedProviderDispatch: work.settleUndispatchedProviderDispatch.bind(work),
      };
    });
  return createPrivateDocumentsLambda<
    CoverLetterProviderControlInput,
    CoverLetterProviderControlOutput
  >({
    flag: "COVER_LETTER_PROVIDER_CONTROL_ENABLED",
    validateInput: validateProviderControlInput,
    invalidInput: () => new CoverLetterProviderControlError(),
    unavailable: (input): CoverLetterProviderControlOutput => ({
      schemaVersion: 1,
      action: input.action,
      documentId: input.documentId,
      outcome: "unavailable",
    }),
    createControl: (url, functionArn, enabled) =>
      createCoverLetterProviderControlHandler({
        functionArn,
        work: createWork(url, enabled),
        enabled,
      }),
    environment: options.environment,
    resolveDatabaseUrl: options.resolveDatabaseUrl,
  });
}

// Construction is lazy and performs no secret, SQL or cloud I/O at module load.
export const handler = createCoverLetterProviderControlLambda();
