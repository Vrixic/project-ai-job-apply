import { describe, expect, it, vi } from "vitest";
import { nativeMaterialBaseHost, nativeMaterialContentRoute } from "./native-material-bff";

const APP = "019d04cf-1f80-7000-8000-000000000001";
const GEN = "019d04cf-1f80-7000-8000-000000000002";
const PACKET = "019d04cf-1f80-7000-8000-000000000003";
const ALLOCATION = "019d04cf-1f80-7000-8000-000000000004";
const PACKET_HASH = "b".repeat(64);
const CONTENT_HASH = "a".repeat(64);
const BASE_HOST = "materials.example.test";
const TOKEN = "synthetic-server-held-token";

const COMPLETED_AT_MS = Date.now() - 60_000;
function material(kind: "tailored_resume" | "cover_letter" = "tailored_resume") {
  const completedAtMs = COMPLETED_AT_MS;
  return {
    schemaVersion: 1,
    kind,
    generationId: GEN,
    version: 1,
    contentSha256: CONTENT_HASH,
    completedAtMs,
    expiresAtMs: completedAtMs + 1_800_000,
  };
}

function location(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    packetId: PACKET,
    packetHash: PACKET_HASH,
    temporaryMaterial: material(),
    origin: `https://${ALLOCATION}.${BASE_HOST}:8443`,
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    matchesPacket: true,
    tailoringVersion: "1",
    contentSha256: CONTENT_HASH,
    temporaryMaterial: material(),
    sections: [
      {
        kind: "experience",
        heading: "Experience",
        entries: [{ lines: ["Engineer"], bullets: [{ text: "Built things", change: "kept" }] }],
      },
    ],
    ...overrides,
  };
}

function file(overrides: Record<string, unknown> = {}) {
  return {
    format: "pdf",
    mediaType: "application/pdf",
    fileName: "tailored-resume.pdf",
    sha256: "c".repeat(64),
    sizeBytes: 4,
    contentSha256: CONTENT_HASH,
    contentBase64: "JVBERg==",
    temporaryMaterial: material(),
    ...overrides,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const nativeJson = (body: unknown, status = 200) =>
  json(body, status, { "cache-control": "no-store" });

interface Calls {
  platform: string[];
  native: Array<{ url: string; init: RequestInit | undefined }>;
}

function harness(options: {
  locations?: Array<Record<string, unknown> | Response>;
  native?: () => Response | Promise<Response>;
  signedIn?: boolean;
  tokenFails?: boolean;
}) {
  const calls: Calls = { platform: [], native: [] };
  const queue = [...(options.locations ?? [location(), location()])];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://localhost:4000")) {
      calls.platform.push(url);
      const next = queue.shift();
      if (next instanceof Response) return next;
      return json(next ?? location());
    }
    calls.native.push({ url, init });
    return options.native ? options.native() : nativeJson(preview());
  });
  const auth0 = {
    getSession: vi.fn(async () => (options.signedIn === false ? null : { user: {} })),
    getAccessToken: vi.fn(async () => {
      if (options.tokenFails) throw new Error("no token");
      return { token: TOKEN };
    }),
  };
  return {
    calls,
    auth0,
    run: (
      kind: "resume" | "cover-letter",
      query: string,
      params: Record<string, string | undefined> = { applicationId: APP },
    ) =>
      nativeMaterialContentRoute(
        kind,
        new Request(
          `http://localhost:3000/api/platform/applications/${APP}/${kind}/content${query}`,
        ),
        params,
        {
          auth0,
          baseUrl: "http://localhost:4000",
          fetch: fetch as unknown as typeof globalThis.fetch,
          baseHost: BASE_HOST,
        },
      ),
  };
}

const query = (format = "preview", extra = "") =>
  `?generationId=${GEN}&packetHash=${PACKET_HASH}&format=${format}${extra}`;

