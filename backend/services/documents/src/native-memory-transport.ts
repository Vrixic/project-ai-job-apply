import { createServer, type ServerOptions } from "node:https";
import { isMainThread } from "node:worker_threads";
import { bearerToken, createOidcVerifier, type AccessTokenVerifier } from "@ai-job-apply/auth";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import type { createNativeMemorySession } from "./native-memory-session.js";
import type { TemporaryCoverLetterResponse } from "./temporary-cover-letter.js";
import {
  sameTemporaryMaterialReference,
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

type Session = ReturnType<typeof createNativeMemorySession>;
type Content =
  | Awaited<ReturnType<Session["reader"]["coverLetterPreview"]>>["value"]
  | Awaited<ReturnType<Session["reader"]["coverLetterFile"]>>["value"];

/** Scalar owning Applications proof. The authenticated private adapter has no generated body.
 * Its remote authentication/transport remains a separate composition gate. */
export interface NativeMaterialReadAuthorization {
  schemaVersion: 1;
  packetId: string;
  packetHash: string;
  reference: TemporaryMaterialReference;
}

export interface NativeMemoryTransportOptions {
  session: Session;
  reference: TemporaryMaterialReference;
  /** Exact identity mapped to reference.ownerUserId by trusted private launch admission. */
  identity: { issuer: string; audience: string; subject: string };
  host: string;
  /** One approved candidate-client origin; no cookies or wildcard credential forwarding. */
  origin: string;
  tls: Pick<ServerOptions, "key" | "cert">;
  authorize(
    ownerUserId: string,
    applicationId: string,
    reference: Readonly<TemporaryMaterialReference>,
    signal: AbortSignal,
    /** The current verified request token, memory only; metadata control plane re-verifies it. */
    accessToken: string,
  ): Promise<NativeMaterialReadAuthorization | null>;
  enabled?: () => boolean;
  /** Synthetic verifier only; rejected outside NODE_ENV=test. Production always verifies OIDC. */
  testVerifier?: AccessTokenVerifier;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
const validPreview = compileComponentValidator("ApplicationCoverLetterPreview");
const validFile = compileComponentValidator("ApplicationCoverLetterFile");
const maximumResponseBytes = 512 * 1024;
class ReadDenied extends Error {
  constructor(readonly status: number) {
    super("NativeMemoryTransportUnavailable");
  }
}

/** Dedicated native process only; does not listen until its trusted launcher explicitly binds it.
 * No generation, SQL, persistence, disposal acknowledgement or Lambda content forwarding route. */
export function createNativeMemoryTransport(options: NativeMemoryTransportOptions) {
  const enabled = options.enabled ?? (() => false);
  if (!enabled()) throw Error("NativeMemoryTransportUnavailable");
  if (
    process.platform !== "linux" ||
    !isMainThread ||
    !validateTemporaryMaterialReference(options.reference) ||
    options.reference.kind !== "cover_letter" ||
    !options.tls.key ||
    !options.tls.cert ||
    !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/u.test(options.host) ||
    !options.identity.subject ||
    options.identity.subject.length > 512 ||
    !options.identity.audience ||
    options.identity.audience.length > 512 ||
    (options.testVerifier && process.env.NODE_ENV !== "test")
  )
    throw Error("NativeMemoryTransportUnavailable");
  const issuer = new URL(options.identity.issuer);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  )
    throw Error("NativeMemoryTransportUnavailable");
  const origin = new URL(options.origin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== options.origin ||
    origin.username ||
    origin.password
  )
    throw Error("NativeMemoryTransportUnavailable");
  const identity = Object.freeze({ ...options.identity });
  const reference = Object.freeze({ ...options.reference });
  const host = options.host;
  const session = options.session;
  const authorize = options.authorize;
  const verifier =
    options.testVerifier ?? createOidcVerifier({ ...identity, requireExpiration: true });
  const base = `/v1/applications/${reference.applicationId}/cover-letter`;
  let active = false;
  const server = createServer(
    {
      key: options.tls.key,
      cert: options.tls.cert,
      minVersion: "TLSv1.3",
      maxHeaderSize: 8192,
      handshakeTimeout: 5000,
    },
    (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Connection", "close");
      const error = (status: number) => {
        if (!response.destroyed && !response.headersSent) {
          response.statusCode = status;
          response.end('{"code":"temporary_material_unavailable"}');
        } else response.destroy();
      };
      // Reject duplicate credential/framing headers, bodies, encoded paths and extra query fields.
      const headerNames = request.rawHeaders
        .filter((_v, index) => index % 2 === 0)
        .map((v) => v.toLowerCase());
      const format =
        request.url === `${base}/file?format=pdf`
          ? "pdf"
          : request.url === `${base}/file?format=docx`
            ? "docx"
            : undefined;
      if (
        (request.method !== "GET" && request.method !== "OPTIONS") ||
        request.headers.host !== host ||
        headerNames.filter((v) => v === "authorization").length > 1 ||
        headerNames.filter((v) => v === "host").length !== 1 ||
        headerNames.filter((v) => v === "origin").length > 1 ||
        (request.headers.origin !== undefined && request.headers.origin !== origin.origin) ||
        request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0") ||
        (request.url !== base && !format)
      ) {
        error(400);
        return;
      }
      if (request.headers.origin === origin.origin) {
        response.setHeader("Access-Control-Allow-Origin", origin.origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        if (
          !enabled() ||
          request.headers.origin !== origin.origin ||
          request.headers["access-control-request-method"] !== "GET" ||
          request.headers["access-control-request-headers"]?.toString().toLowerCase() !==
            "authorization"
        ) {
          error(400);
          return;
        }
        response.setHeader("Access-Control-Allow-Methods", "GET");
        response.setHeader("Access-Control-Allow-Headers", "Authorization");
        response.statusCode = 204;
        response.end();
        return;
      }
      if (active || !enabled()) {
        error(503);
        return;
      }
      active = true;
      const controller = new AbortController();
      let result: TemporaryCoverLetterResponse<Content> | undefined;
      let bytes: Buffer | undefined;
      let finished = false;
      const release = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        controller.abort();
        bytes?.fill(0);
        result?.signal.removeEventListener("abort", aborted);
        result?.release();
      };
      const aborted = () => {
        response.destroy();
        release();
      };
      const timeout = setTimeout(aborted, 10_000);
      timeout.unref();
      request.once("aborted", aborted);
      request.once("error", aborted);
      response.once("close", release);
      response.once("finish", release);
      response.once("error", aborted);
      const live = () =>
        !finished &&
        !controller.signal.aborted &&
        enabled() &&
        Date.now() < reference.expiresAtMs &&
        !response.destroyed;
      const proof = async () => {
        const value = await authorize(
          reference.ownerUserId,
          reference.applicationId,
          reference,
          controller.signal,
          bearerToken(request.headers.authorization),
        );
        if (
          !live() ||
          !value ||
          Object.keys(value).sort().join(",") !== "packetHash,packetId,reference,schemaVersion" ||
          value.schemaVersion !== 1 ||
          !uuid.test(value.packetId) ||
          !hash.test(value.packetHash) ||
          !validateTemporaryMaterialReference(value.reference) ||
          !sameTemporaryMaterialReference(reference, value.reference)
        )
          throw new ReadDenied(409);
        return { packetId: value.packetId, packetHash: value.packetHash };
      };
      const authenticate = async () => {
        const principal = await verifier.verify(bearerToken(request.headers.authorization));
        if (
          !live() ||
          principal.issuer !== identity.issuer ||
          principal.subject !== identity.subject ||
          !principal.audience.includes(identity.audience) ||
          !principal.scopes.includes("applications:read")
        )
          throw new ReadDenied(403);
      };
      const run = async () => {
        let status = 401;
        try {
          await authenticate();
          status = 503;
          const before = await proof();
          status = 503;
          result = format
            ? await session.reader.coverLetterFile(
                reference.ownerUserId,
                reference.applicationId,
                reference,
                format,
                controller.signal,
              )
            : await session.reader.coverLetterPreview(
                reference.ownerUserId,
                reference.applicationId,
                reference,
                controller.signal,
              );
          result.signal.addEventListener("abort", aborted, { once: true });
          if (
            !live() ||
            result.signal.aborted ||
            !result.isCurrent() ||
            !validateTemporaryMaterialReference(result.reference) ||
            !sameTemporaryMaterialReference(reference, result.reference)
          )
            throw Error("ReadUnavailable");
          const value = result.value;
          if (
            "temporaryMaterial" in value ||
            !("contentSha256" in value) ||
            value.contentSha256 !== reference.contentSha256 ||
            (format
              ? !validFile(value) || !("format" in value) || value.format !== format
              : !validPreview(value) ||
                !("paragraphs" in value) ||
                value.documentId !== reference.generationId ||
                value.version !== reference.version ||
                !value.matchesPacket)
          )
            throw Error("ReadUnavailable");
          status = 503;
          if (!(await result.revalidate())) throw new ReadDenied(409);
          const after = await proof();
          if (after.packetId !== before.packetId || after.packetHash !== before.packetHash)
            throw new ReadDenied(409);
          status = 401;
          await authenticate();
          status = 503;
          const { ownerUserId: _owner, applicationId: _application, ...metadata } = reference;
          bytes = Buffer.from(JSON.stringify({ ...value, temporaryMaterial: metadata }), "utf8");
          if (
            bytes.byteLength > maximumResponseBytes ||
            !live() ||
            result.signal.aborted ||
            !result.isCurrent()
          )
            throw Error("ReadUnavailable");
          response.setHeader("Content-Length", bytes.byteLength);
          response.end(bytes);
        } catch (failure) {
          error(failure instanceof ReadDenied ? failure.status : status);
          release();
        } finally {
          // A timeout cannot free admission while the actual owner/render promise is unresolved.
          if (finished) {
            result?.signal.removeEventListener("abort", aborted);
            result?.release();
          }
          if (finished) active = false;
        }
      };
      // Admission is retained through transport completion as well as real asynchronous settlement.
      let settled = false;
      const completed = () => {
        if (settled) active = false;
      };
      response.once("close", completed);
      response.once("finish", completed);
      void run().finally(() => {
        settled = true;
        if (finished) active = false;
      });
    },
  );
  server.maxConnections = 8;
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1;
  server.on("tlsClientError", () => {});
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("checkContinue", (request) => request.socket.destroy());
  server.on("checkExpectation", (request) => request.socket.destroy());
  return server;
}
