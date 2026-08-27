import { getLazyAuth0Session } from "../../../../../lib/auth0";
import {
  candidateRightsIdentifier,
  invalidCandidateRightsRequest,
  validBodylessCandidateRightsRequest,
} from "../../../../../lib/candidate-rights-bff";
import { validateFoundationResponse } from "../../../../../lib/foundation-response-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ dataExportId: string }> },
): Promise<Response> {
  if (!validBodylessCandidateRightsRequest(request)) return invalidCandidateRightsRequest();
  const dataExportId = candidateRightsIdentifier((await context.params).dataExportId);
  if (!dataExportId) return invalidCandidateRightsRequest();
  const response = await forwardPlatformRequest(
    `/v1/me/data-exports/${dataExportId}`,
    { method: "GET", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "CandidateDataExportAccess", request.signal);
}
