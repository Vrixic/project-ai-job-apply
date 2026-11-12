import type { ApplicationExecutionCommand } from "@ai-job-apply/api-contracts";
import {
  validateApplicationExecutionCancel,
  validateApplicationExecutionCommand,
  validateApplicationExecutionDraft,
  validateApplicationExecutionInspect,
  validateApplicationExecutionProofResult,
} from "@ai-job-apply/api-contracts/browser-validators";
import { buildFillPlan } from "@ai-job-apply/ats-sdk/plan";
import { executeApplication, incompleteCandidateQuestions } from "../lib/application-run";
import { FILL_ONLY_BUDGET_MS, runBudgetMs } from "../lib/execution-budget";
import type { TransferredNativeFile } from "../lib/native-material-transfer";
import { draftableQuestion, writeValue } from "../lib/narrative-answer-page";
import {
  NARRATIVE_ANSWER_REQUEST,
  type NarrativeAnswerReply,
} from "../lib/narrative-answer-protocol";
import { applicationExecutionRegistry, providerForUrl } from "../lib/providers";
import { questionLabels } from "../lib/question-labels";

/** Drafting several questions takes a few seconds each; the whole step is bounded. */
const DRAFT_BUDGET_MS = 120_000;
const MAXIMUM_DRAFTS = 5;

