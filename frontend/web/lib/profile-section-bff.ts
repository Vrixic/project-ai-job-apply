import { getLazyAuth0Session } from "./auth0";
import { readBoundedRequestBody } from "./bounded-request-body";
import {
  type FoundationResponseSchemaName,
  validateFoundationResponse,
} from "./foundation-response-bff";
import { type FoundationWriteSchemaName, readFoundationWriteRequest } from "./foundation-write-bff";
import { forwardPlatformRequest } from "./platform-api";

/**
 * Candidate BFF for the structured Profile (ADR-052). Only the fixed sections below are
 * reachable, identifiers and the delete version are validated before anything is forwarded, every
 * body is checked against its contract, and responses are checked against theirs.
 */

export type ProfileSectionPath =
  | "education-entries"
  | "work-experience-entries"
  | "skill-entries"
  | "application-answers";

interface SectionSpec {
  create: FoundationWriteSchemaName;
  update: FoundationWriteSchemaName;
  record: FoundationResponseSchemaName;
  collection: FoundationResponseSchemaName;
  reorderable: boolean;
}

const SECTIONS: Readonly<Record<ProfileSectionPath, SectionSpec>> = {
  "education-entries": {
    create: "CreateProfileEducationEntryRequest",
    update: "UpdateProfileEducationEntryRequest",
    record: "ProfileEducationEntry",
    collection: "ProfileEducationEntryCollection",
    reorderable: true,
  },
  "work-experience-entries": {
    create: "CreateProfileWorkExperienceEntryRequest",
    update: "UpdateProfileWorkExperienceEntryRequest",
    record: "ProfileWorkExperienceEntry",
    collection: "ProfileWorkExperienceEntryCollection",
    reorderable: true,
  },
  "skill-entries": {
    create: "CreateProfileSkillEntryRequest",
    update: "UpdateProfileSkillEntryRequest",
    record: "ProfileSkillEntry",
    collection: "ProfileSkillEntryCollection",
    reorderable: true,
  },
  "application-answers": {
    create: "CreateProfileApplicationAnswerRequest",
    update: "UpdateProfileApplicationAnswerRequest",
    record: "ProfileApplicationAnswer",
    collection: "ProfileApplicationAnswerCollection",
    reorderable: false,
  },
};

const IMPORT_DRAFTS = "import-drafts";
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_VERSION = /^[1-9][0-9]{0,8}$/;

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
  if (!request?.body) return;
  try {
    void request.body.cancel().catch(() => undefined);
  } catch {
    // A hostile or locked body must not replace the fixed boundary response.
  }
}

function invalid(request?: Request): Response {
  cancelRequestBody(request);
  return problem(400, "invalid_request", "Invalid request");
}

function notFound(request?: Request): Response {
  cancelRequestBody(request);
  return problem(404, "not_found", "Not found");
}

function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A hostile or locked body must not replace the fixed boundary response.
  }
}

function dependencies() {
  return {
    auth0: getLazyAuth0Session(),
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
    fetch,
  };
}

export function profileSection(value: string): ProfileSectionPath | undefined {
  return Object.hasOwn(SECTIONS, value) ? (value as ProfileSectionPath) : undefined;
}

export function isImportDrafts(value: string): boolean {
  return value === IMPORT_DRAFTS;
}

async function forwardRead(
  path: string,
  expectedStatus: number,
  schema: FoundationResponseSchemaName,
  request?: Request,
): Promise<Response> {
  const response = await forwardPlatformRequest(path, { method: "GET" }, dependencies());
  return validateFoundationResponse(response, expectedStatus, schema, request?.signal);
}

async function forwardWrite(
  request: Request,
  method: "POST" | "PUT" | "PATCH",
  path: string,
  requestSchema: FoundationWriteSchemaName,
  expectedStatus: number,
  responseSchema: FoundationResponseSchemaName,
): Promise<Response> {
  const decoded = await readFoundationWriteRequest(request, requestSchema);
  if ("failure" in decoded) return decoded.failure;
  const response = await forwardPlatformRequest(
    path,
    {
      method,
      body: decoded.body,
      signal: request.signal,
      headers: { "content-type": "application/json", "idempotency-key": decoded.idempotencyKey },
    },
    dependencies(),
  );
  return validateFoundationResponse(response, expectedStatus, responseSchema, request.signal);
}

