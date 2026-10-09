import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { compileComponentValidator } from "../../packages/api-contracts/dist/src/index.js";
import { NATIVE_RESUME_SESSION_PROFILE } from "./candidate-rights-session.mjs";

// This operator is deliberately bound to the reviewed development deployment. It must
// never become an arbitrary URL transport for a candidate's bearer token.
export const NATIVE_DEVELOPMENT_API = "https://lemwm7dvi4.execute-api.us-east-2.amazonaws.com";
const nativeOrigin =
  /^https:\/\/[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.materials\.dev\.applydash\.ai:8443$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const validators = new Map();
function validate(name, value) {
  if (!validators.has(name)) validators.set(name, compileComponentValidator(name));
  if (!validators.get(name)(value)) throw new Error("invalid_native_response");
  return value;
}
function withdrawalId() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] & 15) | 112;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseNativeResumeCommand(line) {
  if (typeof line !== "string" || Buffer.byteLength(line) > 512)
    throw new Error("invalid_native_command");
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_native_command");
  const keys = Object.keys(value).sort().join(",");
  if (
    keys === "action" &&
    ["inspect", "preview", "download", "withdraw", "withdrawal", "cancel"].includes(value.action)
  )
    return value;
  if (
    keys === "action,jobId" &&
    value.action === "prepare" &&
    typeof value.jobId === "string" &&
    uuid.test(value.jobId)
  )
    return value;
  throw new Error("invalid_native_command");
}

