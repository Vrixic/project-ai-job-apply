import { extensionConfiguration } from "./config";
import { selectContributionFields } from "./job-capture";
import { classifyResponse, type PendingJobIntent } from "./pending-queue";

export async function sendJobIntent(
  intent: PendingJobIntent,
  accessToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<ReturnType<typeof classifyResponse>> {
  if (!extensionConfiguration.apiOrigin) {
    return { outcome: "terminal" };
  }
  const capture =
    intent.intent === "contribute"
      ? selectContributionFields(intent.capture, intent.approvedFields)
      : intent.capture;
  try {
    const request = createJobIntentRequest(
      intent,
      capture,
      accessToken,
      extensionConfiguration.apiOrigin,
    );
    const response = await fetchImplementation(request.url, request.init);
    return classifyResponse(response.status);
  } catch {
    return { outcome: "retryable" };
  }
}

export function createJobIntentRequest(
  intent: PendingJobIntent,
  capture: ReturnType<typeof selectContributionFields>,
  accessToken: string,
  apiOrigin: string,
): { init: RequestInit; url: URL } {
  const path = intent.intent === "contribute" ? "/v1/jobs/contributions" : "/v1/saved-job-captures";
  return {
    init: {
      body: JSON.stringify({
        capture,
        clientIntentId: intent.id,
        clientSurface: "browser_extension",
        intent: intent.intent,
      }),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": intent.idempotencyKey,
      },
      method: "POST",
    },
    url: new URL(path, apiOrigin),
  };
}
