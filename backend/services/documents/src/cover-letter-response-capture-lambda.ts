import type { resolveLambdaDatabaseUrl } from "@ai-job-apply/profile-service";
import postgres from "postgres";
import {
  CoverLetterResponseCaptureError,
  type CoverLetterResponseCaptureInput,
  type CoverLetterResponseCaptureOutput,
  validateResponseCaptureInput,
} from "./cover-letter-response-capture-contract.js";
import { createCoverLetterResponseCaptureHandler } from "./cover-letter-response-capture-handler.js";
import { PostgresCoverLetterResponseStore } from "./cover-letter-response-store.js";
import {
  createPrivateDocumentsLambda,
  type PrivateDocumentsEnvironment,
} from "./private-documents-lambda.js";

type Capture = Parameters<typeof createCoverLetterResponseCaptureHandler>[0]["capture"];

/** Source-only private original-response capture. Exact target checks are not caller authentication.
 * No read/disposal, settlement, renewal, model, object, renderer, Invoke or purge capability.
 * Reviewed IAM, artifact wiring, deployment and activation remain prerequisites.
 */
export function createCoverLetterResponseCaptureLambda(
  options: {
    environment?: () => PrivateDocumentsEnvironment;
    resolveDatabaseUrl?: typeof resolveLambdaDatabaseUrl;
    createPool?: (
      url: string,
      options: { max: 1; idle_timeout: 20; connect_timeout: 10 },
    ) => postgres.Sql;
    createCapture?: (url: string, enabled: () => boolean) => Capture;
  } = {},
) {
  const createPool = options.createPool ?? postgres;
  const createCapture =
    options.createCapture ??
    ((url, enabled) => {
      const client = createPool(url, { max: 1, idle_timeout: 20, connect_timeout: 10 });
      const capture = new PostgresCoverLetterResponseStore(client, enabled);
      return {
        reserve: capture.reserve.bind(capture),
        recordCreation: capture.recordCreation.bind(capture),
      };
    });
  return createPrivateDocumentsLambda<
    CoverLetterResponseCaptureInput,
    CoverLetterResponseCaptureOutput
  >({
    flag: "COVER_LETTER_RESPONSE_CAPTURE_ENABLED",
    validateInput: validateResponseCaptureInput,
    invalidInput: () => new CoverLetterResponseCaptureError(),
    unavailable: (input): CoverLetterResponseCaptureOutput => ({
      ...input,
      outcome: "unavailable",
    }),
    createControl: (url, functionArn, enabled) =>
      createCoverLetterResponseCaptureHandler({
        functionArn,
        capture: createCapture(url, enabled),
        enabled,
      }),
    environment: options.environment,
    resolveDatabaseUrl: options.resolveDatabaseUrl,
  });
}

// No secret, SQL or cloud I/O at module load.
export const handler = createCoverLetterResponseCaptureLambda();
