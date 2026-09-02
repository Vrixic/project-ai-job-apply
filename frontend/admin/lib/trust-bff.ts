import { compileComponentValidator, type ProblemDetails } from "@ai-job-apply/api-contracts";

const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const PROBLEM_TYPE = /^application\/problem\+json(?:\s*;\s*charset=utf-8)?$/i;
const TRUST_CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[78][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;

const validators = {
  open: compileComponentValidator("OpenTrustCaseRequest"),
  decide: compileComponentValidator("DecideTrustCaseRequest"),
  takedown: compileComponentValidator("TakeDownTrustCaseRequest"),
  resolveAppeal: compileComponentValidator("ResolveTrustAppealRequest"),
  trustCase: compileComponentValidator("ReviewerTrustCase"),
  problem: compileComponentValidator("ProblemDetails"),
};

const declaredProblems = new Set([
  "400:invalid_trust_request",
  "400:invalid_request",
  "401:authentication_required",
  "403:forbidden",
  "403:trust_access_denied",
  "404:trust_case_not_found",
  "409:trust_evidence_unverified",
  "409:trust_state_conflict",
  "409:trust_version_conflict",
  "503:trust_policy_unavailable",
  "503:trust_unavailable",
]);

export interface TrustBffDependencies {
  getSession(): Promise<unknown | null>;
  getAccessToken(): Promise<{ token: string }>;
  fetch: typeof globalThis.fetch;
  baseUrl: string;
}

export type TrustRequestKind = "open" | "decide" | "takedown" | "resolveAppeal";

export function trustId(value: string): string | undefined {
  return TRUST_CASE_ID.test(value) ? value : undefined;
}

export function trustProblem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `urn:ai-job-apply:problem:${code}`, title, status, code, traceId: crypto.randomUUID() },
    {
      status,
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    },
  );
}

async function bounded(response: Response, maximum: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new Error();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) throw new Error();
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

async function decodeRequest(request: Request, kind: TrustRequestKind): Promise<string | Response> {
  if (!JSON_TYPE.test(request.headers.get("content-type") ?? "")) {
    return trustProblem(415, "unsupported_media_type", "Unsupported media type");
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    return trustProblem(413, "payload_too_large", "Payload too large");
  }
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_REQUEST_BYTES) throw new Error();
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!validators[kind](JSON.parse(body))) throw new Error();
    return body;
  } catch {
    return trustProblem(400, "invalid_request", "Invalid request");
  }
}

export async function forwardTrust(
  request: Request,
  options: { path: string; method: "GET" | "POST"; requestKind?: TrustRequestKind },
  dependencies: TrustBffDependencies,
): Promise<Response> {
  if (new URL(request.url).search) return trustProblem(400, "invalid_request", "Invalid request");
  let body: string | undefined;
  if (options.requestKind) {
    const decoded = await decodeRequest(request, options.requestKind);
    if (decoded instanceof Response) return decoded;
    body = decoded;
  } else if (request.body !== null) {
    return trustProblem(400, "invalid_request", "Invalid request");
  }
  try {
    if (!(await dependencies.getSession())) {
      return trustProblem(401, "authentication_required", "Authentication required");
    }
    const { token } = await dependencies.getAccessToken();
    const response = await dependencies.fetch(
      new URL(options.path, safeBaseUrl(dependencies.baseUrl)),
      {
        method: options.method,
        ...(body ? { body, headers: { "content-type": "application/json" } } : {}),
        cache: "no-store",
        redirect: "error",
        signal: request.signal,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${token}`,
        },
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (!(response.ok ? JSON_TYPE : PROBLEM_TYPE).test(contentType)) throw new Error();
    const value: unknown = JSON.parse(await bounded(response, MAX_RESPONSE_BYTES));
    if (response.ok) {
      if (!validators.trustCase(value)) throw new Error();
      return Response.json(value, {
        status: response.status,
        headers: { "cache-control": "no-store" },
      });
    }
    if (!validators.problem(value)) throw new Error();
    const upstream = value as ProblemDetails;
    if (
      upstream.status !== response.status ||
      upstream.type !== `urn:ai-job-apply:problem:${upstream.code}` ||
      !declaredProblems.has(`${response.status}:${upstream.code}`)
    ) {
      throw new Error();
    }
    return trustProblem(response.status, upstream.code, "The Trust request could not be completed");
  } catch {
    return trustProblem(503, "platform_unavailable", "The platform API is unavailable");
  }
}
