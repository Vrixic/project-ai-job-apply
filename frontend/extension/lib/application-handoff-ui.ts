import type { ApprovedHandoff } from "./application-handoff";
import { FORM_CAPTURE_FAILURE, HANDOFF_FAILURE } from "./application-handoff";
import { extensionConfiguration } from "./config";

/** Popup/side-panel memory only. No document content or persistent handoff queue. */
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
  const nativeInstructions = section.querySelector<HTMLElement>("[data-native-instructions]");
  if (nativeInstructions && extensionConfiguration.applicationExecutionEnabled)
    nativeInstructions.hidden = false;
  for (const action of ["select", "clear", "apply"] as const) {
    const button = section.querySelector<HTMLButtonElement>(`[data-native-${action}]`);
    if (!button || !extensionConfiguration.applicationExecutionEnabled) continue;
    button.hidden = false;
    button.addEventListener("click", async () => {
      const ownsBusy = action !== "clear";
      if (busy && ownsBusy) return;
      if (ownsBusy) busy = true;
      button.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage(
          action === "select"
            ? { action: "application_native_select", reviewLink: input.value }
            : action === "apply"
              ? { action: "application_native_apply", reviewLink: input.value }
              : { action: "application_native_clear" },
        );
        if (action === "apply") {
          status.textContent =
            response.ok && response.outcome === "confirmed"
              ? "The employer confirmed submission. Return to the application workspace to view history."
              : response.outcome === "unknown"
                ? "The submission outcome is uncertain. Return to the workspace to review it; do not submit again."
                : "Not submitted by the extension, or not confirmed. Check the employer page, finish by hand if needed, then record the outcome in the application workspace.";
          return;
        }
        if (!response.ok) throw Error();
        status.textContent =
          action === "select"
            ? response.resume === "uploaded"
              ? "Employer tab selected. Your own uploaded resume is ready to attach. Transfer availability still depends on adapter acceptance."
              : "Employer tab selected for one minute. Your generated resume is sent from the application workspace tab automatically; keep that tab open. Transfer availability still depends on adapter acceptance."
            : "Approved file transfer cleared. If Apply had started, review the workspace before any further submission.";
      } catch {
        status.textContent =
          action === "apply"
            ? "Apply could not complete. Review the application workspace before trying any further submission."
            : "The file transfer could not be selected. Check the employer tab, current approval and extension sign-in.";
      } finally {
        if (ownsBusy) busy = false;
        button.disabled = false;
      }
    });
  }
  // After Apply on the website the extension already holds the application's identifiers. Opening
  // it on the employer page selects that tab with no pasted link; the candidate then confirms.
  if (extensionConfiguration.applicationExecutionEnabled) {
    void chrome.runtime
      .sendMessage({ action: "application_pending_intent" })
      .then((response: { ok?: boolean; reviewLink?: unknown } | undefined) => {
        if (!response?.ok || typeof response.reviewLink !== "string" || input.value) return;
        input.value = response.reviewLink;
        status.textContent = "Preparing your application for this page...";
        section.querySelector<HTMLButtonElement>("[data-native-select]")?.click();
      })
      .catch(() => undefined);
  }
  function discard(message = "") {
    generation++;
    clearTimeout(timer);
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && Object.hasOwn(changes, "auth0Session")) void discard();
  });
  window.addEventListener("pagehide", () => discard());
  window.addEventListener("focus", expires);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") discard();
    else expires();
  });
}
