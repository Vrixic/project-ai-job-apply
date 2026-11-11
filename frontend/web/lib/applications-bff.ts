import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import { materialDeadline } from "./application-material-lifetime";
import { getLazyAuth0Session } from "./auth0";
import { forwardPlatformRequest } from "./platform-api";

/**
 * Browser boundary for the fifteen Applications routes. Every request is validated against the
 * generated OpenAPI schemas, bounded, and forwarded to exactly one fixed platform path; every
 * success body is validated again before it reaches the browser. Failures are projected by the
 * shared platform boundary to fixed, value-free problem details.
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const MAXIMUM_REQUEST_BYTES = 32 * 1024;
const MAXIMUM_RESPONSE_BYTES = 512 * 1024;

type ComponentName = Parameters<typeof compileComponentValidator>[0];

export type ApplicationsOperation =
  | "create"
  | "search"
  | "get"
  | "history"
  | "resumePreview"
  | "resumeFile"
  | "uploadedResume"
  | "generatedResumeOriginal"
  | "preparePacket"
  | "preparation"
  | "resumeLocation"
  | "coverLetterLocation"
  | "approve"
  | "reopen"
  | "cancel"
  | "startSubmission"
  | "startManualSubmission"
  | "dispatch"
  | "recordResult"
  | "reconcile";

interface OperationSpec {
  method: "GET" | "POST";
  path: (applicationId: string, attemptId: string) => string;
  request?: ComponentName;
  response: ComponentName;
  success: 200 | 201;
  idempotent: boolean;
  needsApplication: boolean;
  needsAttempt: boolean;
  historyQuery?: boolean;
  /** The single allowed `format` query parameter (generated resumes are PDF only). */
  formatQuery?: boolean;
  generationQuery?: boolean;
  materialKind?: "tailored_resume" | "cover_letter";
  /** Application-typed responses must be the application that was addressed. */
  echoesApplicationId?: boolean;
  /** Submission-start responses must contain the application that was addressed. */
  echoesNestedApplicationId?: boolean;
  echoesPreparationApplicationId?: boolean;
}

const OPERATIONS: Readonly<Record<ApplicationsOperation, OperationSpec>> = {
  create: {
    method: "POST",
    path: () => "/v1/applications",
    request: "CreateApplicationRequest",
    response: "Application",
    success: 201,
    idempotent: true,
    needsApplication: false,
    needsAttempt: false,
  },
  search: {
    method: "POST",
    path: () => "/v1/applications/search",
    request: "ApplicationSearchRequest",
    response: "ApplicationPage",
    success: 200,
    idempotent: false,
    needsApplication: false,
    needsAttempt: false,
  },
  get: {
    method: "GET",
    path: (id) => `/v1/applications/${id}`,
    response: "Application",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
    echoesApplicationId: true,
  },
  history: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/history`,
    response: "ApplicationHistoryPage",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
    historyQuery: true,
  },
  resumePreview: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/resume`,
    response: "ApplicationResumePreview",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
  },
  resumeFile: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/resume/file`,
    response: "ApplicationResumeFile",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
    formatQuery: true,
  },
  uploadedResume: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/resume/uploaded`,
    response: "ApplicationUploadedResumeFile",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
  },
  generatedResumeOriginal: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/resume/original`,
    response: "ApplicationUploadedResumeFile",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
  },
  preparePacket: {
    method: "POST",
    path: (id) => `/v1/applications/${id}/packets`,
    request: "PrepareApplicationPacketRequest",
    response: "Application",
    success: 201,
    idempotent: true,
    needsApplication: true,
    needsAttempt: false,
    echoesApplicationId: true,
  },
  preparation: {
    method: "GET",
    path: (id, preparationId) => `/v1/applications/${id}/preparations/${preparationId}`,
    response: "ApplicationPacketPreparation",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: true,
    echoesPreparationApplicationId: true,
  },
  resumeLocation: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/resume/location`,
    response: "ApplicationTemporaryMaterialLocation",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
    generationQuery: true,
    materialKind: "tailored_resume",
  },
  coverLetterLocation: {
    method: "GET",
    path: (id) => `/v1/applications/${id}/cover-letter/location`,
    response: "ApplicationTemporaryMaterialLocation",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: false,
    generationQuery: true,
    materialKind: "cover_letter",
  },
  approve: {
    method: "POST",
    path: (id) => `/v1/applications/${id}/approval`,
    request: "ApproveApplicationPacketRequest",
    response: "Application",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: false,
    echoesApplicationId: true,
  },
  reopen: {
    method: "POST",
    path: (id) => `/v1/applications/${id}/reopen`,
    request: "ApplicationRevisionRequest",
    response: "Application",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: false,
    echoesApplicationId: true,
  },
  cancel: {
    method: "POST",
    path: (id) => `/v1/applications/${id}/cancel`,
    request: "ApplicationRevisionRequest",
    response: "Application",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: false,
    echoesApplicationId: true,
  },
  startSubmission: {
    method: "POST",
    path: (id) => `/v1/applications/${id}/submissions`,
    request: "StartApplicationSubmissionRequest",
    response: "ApplicationSubmissionStart",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: false,
    echoesNestedApplicationId: true,
  },
  startManualSubmission: {
    method: "POST",
    path: (id) => `/v1/applications/${id}/manual-submissions`,
    request: "StartManualApplicationSubmissionRequest",
    response: "ApplicationSubmissionStart",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: false,
    echoesNestedApplicationId: true,
  },
  dispatch: {
    method: "POST",
    path: (id, attempt) => `/v1/applications/${id}/attempts/${attempt}/dispatch`,
    response: "ApplicationAttempt",
    success: 200,
    idempotent: false,
    needsApplication: true,
    needsAttempt: true,
  },
  recordResult: {
    method: "POST",
    path: (id, attempt) => `/v1/applications/${id}/attempts/${attempt}/result`,
    request: "ApplicationSubmissionResultRequest",
    response: "Application",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: true,
    echoesApplicationId: true,
  },
  reconcile: {
    method: "POST",
    path: (id, attempt) => `/v1/applications/${id}/attempts/${attempt}/reconciliation`,
    request: "ReconcileApplicationAttemptRequest",
    response: "Application",
    success: 200,
    idempotent: true,
    needsApplication: true,
    needsAttempt: true,
    echoesApplicationId: true,
  },
};

