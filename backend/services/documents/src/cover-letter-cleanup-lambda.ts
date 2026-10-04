import type { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import {
  CoverLetterCleanupError,
  type CoverLetterCleanupInput,
  type CoverLetterCleanupOutput,
  validateCoverLetterCleanupInput,
} from "./cover-letter-cleanup-contract.js";
import { createCoverLetterCleanupHandler } from "./cover-letter-cleanup-handler.js";
import { PostgresCoverLetterWorkStore } from "./cover-letter-work-store.js";
import {
  createPrivateDocumentsLambda,
  type PrivateDocumentsEnvironment,
} from "./private-documents-lambda.js";

type Work = Parameters<typeof createCoverLetterCleanupHandler>[0]["work"];

/** Source-only maintenance fence, never a provider or purge capability. Reviewed maintenance-only
 * caller IAM, artifact wiring, deployment and activation remain required. A ledger-terminal
 * response is not remote provider/private-writer quiescence or permission to delete objects.
 */
export function createCoverLetterCleanupLambda(
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
      const client = createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 });
      const work = new PostgresCoverLetterWorkStore(client, enabled);
      return { fenceForCleanup: work.fenceForCleanup.bind(work) };
    });
  return createPrivateDocumentsLambda<CoverLetterCleanupInput, CoverLetterCleanupOutput>({
    flag: "COVER_LETTER_CLEANUP_CONTROL_ENABLED",
    validateInput: validateCoverLetterCleanupInput,
    invalidInput: () => new CoverLetterCleanupError(),
    unavailable: (input) => ({ ...input, outcome: "unavailable" }),
    createControl: (url, functionArn, enabled) =>
      createCoverLetterCleanupHandler({
        functionArn,
        work: createWork(url, enabled),
        enabled,
      }),
    environment: options.environment,
    resolveDatabaseUrl: options.resolveDatabaseUrl,
  });
}

// No secret, SQL or cloud I/O at module load.
export const handler = createCoverLetterCleanupLambda();
