import { getAuth0Client } from "../../../../../../lib/auth0";
import {
  candidateRightsIdentifier,
  invalidCandidateRightsRequest,
} from "../../../../../../lib/candidate-rights-bff";
import { validateFoundationResponse } from "../../../../../../lib/foundation-response-bff";
import { readFoundationWriteRequest } from "../../../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ deletionRequestId: string }> },
): Promise<Response> {
  const deletionRequestId = candidateRightsIdentifier((await context.params).deletionRequestId);
  if (!deletionRequestId) return invalidCandidateRightsRequest();
  const decoded = await readFoundationWriteRequest(request, "ConfirmAccountDeletionRequest");
  if ("failure" in decoded) return decoded.failure;
  const response = await forwardPlatformRequest(
    `/v1/me/account-deletion-requests/${deletionRequestId}/confirm`,
    {
      method: "POST",
      body: decoded.body,
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": decoded.idempotencyKey,
      },
    },
    {
      auth0: getAuth0Client(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 202, "AccountDeletionRequest", request.signal);
}