const validators = new Map<ComponentName, ReturnType<typeof compileComponentValidator>>();
function validator(component: ComponentName) {
  let compiled = validators.get(component);
  if (!compiled) {
    compiled = compileComponentValidator(component);
    validators.set(component, compiled);
  }
  return compiled;
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

const invalid = () => problem(400, "invalid_request", "Invalid request");
const unavailable = () => problem(503, "applications_unavailable", "Applications are unavailable");

class TooLargeError extends Error {}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal | undefined,
  timeoutMilliseconds: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void reader.cancel().catch(() => undefined);
  };
  const timer = setTimeout(interrupt, timeoutMilliseconds);
  signal?.addEventListener("abort", interrupt, { once: true });
  try {
    while (true) {
      const part = await reader.read();
      if (interrupted) throw new Error("The body was interrupted");
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) {
        void reader.cancel().catch(() => undefined);
        throw new TooLargeError();
      }
      chunks.push(part.value);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", interrupt);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/** Strict, bounded history query: only `afterSeq` and `limit`, each once, as small integers. */
export function historySearch(search: string): string | undefined {
  if (search === "") return "";
  const parameters = new URLSearchParams(search);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const [name, value] of parameters) {
    if ((name !== "afterSeq" && name !== "limit") || seen.has(name)) return undefined;
    if (!/^\d{1,9}$/.test(value)) return undefined;
    if (name === "limit" && (Number(value) < 1 || Number(value) > 200)) return undefined;
    seen.add(name);
    kept.push(`${name}=${value}`);
  }
  return `?${kept.join("&")}`;
}

/** The resume file route takes exactly one `format` parameter, `pdf`, and nothing else. */
export function formatSearch(search: string): string | undefined {
  const parameters = [...new URLSearchParams(search)];
  const only = parameters[0];
  if (parameters.length !== 1 || !only || only[0] !== "format") return undefined;
  return only[1] === "pdf" ? "?format=pdf" : undefined;
}

