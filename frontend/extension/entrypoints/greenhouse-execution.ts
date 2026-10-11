import type { ApplicationExecutionCommand } from "@ai-job-apply/api-contracts";
import {
  validateApplicationExecutionCancel,
  validateApplicationExecutionCommand,
  validateApplicationExecutionInspect,
  validateApplicationExecutionProofResult,
} from "@ai-job-apply/api-contracts/browser-validators";
import { executeGreenhouseApplication } from "../lib/greenhouse/execute";
import { inspectGreenhouseApplication } from "../lib/greenhouse/inspect";
import {
  greenhouseExecutionProfile,
  greenhouseExecutionRegistry,
} from "../lib/greenhouse/profiles";
import type { TransferredNativeFile } from "../lib/native-material-transfer";

// Isolated-world lifetime only. Reinjection/restart cannot create a second effect listener.
const installed = "__applyDashGreenhouseExecutionV1";
if (!Object.hasOwn(globalThis, installed)) {
  Object.defineProperty(globalThis, installed, { value: true });
  let spent = false;
  let active:
    | {
        nonce: string;
        attemptId: string;
        controller: AbortController;
        files: TransferredNativeFile[];
        payload: ApplicationExecutionCommand;
      }
    | undefined;
  const clear = () => {
    const prior = active;
    active = undefined;
    prior?.controller.abort();
    for (const file of prior?.payload.files ?? []) file.contentBase64 = "";
    if (prior) prior.payload.fields.length = 0;
    for (const file of prior?.files ?? []) file.bytes.fill(0);
    if (prior) prior.files.length = 0;
  };
  window.addEventListener("pagehide", clear);
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (validateApplicationExecutionCancel(message)) {
      if (active?.nonce === message.nonce && active.attemptId === message.attemptId) clear();
      respond({ ok: true });
      return false;
    }
    if (validateApplicationExecutionInspect(message)) {
      void (async () => {
        if (
          spent ||
          active ||
          message.deadline <= Date.now() ||
          message.deadline > Date.now() + 60_000
        )
          throw Error("ApplicationExecutionUnavailable");
        const inspection = inspectGreenhouseApplication(document, message.employerUrl);
        try {
          const encoded = new TextEncoder().encode(inspection.structure);
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
          encoded.fill(0);
          const formHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          digest.fill(0);
          if (
            location.href !== message.employerUrl ||
            Date.now() >= message.deadline ||
            spent ||
            active
          )
            throw Error("ApplicationExecutionUnavailable");
          return {
            schema: "application-execution-inspection.v1",
            nonce: message.nonce,
            formHash,
            challengePresent: inspection.form.challengePresent,
          };
        } finally {
          inspection.dispose();
        }
      })().then(respond, () => respond({ error: "ApplicationExecutionUnavailable" }));
      return true;
    }
    if (!validateApplicationExecutionCommand(message)) return false;
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let state: NonNullable<typeof active> | undefined;
      try {
        let wire = JSON.stringify(message);
        if (new TextEncoder().encode(wire).byteLength > 850_000)
          throw Error("ApplicationExecutionUnavailable");
        wire = "";
        const profile = greenhouseExecutionProfile(message.variantId, message.adapterVersion);
        if (
          !profile ||
          spent ||
          active ||
          message.deadline <= Date.now() ||
          message.deadline > Date.now() + 60_000 ||
          location.href !== message.employerUrl
        )
          throw Error("ApplicationExecutionUnavailable");
        const controller = new AbortController();
        state = {
          nonce: message.nonce,
          attemptId: message.attemptId,
          controller,
          files: [],
          payload: message,
        };
        active = state;
        const stopped = new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(Error("ApplicationExecutionUnavailable")),
            { once: true },
          );
        });
        void stopped.catch(() => undefined);
        timer = setTimeout(clear, Math.max(0, message.deadline - Date.now()));
        const current = () => {
          if (
            active !== state ||
            controller.signal.aborted ||
            Date.now() >= message.deadline ||
            location.href !== message.employerUrl
          )
            throw Error("ApplicationExecutionUnavailable");
        };
        let total = 0;
        const kinds = new Set<string>();
        for (const file of message.files) {
          current();
          if (kinds.has(file.kind)) throw Error("ApplicationExecutionUnavailable");
          kinds.add(file.kind);
          const bytes = Uint8Array.from(atob(file.contentBase64), (character) =>
            character.charCodeAt(0),
          );
          state.files.push({
            kind: file.kind,
            generationId: file.generationId,
            format: file.format,
            mediaType: file.mediaType,
            sha256: file.sha256,
            bytes,
          });
          file.contentBase64 = "";
          total += bytes.byteLength;
          if (
            bytes.byteLength < 1 ||
            bytes.byteLength > 300_000 ||
            total > 600_000 ||
            (file.format === "pdf"
              ? new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-" ||
                file.mediaType !== "application/pdf"
              : bytes[0] !== 0x50 ||
                bytes[1] !== 0x4b ||
                file.mediaType !==
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
          )
            throw Error("ApplicationExecutionUnavailable");
          const digest = new Uint8Array(
            await Promise.race([crypto.subtle.digest("SHA-256", bytes), stopped]),
          );
          const hash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          digest.fill(0);
          current();
          if (hash !== file.sha256) throw Error("ApplicationExecutionUnavailable");
        }
        const result = await executeGreenhouseApplication({
          document,
          employerUrl: message.employerUrl,
          documentId: message.documentId,
          formHash: message.formHash,
          packetHash: message.packetHash,
          attemptId: message.attemptId,
          packet: message.fields,
          files: state.files,
          profile,
          registry: greenhouseExecutionRegistry,
          deadline: message.deadline,
          signal: controller.signal,
          claim() {
            current();
            if (spent) return false;
            spent = true;
            return true;
          },
          async revalidateDispatched() {
            current();
            const response: unknown = await chrome.runtime.sendMessage({
              schema: "application-execution-proof.v1",
              nonce: message.nonce,
              attemptId: message.attemptId,
            });
            current();
            if (
              !validateApplicationExecutionProofResult(response) ||
              response.nonce !== message.nonce ||
              response.attemptId !== message.attemptId
            )
              throw Error("ApplicationExecutionUnavailable");
          },
        });
        return {
          schema: "application-execution-result.v1",
          nonce: message.nonce,
          attemptId: message.attemptId,
          result,
        };
      } finally {
        for (const file of message.files) file.contentBase64 = "";
        message.fields.length = 0;
        clearTimeout(timer);
        if (active === state) clear();
      }
    })().then(respond, () => respond({ error: "ApplicationExecutionUnavailable" }));
    return true;
  });
}
