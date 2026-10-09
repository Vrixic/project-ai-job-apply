import type {
  Application,
  ApplicationPacketPreparation,
  PrepareApplicationPacketRequest,
} from "@ai-job-apply/api-contracts";
import {
  type ApplicationsCallOptions,
  type ApplicationsCallResult,
  applicationsProblemCode,
  applicationsProblemCopy,
} from "./applications-client";

type Failure = Extract<ApplicationsCallResult, { ok: false }>;
export type PreparationCallResult =
  | Failure
  | { ok: true; kind: "application"; application: Application }
  | { ok: true; kind: "preparation"; preparation: ApplicationPacketPreparation };

/** The BFF validates the contract; the browser also binds each result to its addressed owner resource. */
async function preparationCall(
  applicationId: string,
  request: { body: PrepareApplicationPacketRequest; key: string } | { preparationId: string },
  options: ApplicationsCallOptions,
): Promise<PreparationCallResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 15_000);
  const preparing = "body" in request;
  try {
    const response = await (options.fetch ?? fetch)(
      `/api/platform/applications/${applicationId}/${preparing ? "packets" : `preparations/${request.preparationId}`}`,
      {
        method: preparing ? "POST" : "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        ...(preparing
          ? {
              headers: { "content-type": "application/json", "idempotency-key": request.key },
              body: JSON.stringify(request.body),
            }
          : {}),
      },
    );
    const value: unknown = await response.json().catch(() => undefined);
    if (controller.signal.aborted) throw new Error("Preparation read ended");
    if (response.ok && value && typeof value === "object") {
      if (preparing && !request.body.coverLetter && [200, 201].includes(response.status)) {
        const application = value as Partial<Application>;
        if (
          application.id === applicationId &&
          typeof application.status === "string" &&
          Number.isSafeInteger(application.revision)
        )
          return { ok: true, kind: "application", application: application as Application };
      }
      if (response.status === (preparing ? 202 : 200) && (!preparing || request.body.coverLetter)) {
        const operation = value as Partial<ApplicationPacketPreparation>;
        if (
          typeof operation.id === "string" &&
          operation.applicationId === applicationId &&
          (preparing || operation.id === request.preparationId) &&
          ["queued", "running", "succeeded", "failed"].includes(operation.state ?? "") &&
          (operation.state !== "succeeded" ||
            (typeof operation.result?.packetId === "string" &&
              Number.isSafeInteger(operation.result.revision) &&
              operation.result.revision > 0)) &&
          (operation.state !== "failed" || typeof operation.errorCode === "string")
        )
          return {
            ok: true,
            kind: "preparation",
            preparation: operation as ApplicationPacketPreparation,
          };
      }
    }
    const code = applicationsProblemCode(
      !response.ok && value && typeof value === "object" && "code" in value
        ? value.code
        : undefined,
    );
    return { ok: false, status: response.status, code, message: applicationsProblemCopy(code) };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "applications_unavailable",
      message: applicationsProblemCopy("applications_unavailable"),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function prepareApplicationPacket(
  applicationId: string,
  body: PrepareApplicationPacketRequest,
  key: string,
  options: ApplicationsCallOptions = {},
) {
  return preparationCall(applicationId, { body, key }, options);
}

export function readApplicationPreparation(
  applicationId: string,
  preparationId: string,
  options: ApplicationsCallOptions = {},
) {
  return preparationCall(applicationId, { preparationId }, options);
}

const FAILURE_COPY: Record<NonNullable<ApplicationPacketPreparation["errorCode"]>, string> = {
  disclosure_expired:
    "Your permission expired before preparation finished. Read the notice and choose again.",
  generation_unavailable:
    "Cover-letter generation is unavailable. You can continue without a cover letter.",
  no_confirmed_evidence: "Add confirmed career facts before requesting a cover letter.",
  grounding_failed:
    "We could not verify this draft against your confirmed facts, so it cannot be used.",
  render_failed: "We could not build the cover-letter files, so the draft cannot be used.",
  bindings_changed:
    "The job, form or evidence changed. Review the current application before preparing again.",
  application_changed: "This application changed during preparation. Review its current state.",
};

export function preparationFailureCopy(code: ApplicationPacketPreparation["errorCode"]): string {
  return (
    (code && FAILURE_COPY[code]) ||
    "Preparation could not finish safely. Review the current application."
  );
}
