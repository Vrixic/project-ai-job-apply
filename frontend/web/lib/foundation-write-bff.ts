import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { RequestBodyTooLargeError, readBoundedRequestBody } from "./bounded-request-body";
import { isCanonicalRestrictedAnswerContext } from "./restricted-answer-fields";

const MAXIMUM_FOUNDATION_WRITE_BODY_BYTES = 64 * 1024;
const FOUNDATION_WRITE_BODY_TIMEOUT_MILLISECONDS = 2_000;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export type FoundationWriteSchemaName =
  | "PutJobPreferencesRequest"
  | "CreateResumeUploadRequest"
  | "CreateProfileFactRequest"
  | "UpdateProfileFactRequest"
  | "SaveRestrictedAnswerRequest"
  | "CreateCandidateDataExportRequest"
  | "CreateAccountDeletionRequest"
  | "ConfirmAccountDeletionRequest";

const validators = new Map<FoundationWriteSchemaName, ReturnType<typeof compileComponentValidator>>(
  [
    ["PutJobPreferencesRequest", compileComponentValidator("PutJobPreferencesRequest")],
    ["CreateResumeUploadRequest", compileComponentValidator("CreateResumeUploadRequest")],
    ["CreateProfileFactRequest", compileComponentValidator("CreateProfileFactRequest")],
    ["UpdateProfileFactRequest", compileComponentValidator("UpdateProfileFactRequest")],
    ["SaveRestrictedAnswerRequest", compileComponentValidator("SaveRestrictedAnswerRequest")],
    [
      "CreateCandidateDataExportRequest",
      compileComponentValidator("CreateCandidateDataExportRequest"),
    ],
    ["CreateAccountDeletionRequest", compileComponentValidator("CreateAccountDeletionRequest")],
    ["ConfirmAccountDeletionRequest", compileComponentValidator("ConfirmAccountDeletionRequest")],
  ],
);

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
      },
    },
  );
}

function cancelRequestBody(request: Request): void {
  if (!request.body) return;
  try {
    void request.body.cancel().catch(() => undefined);
  } catch {
    // A hostile or already-locked body must not replace the fixed boundary response.
  }
}

function rejectBeforeRead(
  request: Request,
  status: number,
  code: string,
  title: string,
): { failure: Response } {
  cancelRequestBody(request);
  return { failure: problem(status, code, title) };
}

export async function readFoundationWriteRequest(
  request: Request,
  schemaName: FoundationWriteSchemaName,
  timeoutMilliseconds = FOUNDATION_WRITE_BODY_TIMEOUT_MILLISECONDS,
  queryPolicy: "none" | "restricted-answer-context" = "none",
): Promise<{ body: string; idempotencyKey: string } | { failure: Response }> {
  const url = new URL(request.url);
  const queryEntries = [...url.searchParams.entries()];
  const queryIsValid =
    queryPolicy === "none"
      ? queryEntries.length === 0
      : queryEntries.length === 0 ||
        (queryEntries.length === 1 &&
          queryEntries[0]?.[0] === "context" &&
          isCanonicalRestrictedAnswerContext(queryEntries[0]?.[1] ?? ""));
  if (!queryIsValid) {
    return rejectBeforeRead(request, 400, "invalid_request", "Invalid request");
  }
  if (!JSON_CONTENT_TYPE_PATTERN.test(request.headers.get("content-type") ?? "")) {
    return rejectBeforeRead(request, 415, "unsupported_media_type", "Unsupported media type");
  }
  if (request.headers.get("transfer-encoding") !== null) {
    return rejectBeforeRead(request, 400, "invalid_request", "Invalid request");
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_FOUNDATION_WRITE_BODY_BYTES)
  ) {
    return rejectBeforeRead(request, 413, "payload_too_large", "Payload too large");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey === null || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    return rejectBeforeRead(request, 400, "invalid_request", "Invalid request");
  }

  try {
    const bytes = await readBoundedRequestBody(request, {
      maximumBytes: MAXIMUM_FOUNDATION_WRITE_BODY_BYTES,
      timeoutMilliseconds,
    });
    if (
      bytes.byteLength === 0 ||
      (declaredLength !== null && Number(declaredLength) !== bytes.byteLength)
    ) {
      return { failure: problem(400, "invalid_request", "Invalid request") };
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(body);
    if (!validators.get(schemaName)?.(value)) {
      return { failure: problem(400, "invalid_request", "Invalid request") };
    }
    return { body, idempotencyKey };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { failure: problem(413, "payload_too_large", "Payload too large") };
    }
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
}
