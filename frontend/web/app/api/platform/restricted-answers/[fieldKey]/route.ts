import type { SaveRestrictedAnswerRequest } from "@ai-job-apply/api-contracts";
import { getLazyAuth0Session } from "../../../../../lib/auth0";
import { readBoundedRequestBody } from "../../../../../lib/bounded-request-body";
import { validateFoundationResponse } from "../../../../../lib/foundation-response-bff";
import { readFoundationWriteRequest } from "../../../../../lib/foundation-write-bff";
import { forwardPlatformRequest } from "../../../../../lib/platform-api";
import {
  isRestrictedAnswerVaultUiEnabled,
  restrictedAnswerContext,
  restrictedAnswerField,
} from "../../../../../lib/restricted-answer-fields";

export const dynamic = "force-dynamic";

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

function cancelRequestBody(request?: Request): void {
  if (request?.body) {
    try {
      void request.body.cancel().catch(() => undefined);
    } catch {
      // A hostile or locked body must not replace the fixed boundary response.
    }
  }
}

function invalidRequest(request?: Request): Response {
  cancelRequestBody(request);
  return problem(400, "invalid_request", "Invalid request");
}

function notFound(request?: Request): Response {
  cancelRequestBody(request);
  return problem(404, "not_found", "Not found");
}

function unavailable(): Response {
  return problem(503, "platform_unavailable", "The platform API is unavailable");
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A hostile or locked body must not replace the fixed boundary response.
  }
}

function target(
  request: Request,
  fieldKey: string,
): { definition: NonNullable<ReturnType<typeof restrictedAnswerField>>; path: string } | undefined {
  const definition = restrictedAnswerField(fieldKey);
  const context = restrictedAnswerContext(new URL(request.url).searchParams);
  if (!definition || context === null) return undefined;
  const query = context === undefined ? "" : `?${new URLSearchParams({ context })}`;
  return {
    definition,
    path: `/v1/profile/restricted-answers/${encodeURIComponent(fieldKey)}${query}`,
  };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ fieldKey: string }> },
): Promise<Response> {
  if (!isRestrictedAnswerVaultUiEnabled()) return notFound(request);
  const fieldKey = (await context.params).fieldKey;
  const resolvedTarget = target(request, fieldKey);
  if (!resolvedTarget) return invalidRequest(request);

  const decoded = await readFoundationWriteRequest(
    request,
    "SaveRestrictedAnswerRequest",
    2_000,
    "restricted-answer-context",
  );
  if ("failure" in decoded) return decoded.failure;
  const body = JSON.parse(decoded.body) as SaveRestrictedAnswerRequest;
  if (
    body.valueType !== resolvedTarget.definition.valueType ||
    body.sensitivity !== "restricted" ||
    body.sourceReference !== "candidate.settings" ||
    body.expiresAt !== undefined ||
    (body.valueType === "boolean" && body.value !== "true" && body.value !== "false")
  ) {
    return invalidRequest();
  }

  const response = await forwardPlatformRequest(
    resolvedTarget.path,
    {
      method: "PUT",
      body: decoded.body,
      signal: request.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": decoded.idempotencyKey,
      },
    },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  return validateFoundationResponse(response, 200, "RestrictedAnswer", request.signal);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ fieldKey: string }> },
): Promise<Response> {
  if (!isRestrictedAnswerVaultUiEnabled()) return notFound(request);
  const fieldKey = (await context.params).fieldKey;
  const resolvedTarget = target(request, fieldKey);
  const declaredLength = request.headers.get("content-length");
  if (
    !resolvedTarget ||
    request.signal.aborted ||
    (declaredLength !== null && declaredLength !== "0") ||
    request.headers.get("transfer-encoding") !== null ||
    request.headers.get("content-type") !== null
  ) {
    return invalidRequest(request);
  }
  // Next's Node adapter exposes a stream even for bodyless DELETE requests.
  if (request.body) {
    try {
      const bytes = await readBoundedRequestBody(request, {
        maximumBytes: 1,
        timeoutMilliseconds: 2_000,
      });
      if (bytes.byteLength !== 0) return invalidRequest();
    } catch {
      return invalidRequest();
    }
  }
  const response = await forwardPlatformRequest(
    resolvedTarget.path,
    { method: "DELETE", signal: request.signal },
    {
      auth0: getLazyAuth0Session(),
      baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch,
    },
  );
  if (!response.ok) return response;
  if (response.status !== 204) {
    cancelBody(response);
    return unavailable();
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
