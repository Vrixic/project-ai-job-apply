import type {
  Application,
  ApplicationAttempt,
  ApplicationExecutionCommand,
  ApplicationSubmissionResultRequest,
} from "@ai-job-apply/api-contracts";
import {
  validateApplication,
  validateApplicationExecutionCommand,
  validateApplicationExecutionInspection,
  validateApplicationExecutionProof,
  validateApplicationExecutionResult,
  validateApplicationTemporaryMaterialAuthorization,
  validateCanonicalJobDetail,
} from "@ai-job-apply/api-contracts/browser-validators";
import { activeJobRevisionDigestInput } from "@ai-job-apply/api-contracts/job-revision-canonical";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { applicationExecutionApi } from "./application-execution-api";
import { plainHttpsUrl, readJson } from "./application-handoff";
import { greenhouseExecutionProfile } from "./greenhouse/profiles";
import type { NativeTransferSelection, TransferredNativeFile } from "./native-material-transfer";
import { sameNativeTransferBinding } from "./native-transfer-binding";

const unavailable = () => Error("ApplicationExecutionUnavailable");

/** Private background operation. This never exposes tokens/files/receipts to popup messages. */
export async function executeApprovedApplication(options: {
  apiOrigin: string;
  registry: AdapterRegistry;
  identity(signal: AbortSignal): Promise<{ accessToken: string; identityFence: string }>;
  preflight(selection: NativeTransferSelection, signal: AbortSignal): Promise<void>;
  owned: {
    files: TransferredNativeFile[];
    signal: AbortSignal;
    deadline: number;
    selection: NativeTransferSelection;
  };
}) {
  const selection = structuredClone(options.owned.selection);
  const declaration = options.registry.get("greenhouse-application-v1");
  const profile =
    declaration && greenhouseExecutionProfile(selection.variantId, declaration.version);
  if (!profile) throw unavailable();
  const controller = new AbortController();
  const abort = () => controller.abort();
  let deadline = Math.min(
    Date.now() + 60_000,
    options.owned.deadline,
    selection.approvalExpiresAtMs,
    ...selection.materials.map((material) => material.expiresAtMs),
  );
  options.owned.signal.addEventListener("abort", abort, { once: true });
  if (options.owned.signal.aborted) abort();
  let timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = [...nonceBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  nonceBytes.fill(0);
  let attempt: ApplicationAttempt | undefined;
  let originalPacket: NonNullable<Application["currentPacket"]> | undefined;
  let api: ReturnType<typeof applicationExecutionApi> | undefined;
  let dispatchSent = false;
  let commandSent = false;
  let resultSent = false;
  let command: ApplicationExecutionCommand | undefined;
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(unavailable()), { once: true });
  });
  void stopped.catch(() => undefined);
  const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, stopped]);
  const current = () => {
    if (
      controller.signal.aborted ||
      Date.now() >= deadline ||
      !Number.isFinite(deadline) ||
      options.registry.executionStatus(
        "greenhouse-application-v1",
        profile.variantId,
        profile.adapterVersion,
        profile.implementationSha256,
        new Date(),
      ).mode !== "autofill"
    )
      throw unavailable();
  };
  const identity = async () => {
    current();
    const session = await bounded(options.identity(controller.signal));
    current();
    if (session.identityFence !== selection.ownerFence) throw unavailable();
    return session;
  };
  const documentProof = async () => {
    current();
    const tabs = await bounded(chrome.tabs.query({ active: true, currentWindow: true }));
    if (
      tabs.length !== 1 ||
      tabs[0]?.id !== selection.tabId ||
      tabs[0].url !== selection.employerUrl ||
      tabs[0].incognito
    )
      throw unavailable();
    const documents = await bounded(
      chrome.scripting.executeScript({
        target: { tabId: selection.tabId, documentIds: [selection.documentId] },
        func: () => ({ url: location.href, topFrame: window.top === window }),
      }),
    );
    current();
    if (
      documents.length !== 1 ||
      documents[0]?.frameId !== 0 ||
      documents[0].documentId !== selection.documentId ||
      documents[0].result?.url !== selection.employerUrl ||
      !documents[0].result?.topFrame
    )
      throw unavailable();
  };
  const packetMatches = (application: Application) => {
    const packet = application.currentPacket;
    return (
      application.id === selection.applicationId &&
      application.canonicalJobId === selection.jobId &&
      packet?.id === selection.packetId &&
      packet.packetHash === selection.packetHash &&
      sameNativeTransferBinding(packet.temporaryMaterials ?? [], selection.materials)
    );
  };
  const freshAttempt = async (status: "started" | "dispatched") => {
    const session = await identity();
    const application = await bounded(
      readJson(
        new URL(`/v1/applications/${selection.applicationId}`, options.apiOrigin),
        session.accessToken,
        controller.signal,
      ),
    );
    if (
      !validateApplication(application) ||
      !packetMatches(application) ||
      application.status !== "submitting" ||
      application.currentAction !== "submission_in_progress" ||
      !attempt ||
      !originalPacket
    )
      throw unavailable();
    const matches = application.attempts.filter((candidate) => candidate.id === attempt?.id);
    const ownedAttempt = matches[0];
    if (
      matches.length !== 1 ||
      !ownedAttempt ||
      ownedAttempt.status !== status ||
      ownedAttempt.sequence !== attempt.sequence ||
      ownedAttempt.adapterId !== attempt.adapterId ||
      ownedAttempt.adapterVersion !== attempt.adapterVersion ||
      ownedAttempt.startedAt !== attempt.startedAt ||
      (status === "dispatched" && ownedAttempt.dispatchedAt !== attempt.dispatchedAt)
    )
      throw unavailable();
    const job = await bounded(
      readJson(
        new URL(`/v1/jobs/${selection.jobId}`, options.apiOrigin),
        session.accessToken,
        controller.signal,
      ),
    );
    if (
      !validateCanonicalJobDetail(job) ||
      job.id !== selection.jobId ||
      Date.parse(job.expiresAt) <= Date.now() ||
      (job.validThrough && Date.parse(job.validThrough) <= Date.now()) ||
      !job.sources.some(
        (source) => plainHttpsUrl(source.canonicalUrl) === plainHttpsUrl(selection.employerUrl),
      )
    )
      throw unavailable();
    const encoded = new TextEncoder().encode(activeJobRevisionDigestInput(job));
    const digest = new Uint8Array(await bounded(crypto.subtle.digest("SHA-256", encoded)));
    encoded.fill(0);
    const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    digest.fill(0);
    if (originalPacket.jobRevision !== hash || application.currentPacket?.jobRevision !== hash)
      throw unavailable();
    for (const material of selection.materials) {
      const kind = material.kind === "tailored_resume" ? "resume" : "cover-letter";
      const url = new URL(
        `/v1/applications/${selection.applicationId}/${kind}/authorization`,
        options.apiOrigin,
      );
      url.searchParams.set("generationId", material.generationId);
      const proof = await bounded(readJson(url, session.accessToken, controller.signal));
      if (
        !validateApplicationTemporaryMaterialAuthorization(proof) ||
        proof.packetId !== selection.packetId ||
        proof.packetHash !== selection.packetHash ||
        !sameNativeTransferBinding(proof.temporaryMaterial, material)
      )
        throw unavailable();
    }
    const finalApplication = await bounded(
      readJson(
        new URL(`/v1/applications/${selection.applicationId}`, options.apiOrigin),
        session.accessToken,
        controller.signal,
      ),
    );
    if (
      !validateApplication(finalApplication) ||
      !packetMatches(finalApplication) ||
      finalApplication.status !== "submitting" ||
      finalApplication.revision !== application.revision ||
      !finalApplication.attempts.some(
        (candidate) =>
          candidate.id === ownedAttempt.id &&
          candidate.status === status &&
          candidate.startedAt === ownedAttempt.startedAt &&
          candidate.dispatchedAt === ownedAttempt.dispatchedAt &&
          candidate.adapterId === ownedAttempt.adapterId &&
          candidate.adapterVersion === ownedAttempt.adapterVersion &&
          candidate.sequence === ownedAttempt.sequence,
      )
    )
      throw unavailable();
    await documentProof();
    await identity();
    current();
  };
  const proofListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message: unknown,
    sender,
    respond,
  ) => {
    if (!validateApplicationExecutionProof(message)) return false;
    if (
      sender.id !== chrome.runtime.id ||
      sender.tab?.id !== selection.tabId ||
      sender.frameId !== 0 ||
      sender.documentId !== selection.documentId ||
      sender.url !== selection.employerUrl ||
      sender.origin !== new URL(selection.employerUrl).origin ||
      sender.documentLifecycle !== "active" ||
      sender.tab.incognito ||
      !commandSent ||
      !attempt ||
      message.nonce !== nonce ||
      message.attemptId !== attempt.id
    )
      return false;
    void freshAttempt("dispatched").then(
      () =>
        respond({
          schema: "application-execution-proof-result.v1",
          nonce,
          attemptId: message.attemptId,
          ok: true,
        }),
      () => respond({ error: "ApplicationExecutionUnavailable" }),
    );
    return true;
  };
  const record = async (result: ApplicationSubmissionResultRequest) => {
    if (!api || !attempt || resultSent) throw unavailable();
    resultSent = true;
    const response = await bounded(api.result(attempt.id, result, crypto.randomUUID()));
    const resolved = response.attempts.find((candidate) => candidate.id === attempt?.id);
    if (
      response.id !== selection.applicationId ||
      response.canonicalJobId !== selection.jobId ||
      !resolved ||
      resolved.adapterId !== attempt.adapterId ||
      resolved.adapterVersion !== attempt.adapterVersion ||
      resolved.sequence !== attempt.sequence ||
      resolved.startedAt !== attempt.startedAt ||
      resolved.dispatchedAt !== attempt.dispatchedAt ||
      (result.kind === "confirmed"
        ? response.status !== "applied" ||
          resolved.status !== "confirmed" ||
          resolved.confirmation?.kind !== "provider_confirmation_page" ||
          resolved.confirmation.observedAt !== result.confirmation.observedAt
        : !["ambiguous", "taken_over", "failed_requires_review", "failed_no_effect"].includes(
            resolved.status,
          ))
    )
      throw unavailable();
    return {
      ok: true,
      outcome: result.kind === "confirmed" ? "confirmed" : "review_required",
      reviewLink: selection.reviewLink,
    };
  };
  try {
    current();
    await bounded(options.preflight(selection, controller.signal));
    await documentProof();
    const session = await identity();
    const application = await bounded(
      readJson(
        new URL(`/v1/applications/${selection.applicationId}`, options.apiOrigin),
        session.accessToken,
        controller.signal,
      ),
    );
    if (
      !validateApplication(application) ||
      !packetMatches(application) ||
      application.status !== "approved" ||
      application.revision !== selection.revision ||
      application.approval?.id !== selection.approvalId ||
      !application.currentPacket?.form ||
      application.currentPacket.form.adapterId !== "greenhouse-application-v1" ||
      application.currentPacket.form.variantId !== selection.variantId
    )
      throw unavailable();
    originalPacket = structuredClone(application.currentPacket);
    // Saved answers can expire sooner than approval/materials. Only shorten the original lease.
    for (const field of originalPacket.fields) {
      const validUntil = field.vaultReference?.validUntilEpochMs;
      if (validUntil !== undefined && validUntil !== null)
        deadline = Math.min(deadline, validUntil);
    }
    clearTimeout(timer);
    timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
    current();
    await bounded(
      chrome.scripting.executeScript({
        target: { tabId: selection.tabId, documentIds: [selection.documentId] },
        files: ["greenhouse-execution.js"],
        world: "ISOLATED",
      }),
    );
    const inspection: unknown = await bounded(
      chrome.tabs.sendMessage(
        selection.tabId,
        {
          schema: "application-execution-inspect.v1",
          nonce,
          employerUrl: selection.employerUrl,
          deadline,
        },
        { documentId: selection.documentId, frameId: 0 },
      ),
    );
    if (
      !validateApplicationExecutionInspection(inspection) ||
      inspection.nonce !== nonce ||
      inspection.formHash !== originalPacket.form?.formHash
    )
      throw unavailable();
    await bounded(options.preflight(selection, controller.signal));
    await documentProof();
    api = applicationExecutionApi({
      apiOrigin: options.apiOrigin,
      accessToken: session.accessToken,
      applicationId: selection.applicationId,
      deadline,
      signal: controller.signal,
    });
    const startedAt = Date.now();
    const start = await bounded(
      api.start(
        {
          expectedRevision: selection.revision,
          adapterId: "greenhouse-application-v1",
          adapterVersion: profile.adapterVersion,
          observedFormHash: inspection.formHash,
        },
        crypto.randomUUID(),
      ),
    );
    if (
      start.outcome !== "started" ||
      !start.attemptId ||
      !packetMatches(start.application) ||
      start.application.status !== "submitting"
    )
      throw unavailable();
    const candidates = start.application.attempts.filter(
      (candidate) => candidate.id === start.attemptId,
    );
    attempt = candidates[0];
    if (
      candidates.length !== 1 ||
      !attempt ||
      attempt.status !== "started" ||
      attempt.adapterId !== "greenhouse-application-v1" ||
      attempt.adapterVersion !== profile.adapterVersion ||
      Date.parse(attempt.startedAt) < startedAt - 5000 ||
      Date.parse(attempt.startedAt) > Date.now() + 5000 ||
      attempt.dispatchedAt ||
      attempt.resolvedAt
    )
      throw unavailable();
    await freshAttempt("started");
    dispatchSent = true;
    const dispatched = await bounded(api.dispatch(attempt.id));
    if (
      dispatched.id !== attempt.id ||
      dispatched.sequence !== attempt.sequence ||
      dispatched.status !== "dispatched" ||
      dispatched.adapterId !== attempt.adapterId ||
      dispatched.adapterVersion !== attempt.adapterVersion ||
      dispatched.startedAt !== attempt.startedAt ||
      !dispatched.dispatchedAt ||
      dispatched.resolvedAt ||
      Date.parse(dispatched.dispatchedAt) < Date.parse(attempt.startedAt) ||
      Date.parse(dispatched.dispatchedAt) > Date.now() + 5000
    )
      throw unavailable();
    attempt = dispatched;
    await freshAttempt("dispatched");
    command = {
      schema: "application-execution-command.v1",
      nonce,
      attemptId: attempt.id,
      documentId: selection.documentId,
      employerUrl: selection.employerUrl,
      packetHash: selection.packetHash,
      formHash: inspection.formHash,
      variantId: profile.variantId,
      adapterVersion: profile.adapterVersion,
      deadline,
      fields: originalPacket.fields
        .filter(
          (field) =>
            field.origin !== "answer_vault" &&
            !field.reasons.includes("restricted_answer") &&
            !/^(?:authorization|demographic|disclosure|attestation|signature|challenge|captcha|mfa|documents?)\./u.test(
              field.fieldKey,
            ),
        )
        .map((field) => ({
          fieldKey: field.fieldKey,
          value: field.value,
          needsUserAction:
            field.disposition === "user_action" ||
            field.reasons.includes("direct_user_action") ||
            field.origin === "generated",
        })),
      files: options.owned.files.map((file) => ({
        kind: file.kind,
        generationId: file.generationId,
        format: file.format,
        mediaType: file.mediaType,
        sha256: file.sha256,
        contentBase64: btoa(Array.from(file.bytes, (byte) => String.fromCharCode(byte)).join("")),
      })),
    };
    if (
      !validateApplicationExecutionCommand(command) ||
      new TextEncoder().encode(JSON.stringify(command)).byteLength > 850_000
    )
      throw unavailable();
    chrome.runtime.onMessage.addListener(proofListener);
    commandSent = true;
    const response: unknown = await bounded(
      chrome.tabs.sendMessage(selection.tabId, command, {
        documentId: selection.documentId,
        frameId: 0,
      }),
    );
    if (
      !validateApplicationExecutionResult(response) ||
      response.nonce !== nonce ||
      response.attemptId !== attempt.id
    )
      throw unavailable();
    current();
    await identity();
    if (response.result.kind === "confirmed") {
      const evidence = response.result.confirmation;
      const observed = Date.parse(evidence.observedAt);
      if (
        evidence.kind !== "provider_confirmation_page" ||
        observed < Date.parse(attempt.dispatchedAt ?? "") ||
        observed > Date.now() ||
        observed >= deadline ||
        !evidence.providerReference ||
        !/^[a-zA-Z0-9_-]{1,200}$/u.test(evidence.providerReference)
      )
        throw unavailable();
    }
    return await record(response.result);
  } catch {
    // A sent dispatch is ambiguous even if its acknowledgement was lost. Never resend it.
    if (dispatchSent && attempt && api && !resultSent && !controller.signal.aborted) {
      try {
        await identity();
        return await record({ kind: "unrecognized_response" });
      } catch {
        /* Requires reconciliation. */
      }
    }
    return {
      ok: false,
      outcome: dispatchSent ? "unknown" : "review_required",
      reviewLink: selection.reviewLink,
    };
  } finally {
    abort();
    clearTimeout(timer);
    options.owned.signal.removeEventListener("abort", abort);
    chrome.runtime.onMessage.removeListener(proofListener);
    for (const file of command?.files ?? []) file.contentBase64 = "";
    if (command) command.fields.length = 0;
    originalPacket = undefined;
    if (commandSent && attempt)
      void chrome.tabs
        .sendMessage(
          selection.tabId,
          {
            schema: "application-execution-cancel.v1",
            nonce,
            attemptId: attempt.id,
          },
          { documentId: selection.documentId, frameId: 0 },
        )
        .catch(() => undefined);
  }
}
