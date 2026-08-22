import {
  compileComponentValidator,
  type JobReportSummary,
  type ModerationCase,
  type ModerationCasePage,
  type ModerationCaseSearchRequest,
  type OpenModerationCaseRequest,
  type ProblemDetails,
  type ResolveModerationCaseRequest,
} from "@ai-job-apply/api-contracts";

const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const PROBLEM_TYPE = /^application\/problem\+json(?:\s*;\s*charset=utf-8)?$/i;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const validators = {
  open: compileComponentValidator("OpenModerationCaseRequest"),
  resolve: compileComponentValidator("ResolveModerationCaseRequest"),
  search: compileComponentValidator("ModerationCaseSearchRequest"),
  case: compileComponentValidator("ModerationCase"),
  page: compileComponentValidator("ModerationCasePage"),
  summary: compileComponentValidator("JobReportSummary"),
  problem: compileComponentValidator("ProblemDetails"),
};

const declaredProblems = new Map<string, string>([
  ["400:invalid_request", "Invalid request"],
  ["400:invalid_moderation_cursor", "Invalid moderation cursor"],
  ["401:authentication_required", "Authentication required"],
  ["403:forbidden", "Forbidden"],
  ["404:moderation_target_unavailable", "Moderation target unavailable"],
  ["409:moderation_case_changed", "Moderation case changed"],
  ["503:moderation_unavailable", "Moderation unavailable"],
]);

export interface ModerationBffDependencies {
  getSession(): Promise<unknown | null>;
  getAccessToken(): Promise<{ token: string }>;
  fetch: typeof globalThis.fetch;
  baseUrl: string;
}

type RequestKind = "open" | "resolve" | "search";
type ResponseKind = "case" | "page" | "summary";

export function moderationId(value: string): string | undefined {
  return UUID_V7.test(value) ? value : undefined;
}

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    {
      type: `urn:ai-job-apply:problem:${code}`,
      title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

async function boundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!stream) throw new Error("The body is unavailable");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => undefined);
        throw new Error("The body is too large");
      }
      chunks.push(part.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cancellation is best effort after a rejected hostile stream.
    }
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function requestBody(
  request: Request,
  kind: RequestKind,
): Promise<{ body: string; value: unknown } | { failure: Response }> {
  if (!JSON_TYPE.test(request.headers.get("content-type") ?? "")) {
    return { failure: problem(415, "unsupported_media_type", "Unsupported media type") };
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    return { failure: problem(413, "payload_too_large", "Payload too large") };
  }
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedBytes(request.body, MAX_REQUEST_BYTES),
    );
    const value: unknown = JSON.parse(body);
    if (!validators[kind](value)) {
      return { failure: problem(400, "invalid_request", "Invalid request") };
    }
    return { body, value };
  } catch {
    return { failure: problem(400, "invalid_request", "Invalid request") };
  }
}

function safeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("The platform URL is unsafe");
  }
  return url;
}

async function projectedResponse(response: Response, kind: ResponseKind): Promise<Response> {
  const success = response.ok;
  const contentType = response.headers.get("content-type") ?? "";
  if (!(success ? JSON_TYPE : PROBLEM_TYPE).test(contentType)) {
    void response.body?.cancel().catch(() => undefined);
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBytes(response.body, MAX_RESPONSE_BYTES),
      ),
    );
    if (success) {
      if (!validators[kind](value)) throw new Error("Invalid success response");
      return Response.json(value, {
        status: response.status,
        headers: { "cache-control": "no-store" },
      });
    }
    if (!validators.problem(value)) throw new Error("Invalid problem response");
    const upstream = value as ProblemDetails;
    const title = declaredProblems.get(`${response.status}:${upstream.code}`);
    if (
      !title ||
      upstream.status !== response.status ||
      upstream.type !== `urn:ai-job-apply:problem:${upstream.code}`
    ) {
      throw new Error("Undeclared problem response");
    }
    return problem(response.status, upstream.code, title);
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
}

export async function forwardModeration(
  request: Request,
  options: {
    path: string;
    method: "GET" | "POST";
    requestKind?: RequestKind;
    responseKind: ResponseKind;
  },
  dependencies: ModerationBffDependencies,
): Promise<Response> {
  if (new URL(request.url).search !== "") {
    return problem(400, "invalid_request", "Invalid request");
  }
  let body: string | undefined;
  if (options.requestKind) {
    const decoded = await requestBody(request, options.requestKind);
    if ("failure" in decoded) return decoded.failure;
    body = decoded.body;
  } else if (request.body !== null) {
    return problem(400, "invalid_request", "Invalid request");
  }
  try {
    if (!(await dependencies.getSession())) {
      return problem(401, "authentication_required", "Authentication required");
    }
    const { token } = await dependencies.getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await dependencies.fetch(
        new URL(options.path, safeBaseUrl(dependencies.baseUrl)),
        {
          method: options.method,
          ...(body ? { body, headers: { "content-type": "application/json" } } : {}),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([request.signal, controller.signal]),
          headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            authorization: `Bearer ${token}`,
          },
        },
      );
      return await projectedResponse(response, options.responseKind);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
}

export type ModerationRequest =
  | OpenModerationCaseRequest
  | ResolveModerationCaseRequest
  | ModerationCaseSearchRequest;
export type ModerationResponse = ModerationCase | ModerationCasePage | JobReportSummary;
