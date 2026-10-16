import type { Application } from "@ai-job-apply/api-contracts";
import {
  validateApplication,
  validateApplicationTemporaryMaterialAuthorization,
  validateCanonicalJobDetail,
} from "@ai-job-apply/api-contracts/browser-validators";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
import { employerPageForSource } from "@ai-job-apply/ats-sdk/observed-form";
import { safeApiOrigin } from "./config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const HANDOFF_FAILURE =
  "Open the matching employer page and reload an approved, unexpired application review link. Sign in again if needed.";
export const FORM_CAPTURE_FAILURE =
  "Open the exact active employer page and current application review link, then capture again. Challenges and unsupported forms must be completed manually.";
export interface HandoffLink {
  applicationId: string;
  jobId: string;
  href: string;
}
export interface ApprovedHandoff {
  id: string;
  revision: number;
  packetHash: string;
  approvalId: string;
  deadline: number;
  title: string;
  company: string;
  reviewLink: string;
  fields: { fieldKey: string; value: string; restricted: boolean; context?: string }[];
}

export function parseHandoffLink(value: string, webOrigin: string): HandoffLink | undefined {
  if (!safeApiOrigin(webOrigin) || value.length > 1024) return undefined;
  try {
    const url = new URL(value);
    const applicationId = url.searchParams.get("application") ?? "";
    const jobId = url.searchParams.get("job") ?? "";
    if (
      url.origin !== webOrigin ||
      url.username ||
      url.password ||
      url.pathname !== "/jobs" ||
      url.hash ||
      [...url.searchParams].length !== 2 ||
      !UUID.test(applicationId) ||
      !UUID.test(jobId) ||
      [...url.searchParams.keys()].some((key) => !["application", "job"].includes(key))
    )
      return undefined;
    return {
      applicationId,
      jobId,
      href: `${webOrigin}/jobs?application=${applicationId}&job=${jobId}`,
    };
  } catch {
    return undefined;
  }
}

export function plainHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Entire response, including streaming, has one deadline and a byte cap. Never follows redirects. */
export async function readJson(url: URL, token: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    body = response.body;
    if (
      controller.signal.aborted ||
      response.status !== 200 ||
      response.headers.get("cache-control")?.toLowerCase() !== "no-store" ||
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json" ||
      !body
    )
      throw new Error(HANDOFF_FAILURE);
    reader = body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (controller.signal.aborted) throw new Error(HANDOFF_FAILURE);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512 * 1024) {
        chunk.value.fill(0);
        throw new Error(HANDOFF_FAILURE);
      }
      text += decoder.decode(chunk.value, { stream: true });
      chunk.value.fill(0);
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    text = "";
    return value;
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort();
          reject(new Error(HANDOFF_FAILURE));
        }, 10_000);
        controller.signal.addEventListener("abort", () => reject(new Error(HANDOFF_FAILURE)), {
          once: true,
        });
      }),
    ]);
  } catch {
    throw new Error(HANDOFF_FAILURE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    else void body?.cancel().catch(() => undefined);
  }
}