describe("generated material read through the authenticated BFF", () => {
  it("reads the resume preview with the server-held token and no browser credential", async () => {
    const { run, calls, auth0 } = harness({});
    const response = await run("resume", query());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "ready", contentSha256: CONTENT_HASH });
    // The scalar proof is read before and after the native read.
    expect(calls.platform).toHaveLength(2);
    expect(calls.platform[0]).toBe(
      `http://localhost:4000/v1/applications/${APP}/resume/location?generationId=${GEN}`,
    );
    expect(calls.native).toHaveLength(1);
    expect(calls.native[0]?.url).toBe(
      `https://${ALLOCATION}.${BASE_HOST}:8443/v1/applications/${APP}/resume`,
    );
    expect(calls.native[0]?.init).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(calls.native[0]?.init?.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(calls.native[0]?.init).not.toHaveProperty("credentials", "include");
    expect(auth0.getSession).toHaveBeenCalled();
  });

  it("reads only the PDF file, never DOCX", async () => {
    const { run, calls } = harness({ native: () => nativeJson(file()) });
    const ok = await run("resume", query("pdf"));
    expect(ok.status).toBe(200);
    expect(calls.native[0]?.url).toBe(
      `https://${ALLOCATION}.${BASE_HOST}:8443/v1/applications/${APP}/resume/file?format=pdf`,
    );
    const docx = await harness({}).run("resume", query("docx"));
    expect(docx.status).toBe(400);
    const wordFile = await harness({
      native: () =>
        nativeJson(
          file({
            format: "docx",
            mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ),
    }).run("resume", query("pdf"));
    expect(wordFile.status).toBe(503);
  });

  it("reads a cover letter through the same boundary", async () => {
    const cover = material("cover_letter");
    const { run, calls } = harness({
      locations: [location({ temporaryMaterial: cover }), location({ temporaryMaterial: cover })],
      native: () =>
        nativeJson({
          status: "ready",
          matchesPacket: true,
          contentSha256: CONTENT_HASH,
          temporaryMaterial: cover,
          documentId: ALLOCATION,
          version: 1,
          reviewRequired: true,
          paragraphs: [{ text: "Hello", factIds: [PACKET] }],
          model: {
            provider: "bedrock",
            model: "us.anthropic.claude-sonnet-4-6",
            version: "us.anthropic.claude-sonnet-4-6",
          },
          promptVersion: "1",
        }),
    });
    const response = await run("cover-letter", query());
    expect(response.status).toBe(200);
    expect(calls.native[0]?.url).toContain("/cover-letter");
  });

  it.each([
    ["unknown parameter", query("preview", "&extra=1")],
    ["missing packet hash", `?generationId=${GEN}&format=preview`],
    ["bad generation", `?generationId=nope&packetHash=${PACKET_HASH}&format=preview`],
    ["bad packet hash", `?generationId=${GEN}&packetHash=zz&format=preview`],
    ["bad format", query("zip")],
    ["repeated parameter", `${query()}&format=pdf`],
  ])("refuses %s before any upstream call", async (_name, search) => {
    const { run, calls, auth0 } = harness({});
    expect((await run("resume", search)).status).toBe(400);
    expect(calls.platform).toHaveLength(0);
    expect(calls.native).toHaveLength(0);
    expect(auth0.getAccessToken).not.toHaveBeenCalled();
  });

  it("refuses a malformed application id", async () => {
    const { run, calls } = harness({});
    expect((await run("resume", query(), { applicationId: "nope" })).status).toBe(400);
    expect(calls.platform).toHaveLength(0);
  });

  it("requires a signed-in session and a usable token, and sends nothing otherwise", async () => {
    const anonymous = harness({ signedIn: false });
    expect((await anonymous.run("resume", query())).status).toBe(401);
    expect(anonymous.calls.native).toHaveLength(0);
    const expired = harness({ tokenFails: true });
    const response = await expired.run("resume", query());
    expect([401, 503]).toContain(response.status);
    expect(expired.calls.native).toHaveLength(0);
  });

  it.each([
    ["another host", { origin: `https://${ALLOCATION}.evil.example.test:8443` }],
    ["another port", { origin: `https://${ALLOCATION}.${BASE_HOST}:443` }],
    ["a non-UUID allocation", { origin: `https://metadata.${BASE_HOST}:8443` }],
    ["another packet", { packetHash: "d".repeat(64) }],
    ["another generation", { temporaryMaterial: { ...material(), generationId: PACKET } }],
    ["another kind", { temporaryMaterial: material("cover_letter") }],
  ])("never sends the token when the location names %s", async (_name, change) => {
    const { run, calls } = harness({ locations: [location(change)] });
    const response = await run("resume", query());
    expect([409, 503]).toContain(response.status);
    expect(calls.native).toHaveLength(0);
  });

  it("returns the platform's own refusal for a stale or foreign packet", async () => {
    const { run, calls } = harness({
      locations: [
        json(
          {
            type: "urn:ai-job-apply:problem:application_packet_stale",
            title: "Packet is stale",
            status: 409,
            code: "application_packet_stale",
            traceId: "t",
          },
          409,
          { "content-type": "application/problem+json" },
        ),
      ],
    });
    const response = await run("resume", query());
    expect(response.status).toBe(409);
    expect(calls.native).toHaveLength(0);
  });

  it("fails closed when the native process refuses the owner", async () => {
    const { run } = harness({
      native: () => nativeJson({ code: "temporary_material_unavailable" }, 403),
    });
    const response = await run("resume", query());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("temporary_material_unavailable");
  });

  it.each([
    ["a server error", () => nativeJson({}, 500)],
    ["a cacheable response", () => json(preview())],
    [
      "the wrong content type",
      () => new Response("x", { status: 200, headers: { "cache-control": "no-store" } }),
    ],
    ["an invalid body", () => nativeJson({ status: "ready" })],
    ["another content hash", () => nativeJson(preview({ contentSha256: "d".repeat(64) }))],
    [
      "another generation",
      () => nativeJson(preview({ temporaryMaterial: { ...material(), generationId: PACKET } })),
    ],
    ["a packet mismatch", () => nativeJson(preview({ matchesPacket: false }))],
    [
      "a not-ready status",
      () => nativeJson(preview({ status: "unavailable", unavailableReason: "render_failed" })),
    ],
    ["an oversized body", () => nativeJson({ ...preview(), padding: "x".repeat(600 * 1024) })],
  ])("refuses %s with a fixed, value-free problem", async (_name, native) => {
    const { run } = harness({ native });
    const response = await run("resume", query());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(CONTENT_HASH);
    expect(text).not.toContain("Built things");
  });

  it("refuses when the scalar proof changed during the read", async () => {
    const changed = location({ temporaryMaterial: { ...material(), version: 2 } });
    const { run } = harness({ locations: [location(), changed] });
    expect((await run("resume", query())).status).toBe(503);
  });

  it("is unavailable until the native base host is configured", async () => {
    expect(nativeMaterialBaseHost({})).toBeUndefined();
    expect(nativeMaterialBaseHost({ NATIVE_MATERIAL_BASE_HOST: "not a host" })).toBeUndefined();
    expect(nativeMaterialBaseHost({ NATIVE_MATERIAL_BASE_HOST: BASE_HOST })).toBe(BASE_HOST);
    const calls: string[] = [];
    const response = await nativeMaterialContentRoute(
      "resume",
      new Request(`http://localhost:3000/x${query()}`),
      { applicationId: APP },
      {
        baseHost: "",
        fetch: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return json({});
        }) as typeof fetch,
      },
    );
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