async function forwardDelete(request: Request, path: string): Promise<Response> {
  const declaredLength = request.headers.get("content-length");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    request.signal.aborted ||
    (declaredLength !== null && declaredLength !== "0") ||
    request.headers.get("transfer-encoding") !== null ||
    request.headers.get("content-type") !== null ||
    idempotencyKey === null ||
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 128
  ) {
    return invalid(request);
  }
  // Next's Node adapter exposes a stream even for bodyless DELETE requests.
  if (request.body) {
    try {
      const bytes = await readBoundedRequestBody(request, {
        maximumBytes: 1,
        timeoutMilliseconds: 2_000,
      });
      if (bytes.byteLength !== 0) return invalid();
    } catch {
      return invalid();
    }
  }
  const response = await forwardPlatformRequest(
    path,
    { method: "DELETE", signal: request.signal, headers: { "idempotency-key": idempotencyKey } },
    dependencies(),
  );
  if (!response.ok) return response;
  if (response.status !== 204) {
    cancelBody(response);
    return problem(503, "platform_unavailable", "The platform API is unavailable");
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export const getPersonal = (request?: Request) =>
  forwardRead("/v1/profile/personal", 200, "ProfilePersonal", request);

export const putPersonal = (request: Request) =>
  forwardWrite(
    request,
    "PUT",
    "/v1/profile/personal",
    "PutProfilePersonalRequest",
    200,
    "ProfilePersonal",
  );

export async function listSection(section: string, request?: Request): Promise<Response> {
  if (isImportDrafts(section)) {
    return forwardRead("/v1/profile/import-drafts", 200, "ProfileImportDraftCollection", request);
  }
  const path = profileSection(section);
  if (!path) return notFound(request);
  return forwardRead(`/v1/profile/${path}`, 200, SECTIONS[path].collection, request);
}

export async function createEntry(request: Request, section: string): Promise<Response> {
  const path = profileSection(section);
  if (!path) return notFound(request);
  return forwardWrite(
    request,
    "POST",
    `/v1/profile/${path}`,
    SECTIONS[path].create,
    201,
    SECTIONS[path].record,
  );
}

export async function reorderEntries(request: Request, section: string): Promise<Response> {
  const path = profileSection(section);
  if (!path || !SECTIONS[path].reorderable) return notFound(request);
  return forwardWrite(
    request,
    "POST",
    `/v1/profile/${path}/reorder`,
    "ReorderProfileEntriesRequest",
    200,
    SECTIONS[path].collection,
  );
}

export async function updateEntry(
  request: Request,
  section: string,
  recordId: string,
): Promise<Response> {
  const path = profileSection(section);
  if (!path) return notFound(request);
  if (!RECORD_ID.test(recordId)) return invalid(request);
  return forwardWrite(
    request,
    "PATCH",
    `/v1/profile/${path}/${encodeURIComponent(recordId)}`,
    SECTIONS[path].update,
    200,
    SECTIONS[path].record,
  );
}

export async function deleteRecord(
  request: Request,
  section: string,
  recordId: string,
): Promise<Response> {
  if (!RECORD_ID.test(recordId)) return invalid(request);
  if (isImportDrafts(section)) {
    if ([...new URL(request.url).searchParams].length !== 0) return invalid(request);
    return forwardDelete(request, `/v1/profile/import-drafts/${encodeURIComponent(recordId)}`);
  }
  const path = profileSection(section);
  if (!path) return notFound(request);
  const query = [...new URL(request.url).searchParams.entries()];
  const [name, value] = query[0] ?? [];
  if (query.length !== 1 || name !== "expectedVersion" || !EXPECTED_VERSION.test(value ?? "")) {
    return invalid(request);
  }
  return forwardDelete(
    request,
    `/v1/profile/${path}/${encodeURIComponent(recordId)}?expectedVersion=${value}`,
  );
}

export async function saveDraft(
  request: Request,
  section: string,
  recordId: string,
): Promise<Response> {
  if (!isImportDrafts(section)) return notFound(request);
  if (!RECORD_ID.test(recordId)) return invalid(request);
  return forwardWrite(
    request,
    "POST",
    `/v1/profile/import-drafts/${encodeURIComponent(recordId)}/save`,
    "SaveProfileImportDraftRequest",
    201,
    "ProfileEntryReference",
  );
}