// identity comes only from startNativeResumeSession's signature-verified PKCE/MFA
// callback. Purpose markers are an additional guard, not an authentication verifier.
export function createNativeResumeSessionOperator({ identity, fetch: suppliedFetch }) {
  if (suppliedFetch && process.env.NODE_ENV !== "test") throw new Error("test_transport_only");
  if (
    identity?.purpose !== "native_resume_workload" ||
    identity.profile !== NATIVE_RESUME_SESSION_PROFILE ||
    typeof identity.accessToken !== "string" ||
    !identity.accessToken ||
    identity.refreshToken ||
    typeof identity.authorizedOwner !== "string" ||
    !identity.authorizedOwner.trim() ||
    !Number.isFinite(Date.parse(identity.expiresAt)) ||
    Date.parse(identity.expiresAt) <= Date.now()
  )
    throw new Error("native_identity_required");
  const transport = suppliedFetch ?? globalThis.fetch;
  const expiresAt = Math.min(Date.parse(identity.expiresAt), Date.now() + 20 * 60_000);
  let token = identity.accessToken;
  let busy = false;
  let closed = false;
  let selectedJob;
  let application;
  let preparationBody;
  let prepared = false;
  let originalLocation;
  let recoveryRequired = false;
  let withdrawalStarted = false;
  const createKey = randomUUID();
  const prepareKey = randomUUID();
  const requestId = withdrawalId();

  async function request(path, method, body, schema, status, key, origin = NATIVE_DEVELOPMENT_API) {
    if (closed || Date.now() >= expiresAt) throw new Error("native_session_expired");
    if (origin !== NATIVE_DEVELOPMENT_API && !nativeOrigin.test(origin))
      throw new Error("native_origin_rejected");
    const response = await transport(`${origin}/v1${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (
      response.status !== status ||
      ((origin !== NATIVE_DEVELOPMENT_API || schema === "ApplicationTemporaryMaterialLocation") &&
        response.headers.get("cache-control") !== "no-store") ||
      !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "")
    ) {
      await response.body?.cancel();
      throw new Error("native_request_failed");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("invalid_native_response");
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error("native_response_too_large");
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      try {
        return validate(schema, JSON.parse(bytes.toString("utf8")));
      } finally {
        bytes.fill(0);
      }
    } finally {
      for (const chunk of chunks) chunk.fill(0);
      await reader.cancel();
    }
  }

  async function locate() {
    const current = await request(
      `/applications/${application.id}`,
      "GET",
      undefined,
      "Application",
      200,
    );
    if (
      current.id !== application.id ||
      current.canonicalJobId !== selectedJob ||
      !current.currentPacket ||
      current.revision < application.revision ||
      current.currentPacket.jobRevision !== application.currentPacket.jobRevision
    )
      throw new Error("native_application_mismatch");
    const material = current.currentPacket.temporaryMaterials?.find(
      (value) => value.kind === "tailored_resume",
    );
    if (!material) return null;
    if (
      material.completedAtMs > Date.now() ||
      material.expiresAtMs <= Date.now() ||
      current.currentPacket.artifactHashes.resume !== material.contentSha256 ||
      material.expiresAtMs - material.completedAtMs !== 1_800_000
    )
      throw new Error("native_material_expired_or_invalid");
    const location = await request(
      `/applications/${application.id}/resume/location?generationId=${material.generationId}`,
      "GET",
      undefined,
      "ApplicationTemporaryMaterialLocation",
      200,
    );
    if (
      !nativeOrigin.test(location.origin) ||
      location.packetId !== current.currentPacket.id ||
      location.packetHash !== current.currentPacket.packetHash ||
      !isDeepStrictEqual(location.temporaryMaterial, material)
    )
      throw new Error("native_location_mismatch");
    // Native completion writes a new packet. Bind to its first verified reference,
    // then refuse regeneration or sliding expiry during subsequent reads.
    if (originalLocation && !isDeepStrictEqual(originalLocation, location))
      throw new Error("native_generation_changed");
    originalLocation ??= location;
    return location;
  }

  function checkMaterial(result, location) {
    if (
      !isDeepStrictEqual(result.temporaryMaterial, location.temporaryMaterial) ||
      result.contentSha256 !== location.temporaryMaterial.contentSha256 ||
      location.temporaryMaterial.expiresAtMs <= Date.now()
    )
      throw new Error("native_material_mismatch");
  }

  return {
    get expiresAt() {
      return expiresAt;
    },
    close() {
      if (busy) return { outcome: "native-session-busy" };
      closed = true;
      token = undefined;
      application = undefined;
      preparationBody = undefined;
      originalLocation = undefined;
      return {
        outcome: "native-session-closed",
        recoveryRequired,
        ...(recoveryRequired ? { withdrawalRequestId: requestId } : {}),
      };
    },
    async execute(input) {
      const command = parseNativeResumeCommand(JSON.stringify(input));
      if (busy || closed) throw new Error("native_session_unavailable");
      if (command.action === "cancel") return this.close();
      busy = true;
      try {
        if (command.action === "inspect") {
          const resumes = await request(
            "/resumes",
            "GET",
            undefined,
            "ResumeDocumentCollection",
            200,
          );
          const jobs = await request("/jobs/search", "POST", { pageSize: 5 }, "JobSearchPage", 200);
          return {
            outcome: "native-prerequisites-read",
            resumeCount: resumes.documents.length,
            jobIds: jobs.items.map((job) => job.id),
          };
        }
        if (command.action === "prepare") {
          if (withdrawalStarted || (selectedJob && selectedJob !== command.jobId))
            throw new Error("native_single_application_only");
          selectedJob = command.jobId;
          recoveryRequired = true;
          if (!application)
            application = await request(
              "/applications",
              "POST",
              { jobId: selectedJob },
              "Application",
              201,
              createKey,
            );
          if (application.canonicalJobId !== selectedJob)
            throw new Error("native_application_mismatch");
          if (!prepared) {
            preparationBody ??= { expectedRevision: application.revision };
            const result = await request(
              `/applications/${application.id}/packets`,
              "POST",
              preparationBody,
              "Application",
              201,
              prepareKey,
            );
            if (
              result.id !== application.id ||
              result.canonicalJobId !== selectedJob ||
              !result.currentPacket ||
              result.revision <= preparationBody.expectedRevision
            )
              throw new Error("native_application_mismatch");
            application = result;
            prepared = true;
          }
          return { outcome: "native-packet-prepared", revision: application.revision };
        }
        if (command.action === "preview" || command.action === "download") {
          if (!prepared || withdrawalStarted) throw new Error("native_preparation_required");
          const location = await locate();
          if (!location) return { outcome: "native-generation-not-ready" };
          if (command.action === "download") {
            const files = [];
            for (const format of ["pdf", "docx"]) {
              const result = await request(
                `/applications/${application.id}/resume/file?format=${format}`,
                "GET",
                undefined,
                "ApplicationResumeFile",
                200,
                undefined,
                location.origin,
              );
              const bytes = Buffer.from(result.contentBase64, "base64");
              try {
                checkMaterial(result, location);
                const mediaType =
                  format === "pdf"
                    ? "application/pdf"
                    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                const magic =
                  format === "pdf"
                    ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
                    : bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
                if (
                  result.format !== format ||
                  result.mediaType !== mediaType ||
                  !magic ||
                  result.sizeBytes !== bytes.length ||
                  bytes.toString("base64") !== result.contentBase64 ||
                  createHash("sha256").update(bytes).digest("hex") !== result.sha256
                )
                  throw new Error("native_file_mismatch");
                files.push({ format, sizeBytes: bytes.length, sha256: result.sha256 });
              } finally {
                bytes.fill(0);
                result.contentBase64 = "";
              }
            }
            return { outcome: "native-resume-files-verified", files, filesSaved: false };
          }
          const result = await request(
            `/applications/${application.id}/resume`,
            "GET",
            undefined,
            "ApplicationResumePreview",
            200,
            undefined,
            location.origin,
          );
          checkMaterial(result, location);
          if (result.status !== "ready" || !result.matchesPacket)
            throw new Error("native_preview_unavailable");
          return {
            outcome: "native-resume-preview-read",
            status: result.status,
            matchesPacket: result.matchesPacket,
            nativeMaterialPresent: result.temporaryMaterial?.kind === "tailored_resume",
          };
        }
        if (command.action === "withdraw" || command.action === "withdrawal") {
          if (command.action === "withdrawal" && !withdrawalStarted)
            throw new Error("native_withdrawal_required");
          withdrawalStarted = true;
          recoveryRequired = true;
          const result = await request(
            `/material-withdrawals/${requestId}`,
            command.action === "withdraw" ? "PUT" : "GET",
            undefined,
            "NativeMaterialWithdrawal",
            command.action === "withdraw" ? 202 : 200,
          );
          if (result.requestId !== requestId) throw new Error("native_withdrawal_mismatch");
          recoveryRequired = result.state !== "native_tasks_settled";
          return {
            outcome: "native-material-withdrawal",
            state: result.state,
            withdrawalRequestId: requestId,
          };
        }
        throw new Error("invalid_native_command");
      } finally {
        busy = false;
      }
    },
  };
}
