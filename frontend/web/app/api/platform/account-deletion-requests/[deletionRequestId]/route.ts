import { getAuth0Client } from "../../../../../lib/auth0";
import {
  candidateRightsIdentifier,
  candidateRightsIfMatch,
  exactNoContent,
  invalidCandidateRightsRequest,
  validBodylessCandidateRightsRequest,
  validIdempotencyKey,
} from "../../../../../lib/candidate-rights-bff";
import { validateFoundationResponse } from "../../../../../lib/foundation-response-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

async function identifier(
  request: Request,
  context: { params: Promise<{ deletionRequestId: string }> },
): Promise<string | undefined> {
  if (!validBodylessCandidateRightsRequest(request)) return undefined;
  return candidateRightsIdentifier((await context.params).deletionRequestId);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ deletionRequestId: string }> },
): Promise<Response> {
  const deletionRequestId = await identifier(request, context);
  if (!deletionRequestId) return invalidCandidateRightsRequest();
  const response = await forwardPlatformRequest(
    `/v1/me/account-deletion-requests/${deletionRequestId}`,
    { method: "GET", signal: request.signal },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "AccountDeletionRequest", request.signal);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ deletionRequestId: string }> },
): Promise<Response> {
  const deletionRequestId = await identifier(request, context);
  const idempotencyKey = validIdempotencyKey(request);
  const ifMatch = candidateRightsIfMatch(request);
  if (!deletionRequestId || !idempotencyKey || !ifMatch) {
    return invalidCandidateRightsRequest();
  }
  const response = await forwardPlatformRequest(
    `/v1/me/account-deletion-requests/${deletionRequestId}`,
    {
      method: "DELETE",
      signal: request.signal,
      headers: { "idempotency-key": idempotencyKey, "if-match": ifMatch },
    },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
      includeReauthenticationProof: true,
    },
  );
  return exactNoContent(response);
}
