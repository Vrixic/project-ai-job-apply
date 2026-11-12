import { followActiveTab } from "./active-tab-follow";
import type { ApprovedHandoff } from "./application-handoff";
import { FORM_CAPTURE_FAILURE, HANDOFF_FAILURE } from "./application-handoff";
import { extensionConfiguration } from "./config";
import { isTokenRenewal } from "./session-change";

/** How often the open panel reaches the worker so the browser does not stop it while idle. */
const WORKER_HEARTBEAT_MS = 20_000;

/** Popup/side-panel memory only. No document content or persistent handoff queue. */
const NOTE_FIELDS: Readonly<Record<string, string>> = {
  "education.school": "School",
  "education.degree": "Degree",
  "education.field": "Discipline",
  "authorization.us_authorized": "Work authorization",
  "job.salary_expectation": "Salary",
};

/** What the fill left to the candidate, in words. The codes carry no page text and no value. */
function fillNotes(notes: unknown): string {
  if (!Array.isArray(notes)) return "";
  const parts: string[] = [];
  for (const note of notes) {
    if (typeof note !== "string") continue;
    const [kind, rest = ""] = note.split(":");
    if (kind === "other" && NOTE_FIELDS[rest])
      parts.push(
        `${NOTE_FIELDS[rest]} was not in the board's list, so Other was chosen: check it.`,
      );
    else if (kind === "empty" && NOTE_FIELDS[rest])
      parts.push(`${NOTE_FIELDS[rest]} has no saved value: add it in your ApplyDash profile.`);
    else if (kind === "near" && NOTE_FIELDS[rest])
      parts.push(
        `${NOTE_FIELDS[rest]}: none of the ranges held your salary, so the closest one was chosen: check it.`,
      );
    else if (kind === "check" && NOTE_FIELDS[rest])
      parts.push(
        `${NOTE_FIELDS[rest]}: your United States answer does not settle a question that names another country, so it is left to you.`,
      );
    else if (kind === "needs" && /^[0-9]{1,3}$/u.test(rest))
      parts.push(
        `${rest} required question${rest === "1" ? "" : "s"} still need${rest === "1" ? "s" : ""} you.`,
      );
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function mountApplicationHandoff() {
  const section = document.querySelector<HTMLElement>("#application-handoff");
  if (!section || !extensionConfiguration.applicationHandoffWebOrigin) return;
  section.hidden = false;
  const privacy = document.querySelector<HTMLElement>(".privacy");
  if (privacy)
    privacy.textContent =
      "Explicit job/question capture excludes entered form values. Approved application answers are shown temporarily in extension memory; copying creates a clipboard copy under your control.";
  const input = section.querySelector<HTMLInputElement>("input");
  const load = section.querySelector<HTMLButtonElement>("[data-handoff-load]");
  const clear = section.querySelector<HTMLButtonElement>("[data-handoff-clear]");
  const content = section.querySelector<HTMLElement>("[data-handoff-content]");
  const status = section.querySelector<HTMLElement>("[data-handoff-status]");
  if (!input || !load || !clear || !content || !status) throw new Error("Missing handoff controls");
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: ApprovedHandoff | undefined;
  let snapshotId: string | undefined;
  let busy = false;
  /** The page the application was last prepared for: the tab, and its address once visible. */
  let preparedFor: string | undefined;
  const activeTabKey = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id === undefined
        ? undefined
        : {
            key: `${tab.id}|${tab.url ?? ""}`,
            visible: tab.url !== undefined,
            // A tab still opening (blank, or a browser page) is not an employer page yet, and a
            // page still loading may load again: the extension holds a selection to one document.
            blank: tab.url !== undefined && !/^https?:/u.test(tab.url),
            loading: tab.status !== undefined && tab.status !== "complete",
          };
    } catch {
      return undefined;
    }
  };
  const nativeInstructions = section.querySelector<HTMLElement>("[data-native-instructions]");
  if (nativeInstructions && extensionConfiguration.applicationExecutionEnabled)
    nativeInstructions.hidden = false;
  for (const action of ["select", "clear", "fill", "apply"] as const) {
    const button = section.querySelector<HTMLButtonElement>(`[data-native-${action}]`);
    if (!button || !extensionConfiguration.applicationExecutionEnabled) continue;
    button.hidden = false;
    button.addEventListener("click", async () => {
      const ownsBusy = action !== "clear";
      if (busy && ownsBusy) return;
      if (ownsBusy) busy = true;
      button.disabled = true;
      try {
        // Nothing to select, fill or submit until Apply has set the review link on this panel.
        if (!input.value && action !== "clear") {
          status.textContent =
            "Press Apply on the website first. The review link fills in by itself.";
          return;
        }
        const preparing = action === "select" ? await activeTabKey() : undefined;
        // The fill takes several seconds: say so, instead of leaving the last message up.
        if (action === "fill")
          status.textContent =
            "Filling in your application. Watch the employer page; nothing is submitted.";
        if (action === "apply")
          status.textContent =
            "Filling in and submitting your application. Watch the employer page.";
        const message =
          action === "select"
            ? { action: "application_native_select", reviewLink: input.value }
            : action === "apply"
              ? { action: "application_native_apply", reviewLink: input.value }
              : action === "fill"
                ? { action: "application_native_apply", reviewLink: input.value, fillOnly: true }
                : { action: "application_native_clear" };
        let response = await chrome.runtime.sendMessage(message);
        // The extension holds the selected page and its resume in memory only. If the browser
        // stopped its worker, or the page reloaded and dropped them, nothing has started: select the
        // same page once more, as the candidate would, and carry on with their press.
        if (
          (action === "fill" || action === "apply") &&
          response?.stage === "selection-or-resume:none"
        ) {
          status.textContent = "Reconnecting to the employer page...";
          const again = await chrome.runtime.sendMessage({
            action: "application_native_select",
            reviewLink: input.value,
          });
          if (again?.ok) {
            status.textContent =
              action === "fill"
                ? "Filling in your application. Watch the employer page; nothing is submitted."
                : "Filling in and submitting your application. Watch the employer page.";
            response = await chrome.runtime.sendMessage(message);
          } else if (typeof again?.stage === "string" && again.stage)
            response = { ...response, stage: `reconnect>${again.stage}` };
        }
        const where =
          typeof response.stage === "string" && response.stage
            ? ` (stopped at: ${response.stage})`
            : "";
        // What the page run reported and the step it reached: names only, never a value or page text.
        const pageRun =
          typeof response.result === "string"
            ? ` (page run: ${response.result}${typeof response.pageStage === "string" && response.pageStage ? `, at ${response.pageStage}` : ""})`
            : "";
        if (action === "fill") {
          status.textContent =
            response.ok && response.result === "challenge_required"
              ? `Filled for your review. Nothing was submitted. Check the employer page; submit it yourself or leave it.${fillNotes(response.notes)}`
              : `The page could not be filled completely. Nothing was submitted. Check the employer page and try again.${where}${pageRun}`;
          return;
        }
        if (action === "apply" && response.stage === "page-not-ready") {
          // Refused before an attempt was made: nothing was recorded, so there is nothing to
          // reconcile. The questions are named in the employer's own words (plain text, from the
          // page); nothing the candidate entered is ever shown or sent.
          const needs =
            Number.isSafeInteger(response.needs) && response.needs > 0 ? response.needs : 0;
          const names: string[] = Array.isArray(response.waiting)
            ? response.waiting
                .filter((name: unknown): name is string => typeof name === "string" && name !== "")
                .slice(0, 5)
            : [];
          const more = needs > names.length ? ` and ${needs - names.length} more` : "";
          const one = needs <= 1;
          status.textContent = `Nothing was submitted and nothing was recorded. ${
            needs === 1
              ? "1 required question"
              : needs > 1
                ? `${needs} required questions`
                : "A required question"
          } on the employer page still ${one ? "needs" : "need"} your own answer.${
            names.length
              ? ` Waiting for you: ${names.map((name) => `"${name}"`).join("; ")}${more}.`
              : ""
          } Answer ${one ? "it" : "them"} on the page, then press Fill and submit again.`;
          return;
        }
        if (action === "apply") {
          status.textContent =
            response.ok && response.outcome === "confirmed"
              ? "The employer confirmed submission. Return to the application workspace to view history."
              : response.outcome === "unknown"
                ? `The submission outcome is uncertain. Return to the workspace to review it; do not submit again.${where}${pageRun}`
                : response.result === "precondition_failed"
                  ? // The page was not ready before anything was filled or clicked (for example a
                    // required question that only the candidate can answer is still empty).
                    `Nothing was submitted: the employer page was not ready. A required question may still need your own answer. Answer it on the page, record this attempt as not submitted in the application workspace, then try again.${where}${pageRun}`
                  : `Not submitted by the extension, or not confirmed. Check the employer page, finish by hand if needed, then record the outcome in the application workspace.${where}${pageRun}`;
          return;
        }
        if (!response.ok) throw Object.assign(Error(), { stage: response.stage });
        if (action === "select") preparedFor = preparing?.key;
        else preparedFor = undefined;
        status.textContent =
          action === "select"
            ? response.resume === "uploaded"
              ? "Employer tab selected. Your own uploaded resume is ready to attach. Transfer availability still depends on adapter acceptance."
              : "Employer tab selected for one minute. Your generated resume is sent from the application workspace tab automatically; keep that tab open. Transfer availability still depends on adapter acceptance."
            : "Approved file transfer cleared. If Apply had started, review the workspace before any further submission.";
      } catch (error) {
        const step =
          (action === "select" || action === "fill" || action === "apply") &&
          error instanceof Error &&
          "stage" in error &&
          error.stage
            ? ` (stopped at: ${String(error.stage)})`
            : "";
        const signedOut =
          action === "select" &&
          error instanceof Error &&
          "stage" in error &&
          error.stage === "sign-in";
        status.textContent =
          action === "apply"
            ? `Apply could not complete. Review the application workspace before trying any further submission.${step}`
            : action === "fill"
              ? `The page could not be filled. Nothing was submitted. Select the employer page again and retry.${step}`
              : signedOut
                ? "Sign in to ApplyDash in this panel first, then press Apply on the website again."
                : `The file transfer could not be selected. Check the employer tab, current approval and extension sign-in.${step}`;
      } finally {
        if (ownsBusy) busy = false;
        button.disabled = false;
      }
    });
  }
  // After Apply on the website the extension already holds the application's identifiers. Opening
  // it on the employer page selects that tab with no pasted link; the candidate then confirms. The
  // side panel stays open across tabs, so this is offered again for each page the candidate opens.
  //
  // The panel opens at the Apply click (the only moment the browser allows it), long before the
  // application is ready and the review link exists. Until then it shows only that it is preparing,
  // never an empty review link, and it fills in by itself when the link is set.
  const PREPARING = "Preparing your application. This panel fills in by itself when it is ready.";
  let preparingTimer: ReturnType<typeof setTimeout> | undefined;
  const showPreparing = (untilMs: number | undefined) => {
    clearTimeout(preparingTimer);
    const root = document.documentElement;
    if (untilMs !== undefined) {
      root.dataset.applicationState = "preparing";
      status.textContent = PREPARING;
      // If nothing arrives (the website could not finish), go back to the ordinary panel.
      preparingTimer = setTimeout(
        () => void offerPendingIntent(),
        Math.max(0, untilMs - Date.now()) + 200,
      );
    } else if (root.dataset.applicationState === "preparing") {
      delete root.dataset.applicationState;
      if (status.textContent === PREPARING) status.textContent = "";
    }
  };
  const READY_WAITING =
    "Your application is ready. Waiting for the employer page to finish opening...";
  // A page that never settles is tried anyway (a reload prepares it again); a tab that stays blank
  // stops being polled, and the next tab event brings it back.
  const LOADING_WAIT_MS = 6_000;
  const BLANK_WAIT_MS = 30_000;
  let waitingSince: number | undefined;
  let recheckTimer: ReturnType<typeof setTimeout> | undefined;
  const offerPendingIntent = async () => {
    if (!extensionConfiguration.applicationExecutionEnabled || busy) return;
    clearTimeout(recheckTimer);
    try {
      const response = (await chrome.runtime.sendMessage({
        action: "application_pending_intent",
      })) as { ok?: boolean; reviewLink?: unknown; preparingUntilMs?: unknown } | undefined;
      if (!response?.ok || typeof response.reviewLink !== "string") {
        const waiting =
          response?.ok === true &&
          typeof response.preparingUntilMs === "number" &&
          response.preparingUntilMs > Date.now();
        showPreparing(waiting ? (response.preparingUntilMs as number) : undefined);
        return;
      }
      // The application is ready, so its review link is known: set it now, whatever the employer
      // page is doing, and show the panel only with the link in place. A link the candidate pasted
      // themselves is left alone.
      if (!input.value || input.value === response.reviewLink) input.value = response.reviewLink;
      showPreparing(undefined);
      const page = await activeTabKey();
      if (page?.key === preparedFor) return;
      if (page?.blank || page?.loading) {
        waitingSince ??= Date.now();
        const waited = Date.now() - waitingSince;
        if (waited < (page.blank ? BLANK_WAIT_MS : LOADING_WAIT_MS)) {
          status.textContent = READY_WAITING;
          recheckTimer = setTimeout(() => void offerPendingIntent(), 1_000);
          return;
        }
        if (page.blank) return;
      }
      waitingSince = undefined;
      // Without access to this page the extension cannot tell whether it is the employer's page.
      // The extension holds the supported employer sites; any other page is opened to it by the
      // toolbar icon. Nothing is selected or cleared yet.
      if (page && !page.visible) {
        status.textContent =
          "Your application is ready. Open the employer page; if nothing happens, click the ApplyDash icon on it.";
        return;
      }
      if (input.value !== response.reviewLink) return;
      status.textContent = "Preparing your application for this page...";
      section.querySelector<HTMLButtonElement>("[data-native-select]")?.click();
    } catch {
      // No pending application, or the extension did not answer: the candidate can still select.
    }
  };
  void offerPendingIntent();
  // A reload is a new document: the extension drops what it selected, so prepare it again once the
  // page has settled.
  followActiveTab(
    () => void offerPendingIntent(),
    undefined,
    undefined,
    () => {
      preparedFor = undefined;
      waitingSince = undefined;
    },
  );
  // Chrome stops an idle extension worker after about 30 seconds, and with it the selected page and
  // the resume, which the worker holds in memory only. While this panel is open, a quiet read every
  // 20 seconds keeps the worker (and so the selection) alive; closing the panel lets it all go.
  if (extensionConfiguration.applicationExecutionEnabled)
    setInterval(() => {
      void Promise.resolve(
        chrome.runtime.sendMessage({ action: "application_pending_intent" }),
      ).catch(() => undefined);
    }, WORKER_HEARTBEAT_MS);
  function discard(message = "") {
    generation++;
    clearTimeout(timer);
    clearTimeout(preparingTimer);
    clearTimeout(recheckTimer);
    delete document.documentElement.dataset.applicationState;
    snapshot = undefined;
    snapshotId = undefined;
    content?.replaceChildren();
    if (status) status.textContent = message;
    if (input) input.value = "";
    busy = false;
    if (load) load.disabled = false;
    return chrome.runtime
      .sendMessage({ action: "application_handoff_clear" })
      .catch(() => undefined);
  }
  function expires() {
    if (snapshot && Date.now() >= snapshot.deadline)
      discard("This preview expired. Load the current review link again.");
  }
  load.addEventListener("click", async () => {
    if (busy) return;
    const link = input.value;
    const clearing = discard();
    busy = true;
    load.disabled = true;
    const current = generation;
    try {
      await clearing;
      if (current !== generation) return;
      const response = await chrome.runtime.sendMessage({
        action: "application_handoff_read",
        reviewLink: link,
      });
      if (current !== generation) return;
      if (
        !response.ok ||
        !response.handoff ||
        typeof response.snapshotId !== "string" ||
        Date.now() >= response.handoff.deadline
      )
        throw new Error();
      snapshot = response.handoff as ApprovedHandoff;
      snapshotId = response.snapshotId;
      const heading = document.createElement("h3");
      heading.textContent = `${snapshot.title} · ${snapshot.company}`;
      content.replaceChildren(heading);
      const returnLink = document.createElement("a");
      returnLink.href = snapshot.reviewLink;
      returnLink.textContent = "Return to application review and record submission status";
      returnLink.target = "_blank";
      returnLink.rel = "noopener noreferrer";
      returnLink.referrerPolicy = "no-referrer";
      content.append(returnLink);
      for (const field of snapshot.fields) {
        const row = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = field.fieldKey;
        const value = document.createElement("p");
        value.textContent = field.value;
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = `Copy ${field.fieldKey}`;
        row.append(label, value);
        if (field.context !== undefined) {
          const context = document.createElement("p");
          context.textContent = `Saved answer context: ${field.context || "none specified"}`;
          row.append(context);
        }
        let confirmationInput: HTMLInputElement | undefined;
        if (field.restricted) {
          const confirmation = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          confirmationInput = checkbox;
          confirmation.append(
            checkbox,
            " I checked this answer and the employer question/context match.",
          );
          copy.disabled = true;
          checkbox.addEventListener("change", () => {
            copy.disabled = !checkbox.checked;
          });
          row.append(confirmation);
        }
        copy.addEventListener("click", async () => {
          expires();
          if (
            busy ||
            !snapshot ||
            !snapshotId ||
            current !== generation ||
            (field.restricted && !confirmationInput?.checked)
          )
            return;
          busy = true;
          copy.disabled = true;
          try {
            const result = await chrome.runtime.sendMessage({
              action: "application_handoff_copy",
              snapshotId,
              fieldKey: field.fieldKey,
              confirmed: true,
            });
            expires();
            if (current !== generation || !snapshot) return;
            if (
              !result.ok ||
              typeof result.value !== "string" ||
              result.value !== field.value ||
              (field.restricted && !confirmationInput?.checked)
            )
              throw new Error();
            await navigator.clipboard.writeText(result.value);
            if (current === generation)
              status.textContent =
                "Approved answer copied. Check it in the employer form before submitting yourself.";
          } catch {
            if (current === generation) discard(HANDOFF_FAILURE);
          } finally {
            if (current === generation) {
              busy = false;
              if (confirmationInput) confirmationInput.checked = false;
              copy.disabled = field.restricted;
            }
          }
        });
        row.append(copy);
        content.append(row);
      }
      timer = setTimeout(expires, snapshot.deadline - Date.now());
      status.textContent =
        "Manual completion only. No fields are filled and nothing is submitted by the extension.";
    } catch {
      if (current === generation) discard(HANDOFF_FAILURE);
    } finally {
      if (current === generation) {
        busy = false;
        load.disabled = false;
      }
    }
  });
  clear.addEventListener("click", () => discard());
  section
    .querySelector<HTMLButtonElement>("[data-handoff-form]")
    ?.addEventListener("click", async () => {
      if (busy) return;
      const reviewLink = input.value;
      const clearing = discard();
      busy = true;
      load.disabled = true;
      const current = generation;
      try {
        await clearing;
        if (current !== generation) return;
        const response = await chrome.runtime.sendMessage({
          action: "application_form_capture",
          reviewLink,
        });
        if (current !== generation) return;
        if (!response.ok || typeof response.observedForm !== "string") throw new Error();
        await navigator.clipboard.writeText(response.observedForm);
        if (current === generation)
          status.textContent =
            "Question structure copied without entered answers. Paste it into the matching application's question review within 60 seconds. Clipboard copies remain under your control.";
      } catch {
        if (current === generation) void discard(FORM_CAPTURE_FAILURE);
      } finally {
        if (current === generation) {
          busy = false;
          load.disabled = false;
        }
      }
    });
  document.querySelector("#login")?.addEventListener("click", () => discard());
  document.querySelector("#logout")?.addEventListener("click", () => discard());
  // A token refresh renews the same account's session and ends nothing; anything else does.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "session" &&
      Object.hasOwn(changes, "auth0Session") &&
      !isTokenRenewal(changes.auth0Session)
    )
      void discard();
  });
  window.addEventListener("pagehide", () => discard());
  window.addEventListener("focus", expires);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") discard();
    else expires();
  });
}