// Isolated-world lifetime only. Reinjection/restart cannot create a second effect listener.
const installed = "__applyDashApplicationExecutionV1";
if (!Object.hasOwn(globalThis, installed)) {
  Object.defineProperty(globalThis, installed, { value: true });
  let spent = false;
  let drafting = false;
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
          // Inspection only reads the page; the run's own mode is checked when its command arrives.
          message.deadline > Date.now() + FILL_ONLY_BUDGET_MS
        )
          throw Error("ApplicationExecutionUnavailable");
        const provider = providerForUrl(message.employerUrl);
        if (!provider) throw Error("ApplicationExecutionUnavailable");
        const inspection = provider.inspect(document, message.employerUrl);
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
          // Before any attempt exists, how many required questions only the candidate can answer
          // are still incomplete. The page is only read. A challenge page is filled and left to the
          // candidate whatever this says, so it is not counted.
          let waiting: string[] | undefined;
          let draftable = 0;
          let draftNoAi = false;
          if (message.readiness) {
            const kinds = message.readiness.fileKinds;
            const plan = buildFillPlan(inspection.form, message.readiness.fields, {
              resume: kinds.some(
                (kind) => kind === "tailored_resume" || kind === "uploaded_resume",
              ),
              coverLetter: kinds.includes("cover_letter"),
            });
            const questions = plan.requiresTakeover
              ? []
              : incompleteCandidateQuestions(provider, inspection, plan);
            waiting = questions.map((question) => question.label);
            // Of those, the ones the answer icon can draft, and whether the employer asked for a
            // hand-written answer to any of them (the candidate is told and decides).
            for (const question of questions) {
              const only = question.controls.length === 1 ? question.controls[0] : undefined;
              const draft = only ? draftableQuestion(only, window) : undefined;
              if (!draft) continue;
              draftable++;
              draftNoAi ||= draft.noAi;
            }
          }
          return {
            schema: "application-execution-inspection.v1",
            nonce: message.nonce,
            formHash,
            challengePresent: inspection.form.challengePresent,
            ...(waiting === undefined
              ? {}
              : {
                  needs: Math.min(waiting.length, 200),
                  waiting: questionLabels(waiting),
                  draftable: Math.min(draftable, 200),
                  draftNoAi,
                }),
          };
        } finally {
          // The approved answers the readiness question carried are not kept.
          if (message.readiness) message.readiness.fields.length = 0;
          inspection.dispose();
        }
      })().then(respond, () => respond({ error: "ApplicationExecutionUnavailable" }));
      return true;
    }
    if (validateApplicationExecutionDraft(message)) {
      void (async () => {
        if (
          spent ||
          active ||
          drafting ||
          message.deadline <= Date.now() ||
          message.deadline > Date.now() + DRAFT_BUDGET_MS ||
          location.href !== message.employerUrl
        )
          throw Error("ApplicationExecutionUnavailable");
        const provider = providerForUrl(message.employerUrl);
        if (!provider) throw Error("ApplicationExecutionUnavailable");
        drafting = true;
        const inspection = provider.inspect(document, message.employerUrl);
        try {
          // The required, empty, open questions the answer icon would draft: nothing else is touched.
          const targets = inspection.form.fields
            .filter((field) => field.required)
            .flatMap((field) => {
              const controls = inspection.resolve(field.ref);
              const only = controls.length === 1 ? controls[0] : undefined;
              const draft = only ? draftableQuestion(only, window) : undefined;
              return draft ? [draft] : [];
            })
            .slice(0, MAXIMUM_DRAFTS);
          let drafted = 0;
          let declined = 0;
          let failed = 0;
          // One at a time, as the extension's own answer session allows.
          for (const target of targets) {
            if (Date.now() >= message.deadline || location.href !== message.employerUrl) {
              failed++;
              continue;
            }
            let reply: NarrativeAnswerReply;
            try {
              reply = (await chrome.runtime.sendMessage({
                schema: NARRATIVE_ANSWER_REQUEST,
                question: target.question,
                ...(target.guidance ? { guidance: target.guidance } : {}),
              })) as NarrativeAnswerReply;
            } catch {
              reply = { status: "error", reason: "failed" };
            }
            if (reply?.status === "ready") {
              // Never over what the candidate typed in the meantime.
              if (target.box.isConnected && target.box.value.trim() === "") {
                writeValue(target.box, reply.text);
                drafted++;
              } else failed++;
            } else if (reply?.status === "declined") declined++;
            else failed++;
          }
          return {
            schema: "application-execution-draft-result.v1",
            nonce: message.nonce,
            drafted,
            declined,
            failed,
          };
        } finally {
          inspection.dispose();
          drafting = false;
        }
      })().then(respond, () => respond({ error: "ApplicationExecutionUnavailable" }));
      return true;
    }
    if (!validateApplicationExecutionCommand(message)) return false;
    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let state: NonNullable<typeof active> | undefined;
      try {
        const hasUploaded = message.files.some((file) => file.kind === "uploaded_resume");
        let wire = JSON.stringify(message);
        if (new TextEncoder().encode(wire).byteLength > (hasUploaded ? 3_700_000 : 850_000))
          throw Error("ApplicationExecutionUnavailable");
        wire = "";
        const provider = providerForUrl(message.employerUrl);
        const profile = provider?.profile(message.variantId, message.adapterVersion);
        if (
          !provider ||
          !profile ||
          spent ||
          active ||
          message.deadline <= Date.now() ||
          message.deadline > Date.now() + runBudgetMs(message.fillOnly) ||
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
            (location.href !== message.employerUrl &&
              provider.isConfirmationUrl?.(message.employerUrl, location.href) !== true)
          )
            throw Error("ApplicationExecutionUnavailable");
        };
        let ran = "";
        let notes: readonly string[] = [];
        let total = 0;
        const kinds = new Set<string>();
        for (const file of message.files) {
          current();
          if (kinds.has(file.kind)) throw Error("ApplicationExecutionUnavailable");
          kinds.add(file.kind);
          const bytes = Uint8Array.from(atob(file.contentBase64), (character) =>
            character.charCodeAt(0),
          );
          // Generated files are PDF only; only the candidate's own original keeps its format.
          if (file.kind !== "uploaded_resume" && file.format !== "pdf")
            throw Error("ApplicationExecutionUnavailable");
          state.files.push({
            kind: file.kind,
            ...(file.generationId ? { generationId: file.generationId } : {}),
            ...(file.fileName ? { fileName: file.fileName } : {}),
            format: file.format,
            mediaType: file.mediaType,
            sha256: file.sha256,
            bytes,
          });
          file.contentBase64 = "";
          total += bytes.byteLength;
          if (
            bytes.byteLength < 1 ||
            bytes.byteLength > (file.kind === "uploaded_resume" ? 2 * 1024 * 1024 : 300_000) ||
            total > (hasUploaded ? 2 * 1024 * 1024 + 300_000 : 600_000) ||
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
        const result = await executeApplication({
          provider,
          document,
          employerUrl: message.employerUrl,
          documentId: message.documentId,
          formHash: message.formHash,
          packetHash: message.packetHash,
          attemptId: message.attemptId,
          packet: message.fields,
          files: state.files,
          ...(message.fillOnly ? { fillOnly: true } : {}),
          paceMs: 450,
          onNotes: (list) => {
            notes = list;
          },
          onStage: (stage) => {
            ran = stage;
          },
          profile,
          registry: applicationExecutionRegistry,
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
          ...(notes.length ? { notes: [...notes] } : {}),
          ...(result.kind !== "confirmed" && result.kind !== "challenge_required" && ran
            ? { stage: ran }
            : {}),
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
