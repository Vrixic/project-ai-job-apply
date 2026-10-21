import {
  type ApplicationCoverLetterFile,
  type ApplicationCoverLetterPreview,
  type ApplicationResumeFile,
  type ApplicationResumePreview,
  type ApplicationTemporaryMaterialLocation,
  compileComponentValidator,
} from "@ai-job-apply/api-contracts";
import { sameMaterial } from "./application-material-lifetime";
import { applicationsRoute } from "./applications-bff";
import { getLazyAuth0Session } from "./auth0";

/**
 * Same-origin read of one generated material from its dedicated native process, performed by the
 * server with the signed-in candidate's own server-held access token. This replaces a second,
 * browser-held sign-in: the browser never receives a credential, and the native process still
 * authorizes every read itself (exact issuer, audience, scope, expiry and owner), so a refused or
 * mismatched read fails closed here exactly as it did in the browser.
 *
 * The route is bound to one application, one generation and one packet hash. The scalar location
 * proof is checked before and after the read, the closed response schema, original material
 * identity and content hash are verified, and the body is bounded and never cached or logged.
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const DNS = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
const MAXIMUM_BYTES = 512 * 1024;
const READ_DEADLINE_MS = 15_000;

export type NativeMaterialKind = "resume" | "cover-letter";
export type NativeMaterialFormat = "preview" | "pdf";

export interface NativeMaterialRouteDependencies {
  auth0?: ReturnType<typeof getLazyAuth0Session>;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  baseHost?: string;
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

/** The only configuration: the DNS base host the dedicated native allocations live under. */
export function nativeMaterialBaseHost(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = environment.NATIVE_MATERIAL_BASE_HOST ?? "";
  return DNS.test(value) ? value : undefined;
}

class Unavailable extends Error {}

async function readBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  if (
    response.status !== 200 ||
    response.headers.get("cache-control") !== "no-store" ||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
      response.headers.get("content-type") ?? "",
    ) ||
    !response.body
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new Unavailable();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Unavailable();
      if (done) break;
      size += value.byteLength;
      if (size > MAXIMUM_BYTES) throw new Unavailable();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    void reader.cancel().catch(() => undefined);
  }
}

function schemaFor(kind: NativeMaterialKind, format: NativeMaterialFormat) {
  if (kind === "resume")
    return format === "preview" ? "ApplicationResumePreview" : "ApplicationResumeFile";
  return format === "preview" ? "ApplicationCoverLetterPreview" : "ApplicationCoverLetterFile";
}

export async function nativeMaterialContentRoute(
  kind: NativeMaterialKind,
  request: Request,
  params: Readonly<Record<string, string | undefined>>,
  dependencies: NativeMaterialRouteDependencies = {},
): Promise<Response> {
  const applicationId = params.applicationId ?? "";
  const query = [...new URL(request.url).searchParams];
  const entries = new Map(query);
  const generationId = entries.get("generationId") ?? "";
  const packetHash = entries.get("packetHash") ?? "";
  const format = entries.get("format") ?? "";
  if (
    !UUID_V7.test(applicationId) ||
    query.length !== 3 ||
    entries.size !== 3 ||
    !UUID_V7.test(generationId) ||
    !HASH.test(packetHash) ||
    (format !== "preview" && format !== "pdf")
  )
    return invalid();
  const baseHost = dependencies.baseHost ?? nativeMaterialBaseHost();
  if (!baseHost) return unavailable();

  const auth0 = dependencies.auth0 ?? getLazyAuth0Session();
  const send = dependencies.fetch ?? fetch;
  const routeDependencies = {
    auth0,
    ...(dependencies.baseUrl ? { baseUrl: dependencies.baseUrl } : {}),
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
  };

  const deadline = AbortSignal.timeout(READ_DEADLINE_MS);
  const signal = AbortSignal.any([request.signal, deadline]);

  const location = async (): Promise<ApplicationTemporaryMaterialLocation | Response> => {
    const response = await applicationsRoute(
      kind === "resume" ? "resumeLocation" : "coverLetterLocation",
      new Request(
        new URL(
          `/api/platform/applications/${applicationId}/${kind}/location?generationId=${generationId}`,
          request.url,
        ),
        { method: "GET", signal },
      ),
      { applicationId },
      routeDependencies,
    );
    if (!response.ok) return response;
    const value: unknown = await response.json().catch(() => undefined);
    if (!compileComponentValidator("ApplicationTemporaryMaterialLocation")(value))
      throw new Unavailable();
    const result = value as ApplicationTemporaryMaterialLocation;
    const origin = new URL(result.origin);
    const host = origin.hostname;
    const allocation = host.slice(0, -(baseHost.length + 1));
    if (
      origin.origin !== result.origin ||
      origin.protocol !== "https:" ||
      origin.port !== "8443" ||
      origin.username ||
      origin.password ||
      host !== `${allocation}.${baseHost}` ||
      !UUID.test(allocation) ||
      result.packetHash !== packetHash ||
      result.temporaryMaterial.generationId !== generationId ||
      result.temporaryMaterial.kind !== (kind === "resume" ? "tailored_resume" : "cover_letter")
    )
      throw new Unavailable();
    return result;
  };

  try {
    const before = await location();
    if (before instanceof Response) return before;

    let token: string;
    try {
      ({ token } = await auth0.getAccessToken());
    } catch {
      return problem(401, "session_expired", "The session has expired");
    }

    const url = new URL(
      `/v1/applications/${applicationId}/${kind}${format === "preview" ? "" : "/file?format=pdf"}`,
      before.origin,
    );
    const response = await send(url.href, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    // Only the native process's own verdict about this owner and material is trusted.
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => undefined);
      return problem(403, "forbidden", "Forbidden");
    }
    const value = await readBounded(response, signal);
    if (!compileComponentValidator(schemaFor(kind, format))(value)) throw new Unavailable();
    const result = value as
      | ApplicationResumePreview
      | ApplicationResumeFile
      | ApplicationCoverLetterPreview
      | ApplicationCoverLetterFile;
    if (
      !("temporaryMaterial" in result) ||
      !sameMaterial(result.temporaryMaterial, before.temporaryMaterial) ||
      !("contentSha256" in result) ||
      result.contentSha256 !== before.temporaryMaterial.contentSha256 ||
      ("status" in result && (result.status !== "ready" || !result.matchesPacket)) ||
      ("format" in result && (result.format !== "pdf" || result.mediaType !== "application/pdf"))
    )
      throw new Unavailable();

    const after = await location();
    if (after instanceof Response) return after;
    if (JSON.stringify(after) !== JSON.stringify(before) || signal.aborted) throw new Unavailable();
    return Response.json(result, {
      status: 200,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return unavailable();
  }
}