export function approvedHandoff(
  application: Application,
  now: number,
): Pick<ApprovedHandoff, "id" | "revision" | "packetHash" | "approvalId" | "deadline" | "fields"> {
  const packet = application.currentPacket;
  const approval = application.approval;
  if (
    application.status !== "approved" ||
    application.currentAction !== "ready_to_submit" ||
    !packet ||
    !approval ||
    approval.packetHash !== packet.packetHash ||
    Date.parse(approval.approvedAt) > now ||
    application.attempts.some((attempt) =>
      ["started", "dispatched", "ambiguous"].includes(attempt.status),
    )
  )
    throw new Error(HANDOFF_FAILURE);
  let deadline = Math.min(now + 60_000, Date.parse(approval.expiresAt));
  const kinds = new Set<string>();
  for (const material of packet.temporaryMaterials ?? []) {
    const expected =
      material.kind === "tailored_resume"
        ? packet.artifactHashes.resume
        : packet.artifactHashes.coverLetter;
    if (
      kinds.has(material.kind) ||
      material.contentSha256 !== expected ||
      material.completedAtMs > now ||
      material.completedAtMs < 0 ||
      material.expiresAtMs !== material.completedAtMs + 1_800_000
    )
      throw new Error(HANDOFF_FAILURE);
    kinds.add(material.kind);
    deadline = Math.min(deadline, material.expiresAtMs);
  }
  // A generated document field may carry only its exact bound artifact digest, never content.
  // Document fields are never copied below; the file is downloaded from the native workspace.
  const boundDocumentDigest = (field: (typeof packet.fields)[number]) =>
    (field.fieldKey === "documents.resume" && field.value === packet.artifactHashes.resume) ||
    (field.fieldKey === "documents.cover_letter" &&
      field.value === packet.artifactHashes.coverLetter);
  const keys = new Set<string>();
  const fields: ApprovedHandoff["fields"] = [];
  for (const field of packet.fields) {
    const restricted =
      /^(?:authorization|demographic|disclosure)\./u.test(field.fieldKey) ||
      field.reasons.includes("restricted_answer") ||
      field.origin === "answer_vault";
    if (
      keys.has(field.fieldKey) ||
      (field.origin === "generated" && field.value !== null && !boundDocumentDigest(field)) ||
      ((field.requiresReview || restricted) &&
        !approval.acknowledgedFieldKeys.includes(field.fieldKey)) ||
      (restricted && !field.requiresReview)
    )
      throw new Error(HANDOFF_FAILURE);
    keys.add(field.fieldKey);
    if (field.origin === "answer_vault") {
      if (!field.vaultReference?.meaningConfirmed || !field.requiresReview)
        throw new Error(HANDOFF_FAILURE);
      if (field.vaultReference.validUntilEpochMs !== null)
        deadline = Math.min(deadline, field.vaultReference.validUntilEpochMs);
    }
    if (
      field.value === null ||
      field.origin === "generated" ||
      field.disposition === "user_action" ||
      field.reasons.includes("direct_user_action") ||
      /^(?:documents?|attestation|signature|challenge)\./u.test(field.fieldKey)
    )
      continue;
    const value =
      typeof field.value === "boolean"
        ? field.value
          ? "Yes"
          : "No"
        : Array.isArray(field.value)
          ? field.value.join(", ")
          : String(field.value);
    if (value)
      fields.push({
        fieldKey: field.fieldKey,
        value,
        restricted,
        ...(field.vaultReference ? { context: field.vaultReference.context } : {}),
      });
  }
  if (!Number.isFinite(deadline) || deadline <= now) throw new Error(HANDOFF_FAILURE);
  return {
    id: application.id,
    revision: application.revision,
    packetHash: packet.packetHash,
    approvalId: approval.id,
    deadline,
    fields,
  };
}

/** Owner-scoped reads only; no write, provider request, content download, fill or submit capability. */
export async function readApprovedHandoff(
  link: HandoffLink,
  tabUrl: string,
  apiOrigin: string,
  token: string,
  signal?: AbortSignal,
): Promise<ApprovedHandoff> {
  if (!safeApiOrigin(apiOrigin) || !plainHttpsUrl(tabUrl)) throw new Error(HANDOFF_FAILURE);
  const application = await readJson(
    new URL(`/v1/applications/${link.applicationId}`, apiOrigin),
    token,
    signal,
  );
  if (
    !validateApplication(application) ||
    application.id !== link.applicationId ||
    application.canonicalJobId !== link.jobId
  )
    throw new Error(HANDOFF_FAILURE);
  const job = await readJson(new URL(`/v1/jobs/${link.jobId}`, apiOrigin), token, signal);
  if (
    !validateCanonicalJobDetail(job) ||
    job.id !== link.jobId ||
    Date.parse(job.expiresAt) <= Date.now() ||
    (job.validThrough && Date.parse(job.validThrough) <= Date.now()) ||
    !job.sources.some((source) => employerPageForSource(source.canonicalUrl, tabUrl))
  )
    throw new Error(HANDOFF_FAILURE);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(activeJobRevisionDigestInput(job)),
  );
  const jobHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const approved = approvedHandoff(application, Date.now());
  if (application.currentPacket?.jobRevision !== jobHash) throw new Error(HANDOFF_FAILURE);
  for (const material of application.currentPacket.temporaryMaterials ?? []) {
    const endpoint = material.kind === "tailored_resume" ? "resume" : "cover-letter";
    const url = new URL(
      `/v1/applications/${link.applicationId}/${endpoint}/authorization`,
      apiOrigin,
    );
    url.searchParams.set("generationId", material.generationId);
    const proof = await readJson(url, token, signal);
    if (
      !validateApplicationTemporaryMaterialAuthorization(proof) ||
      proof.packetId !== application.currentPacket.id ||
      proof.packetHash !== approved.packetHash ||
      Object.entries(material).some(
        ([key, value]) => proof.temporaryMaterial[key as keyof typeof material] !== value,
      )
    )
      throw new Error(HANDOFF_FAILURE);
  }
  const current = await readJson(
    new URL(`/v1/applications/${link.applicationId}`, apiOrigin),
    token,
    signal,
  );
  if (
    !validateApplication(current) ||
    current.id !== approved.id ||
    current.canonicalJobId !== link.jobId ||
    current.revision !== approved.revision ||
    current.approval?.id !== approved.approvalId ||
    current.currentPacket?.packetHash !== approved.packetHash
  )
    throw new Error(HANDOFF_FAILURE);
  const result = approvedHandoff(current, Date.now());
  return {
    ...result,
    deadline: Math.min(approved.deadline, result.deadline),
    title: job.title,
    company: job.company.name,
    reviewLink: link.href,
  };
}