export interface ApplicationsRouteDependencies {
  auth0?: ReturnType<typeof getLazyAuth0Session>;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export async function applicationsRoute(
  operation: ApplicationsOperation,
  request: Request,
  params: Readonly<Record<string, string | undefined>>,
  dependencies: ApplicationsRouteDependencies = {},
): Promise<Response> {
  const spec = OPERATIONS[operation];
  const applicationId = params.applicationId ?? "";
  const attemptId = (operation === "preparation" ? params.preparationId : params.attemptId) ?? "";
  if (
    (spec.needsApplication && !UUID_V7.test(applicationId)) ||
    (spec.needsAttempt && !UUID_V7.test(attemptId))
  ) {
    return invalid();
  }

  const search = new URL(request.url).search;
  let query = "";
  if (spec.historyQuery) {
    const projected = historySearch(search);
    if (projected === undefined) return invalid();
    query = projected;
  } else if (spec.formatQuery) {
    const projected = formatSearch(search);
    if (projected === undefined) return invalid();
    query = projected;
  } else if (spec.generationQuery) {
    const entries = [...new URLSearchParams(search)];
    const entry = entries[0];
    if (entries.length !== 1 || entry?.[0] !== "generationId" || !UUID_V7.test(entry[1]))
      return invalid();
    query = `?generationId=${entry[1]}`;
  } else if (search.length > 0) {
    return invalid();
  }

  const auth0 = dependencies.auth0 ?? getLazyAuth0Session();
  try {
    if (!(await auth0.getSession())) {
      return problem(401, "authentication_required", "Authentication required");
    }
  } catch {
    return unavailable();
  }

  const headers: Record<string, string> = {};
  if (spec.idempotent) {
    const key = request.headers.get("idempotency-key");
    if (!key || key.length < 16 || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
      return invalid();
    }
    headers["idempotency-key"] = key;
  }

  let body: string | undefined;
  if (spec.request) {
    if (!JSON_CONTENT_TYPE.test(request.headers.get("content-type") ?? "")) {
      return problem(415, "unsupported_media_type", "Unsupported media type");
    }
    if (request.headers.get("transfer-encoding") !== null) return invalid();
    const declared = request.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) > MAXIMUM_REQUEST_BYTES)
    ) {
      return problem(413, "payload_too_large", "Payload too large");
    }
    try {
      const bytes = await readBounded(request.body, MAXIMUM_REQUEST_BYTES, request.signal, 2_000);
      if (bytes.byteLength === 0) return invalid();
      body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!validator(spec.request)(JSON.parse(body))) return invalid();
    } catch (error) {
      return error instanceof TooLargeError
        ? problem(413, "payload_too_large", "Payload too large")
        : invalid();
    }
    headers["content-type"] = "application/json";
  } else if (spec.method === "POST") {
    // Commands without a body accept none, so nothing unvalidated can reach the platform.
    const declared = request.headers.get("content-length");
    if (
      request.headers.get("transfer-encoding") !== null ||
      (declared !== null && declared !== "0")
    ) {
      return invalid();
    }
  }

  const response = await forwardPlatformRequest(
    `${spec.path(applicationId, attemptId)}${query}`,
    {
      method: spec.method,
      signal: request.signal,
      headers,
      ...(body === undefined ? {} : { body }),
    },
    {
      auth0,
      baseUrl: dependencies.baseUrl ?? process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
      fetch: dependencies.fetch ?? fetch,
    },
  );
  // Declared problems were already projected to fixed, value-free bodies.
  if (!response.ok) return response;
  const asynchronous = operation === "preparePacket" && response.status === 202;
  if (asynchronous && !JSON.parse(body ?? "{}").coverLetter) {
    void response.body?.cancel().catch(() => undefined);
    return unavailable();
  }
  return validateSuccess(
    response,
    spec,
    applicationId,
    asynchronous,
    operation === "preparation" ? attemptId : undefined,
    spec.generationQuery
      ? (new URLSearchParams(query).get("generationId") ?? undefined)
      : undefined,
  );
}

async function validateSuccess(
  response: Response,
  spec: OperationSpec,
  applicationId: string,
  asynchronous = false,
  preparationId?: string,
  generationId?: string,
): Promise<Response> {
  const cancel = () => void response.body?.cancel().catch(() => undefined);
  const declaredLength = response.headers.get("content-length");
  if (
    response.status !== (asynchronous ? 202 : spec.success) ||
    !JSON_CONTENT_TYPE.test(response.headers.get("content-type") ?? "") ||
    (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAXIMUM_RESPONSE_BYTES))
  ) {
    cancel();
    return unavailable();
  }
  try {
    const bytes = await readBounded(response.body, MAXIMUM_RESPONSE_BYTES, undefined, 10_000);
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validator(asynchronous ? "ApplicationPacketPreparation" : spec.response)(value))
      throw new Error("The response is invalid");
    if (
      !asynchronous &&
      spec.echoesApplicationId &&
      (value as { id?: unknown }).id !== applicationId
    ) {
      throw new Error("The response is for another application");
    }
    if (
      (asynchronous || spec.echoesPreparationApplicationId) &&
      (value as { applicationId?: unknown }).applicationId !== applicationId
    )
      throw new Error("The preparation is for another application");
    if (preparationId && (value as { id?: unknown }).id !== preparationId)
      throw new Error("The preparation is for another operation");
    if (
      generationId &&
      (value as { temporaryMaterial?: { generationId?: unknown } }).temporaryMaterial
        ?.generationId !== generationId
    )
      throw new Error("The location is for another generation");
    if (spec.materialKind) {
      const material = (
        value as import("@ai-job-apply/api-contracts").ApplicationTemporaryMaterialLocation
      ).temporaryMaterial;
      if (material.kind !== spec.materialKind || Date.now() >= materialDeadline(material))
        throw new Error("The material location is stale");
    }
    if (
      spec.echoesNestedApplicationId &&
      (value as { application?: { id?: unknown } }).application?.id !== applicationId
    ) {
      throw new Error("The response is for another application");
    }
    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    const correlationId = response.headers.get("x-correlation-id");
    if (correlationId) headers.set("x-correlation-id", correlationId);
    return new Response(JSON.stringify(value), { status: response.status, headers });
  } catch {
    return unavailable();
  }
}
