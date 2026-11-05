import type { ApplicationSubmissionResultRequest } from "@ai-job-apply/api-contracts";
import { buildFillPlan, type PacketValue } from "@ai-job-apply/ats-sdk/plan";
import type { AdapterRegistry } from "@ai-job-apply/ats-sdk/registry";
import { writtenValueMatches } from "./field-value";
import type { TransferredNativeFile } from "./native-material-transfer";
import type {
  ApplicationInspection,
  ApplicationProvider,
  ExecutionProfile,
} from "./providers/types";
import { revealControl } from "./reveal";

const unavailable = () => Error("ApplicationExecutionUnavailable");

/** One document/attempt command, already durably dispatched. No retry or navigation recovery. */
export async function executeApplication(options: {
  provider: ApplicationProvider;
  document: Document;
  employerUrl: string;
  documentId: string;
  formHash: string;
  packetHash: string;
  attemptId: string;
  packet: readonly PacketValue[];
  files: readonly TransferredNativeFile[];
  profile: Readonly<ExecutionProfile>;
  registry: AdapterRegistry;
  deadline: number;
  signal: AbortSignal;
  /** Must atomically spend the document/attempt guard before the first employer effect. */
  claim(): boolean;
  /** Fresh protected owning attempt/job/packet/material/document proof; no approval reopening. */
  revalidateDispatched(): Promise<void>;
  /** Fill and attach for the candidate's own review and stop: nothing is submitted. */
  fillOnly?: boolean;
  /** Reports the step that is starting, so a refusal can say where it stopped. Never any content. */
  onStage?(stage: string): void;
  /** Pause after scrolling to each control being filled, so the candidate can watch. Default none. */
  paceMs?: number;
}): Promise<ApplicationSubmissionResultRequest> {
  const { document } = options;
  let where = "";
  let detail = "";
  const mark = (stage: string) => {
    where = stage;
    detail = "";
    options.onStage?.(stage);
  };
  const { provider } = options;
  const profile = Object.freeze(structuredClone(options.profile));
  const view = document.defaultView;
  const deadline = options.deadline;
  const attachments: { control: HTMLInputElement; file: File; ref: string }[] = [];
  const clearAttachments = () => {
    for (const { control } of attachments) {
      try {
        Object.getOwnPropertyDescriptor(view?.HTMLInputElement.prototype, "value")?.set?.call(
          control,
          "",
        );
      } catch {
        /* A detached document cannot authorize another effect. */
      }
    }
    attachments.length = 0;
  };
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
    clearAttachments();
  };
  options.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
  if (options.signal.aborted) abort();
  let inspection: ApplicationInspection | undefined;
  let submitted = false;
  let claimed = false;
  // A fill-only run leaves the attached files on the page for the candidate to review.
  let keepForReview = false;
  const stopped = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(unavailable()), { once: true });
  });
  // An already aborted operation may never enter a race; keep its rejection handled.
  void stopped.catch(() => undefined);
  const atExpectedUrl = () =>
    document.location.href === options.employerUrl ||
    (submitted &&
      provider.isConfirmationUrl?.(options.employerUrl, document.location.href) === true);
  const current = () => {
    if (
      !view ||
      controller.signal.aborted ||
      !atExpectedUrl() ||
      Date.now() >= deadline ||
      deadline > Date.now() + 60_000 ||
      !Number.isFinite(deadline) ||
      options.registry.executionStatus(
        provider.adapterId,
        profile.variantId,
        profile.adapterVersion,
        profile.implementationSha256,
        new Date(),
      ).mode !== "autofill"
    )
      throw unavailable();
  };
  const fresh = async () => {
    current();
    await Promise.race([options.revalidateDispatched(), stopped]);
    current();
  };
  const actionable = (element: Element) => {
    if (!view || element.matches(":disabled") || element.hasAttribute("readonly"))
      throw unavailable();
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node);
      if (
        node.hasAttribute("hidden") ||
        node.hasAttribute("inert") ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility) ||
        style.opacity === "0"
      )
        throw unavailable();
    }
  };
  const confirmationText = profile.confirmationText
    ? new RegExp(profile.confirmationText, "iu")
    : undefined;
  const confirmationNodes = () =>
    Array.from(document.querySelectorAll(profile.confirmationSelector)).filter(
      (node) =>
        (!profile.confirmationLeafOnly || node.childElementCount === 0) &&
        (!confirmationText || confirmationText.test(node.textContent ?? "")),
    );
  const confirmation = () => {
    const matches = confirmationNodes();
    if (matches.length !== 1) return undefined;
    const node = matches[0];
    if (!node?.isConnected) return undefined;
    actionable(node);
    if (!profile.confirmationReferenceAttribute) return { node, reference: undefined };
    const reference = node.getAttribute(profile.confirmationReferenceAttribute);
    return reference && /^[a-zA-Z0-9_-]{1,200}$/u.test(reference) ? { node, reference } : undefined;
  };
  try {
    mark("revalidate");
    await fresh();
    mark("inspect");
    if (!view || confirmationNodes().length !== 0) throw unavailable();
    inspection = provider.inspect(document, options.employerUrl);
    const bytes = new TextEncoder().encode(inspection.structure);
    const digest = new Uint8Array(
      await Promise.race([crypto.subtle.digest("SHA-256", bytes), stopped]),
    );
    bytes.fill(0);
    const formHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    digest.fill(0);
    mark("form-hash");
    if (formHash !== options.formHash) throw unavailable();
    current();
    const files = options.files;
    if (
      files.length < 1 ||
      files.length > 2 ||
      new Set(files.map((file) => file.kind)).size !== files.length
    )
      throw unavailable();
    mark("plan");
    const plan = buildFillPlan(inspection.form, options.packet, {
      resume: files.some(
        (file) => file.kind === "tailored_resume" || file.kind === "uploaded_resume",
      ),
      coverLetter: files.some((file) => file.kind === "cover_letter"),
    });
    // A challenge page is prepared completely but never submitted: the candidate completes the
    // challenge and submits themselves (ADR-046 amendment). The click below is unreachable for it.
    // A fill-only run is the same preparation the candidate reviews and submits themselves.
    const takeover = plan.requiresTakeover || options.fillOnly === true;
    const plannedAttachments = plan.actions.filter((action) => action.kind === "attach_artifact");
    if (
      plannedAttachments.length !== files.length ||
      files.some(
        (file) =>
          plannedAttachments.filter(
            (action) =>
              action.fieldKey ===
              (file.kind === "cover_letter" ? "documents.cover_letter" : "documents.resume"),
          ).length !== 1,
      )
    )
      throw unavailable();
    mark("root");
    const root = provider.root(document);
    // Required candidate-only controls may already be completed; inspect validity, never values.
    for (const action of takeover ? [] : plan.actions) {
      if (action.kind !== "require_user") continue;
      const required =
        inspection.form.fields.find((field) => field.ref === action.ref)?.required === true;
      if (!provider.controlsSatisfied(inspection.resolve(action.ref), required))
        return { kind: "precondition_failed" };
    }
    mark("submit-control");
    const button = provider.submitControl(root, profile);
    actionable(button);
    mark("claim");
    await fresh();
    if (!options.claim()) throw unavailable();
    claimed = true;
    mark("fill");
    const filled = await provider.fill(inspection, options.packet, {
      registry: options.registry,
      variantId: profile.variantId,
      deadline,
      signal: controller.signal,
      revalidateApproval: fresh,
      throwOnFailure: true,
      onField: (fieldKey) => {
        detail = fieldKey;
      },
      reveal: (control) => revealControl(control, options.paceMs ?? 0, stopped),
    });
    const expectedFills = plan.actions.filter(
      (action) => action.kind === "fill" || action.kind === "select",
    );
    mark("fill-check");
    if (filled.filled.length !== expectedFills.length) throw unavailable();
    const requireWrittenFields = () => {
      for (const action of expectedFills) {
        detail = action.fieldKey;
        const controls = inspection?.resolve(action.ref);
        const control = controls?.[0];
        if (controls?.length !== 1 || !control) throw unavailable();
        actionable(control);
        if (action.kind === "select") {
          if (
            !(control instanceof view.HTMLSelectElement) ||
            control.multiple ||
            control.selectedOptions.length !== 1 ||
            control.selectedOptions[0]?.textContent?.replace(/\s+/gu, " ").trim() !==
              action.option ||
            control.selectedOptions[0]?.disabled ||
            control.selectedOptions[0]?.parentElement?.hasAttribute("disabled")
          )
            throw unavailable();
        } else if (control instanceof view.HTMLInputElement && control.type === "checkbox") {
          if (control.checked !== action.value) throw unavailable();
        } else if (
          !(
            control instanceof view.HTMLInputElement || control instanceof view.HTMLTextAreaElement
          ) ||
          !writtenValueMatches(control, String(action.value))
        )
          throw unavailable();
      }
      detail = "";
    };
    mark("written-fields");
    requireWrittenFields();
    const requireAttachments = () => {
      for (const { control, file, ref } of attachments) {
        if (inspection?.resolve(ref)[0] !== control) throw unavailable();
        actionable(control);
        if (
          control.files?.length !== 1 ||
          control.files[0] !== file ||
          control.files[0].size !== file.size ||
          control.files[0].type !== file.type ||
          control.files[0].name !== file.name ||
          !control.validity.valid
        )
          throw unavailable();
      }
    };
    mark("attach");
    for (const action of plan.actions) {
      if (action.kind !== "attach_artifact") continue;
      await fresh();
      requireAttachments();
      requireWrittenFields();
      const controls = inspection.resolve(action.ref);
      const control = controls[0];
      if (
        controls.length !== 1 ||
        !(control instanceof view.HTMLInputElement) ||
        control.type !== "file" ||
        control.multiple ||
        control.files?.length
      )
        throw unavailable();
      actionable(control);
      await revealControl(control, options.paceMs ?? 0, stopped);
      current();
      const file = files.find((candidate) =>
        action.fieldKey === "documents.resume"
          ? candidate.kind === "tailored_resume" || candidate.kind === "uploaded_resume"
          : candidate.kind === "cover_letter",
      );
      const kind = file?.kind ?? "cover_letter";
      // A generated file is at most 300 KB; the candidate's own original may be up to 2 MiB.
      const maximumBytes = kind === "uploaded_resume" ? 2 * 1024 * 1024 : 300_000;
      if (!file || file.bytes.byteLength < 1 || file.bytes.byteLength > maximumBytes)
        throw unavailable();
      const suffix = file.format === "pdf" ? ".pdf" : ".docx";
      const accept = control.accept
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (
        accept.length &&
        !accept.includes(suffix) &&
        !accept.includes(file.mediaType.toLowerCase())
      )
        throw unavailable();
      const transfer = new view.DataTransfer();
      const copy = new Uint8Array(file.bytes);
      try {
        transfer.items.add(
          new view.File([copy], `${kind === "uploaded_resume" ? "resume" : kind}${suffix}`, {
            type: file.mediaType,
          }),
        );
      } finally {
        copy.fill(0);
      }
      const intended = transfer.files[0];
      if (!intended) throw unavailable();
      attachments.push({ control, file: intended, ref: action.ref });
      current();
      inspection.resolve(action.ref);
      control.files = transfer.files;
      let swapped = false;
      for (const event of ["input", "change"]) {
        current();
        requireWrittenFields();
        requireAttachments();
        inspection.resolve(action.ref);
        actionable(control);
        if (
          control.files?.length !== 1 ||
          control.files[0]?.size !== file.bytes.byteLength ||
          !control.validity.valid
        )
          throw unavailable();
        control.dispatchEvent(new view.Event(event, { bubbles: true }));
      }
      if (provider.attachmentAccepted) {
        // Some boards replace the upload control with their own display once they take the file.
        const settleBy = Math.min(deadline, Date.now() + 2_000);
        while (control.isConnected && Date.now() < settleBy)
          await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, 50)), stopped]);
        if (!control.isConnected) {
          // The board may show its upload progress first; give it a moment to show the file.
          const acceptedBy = Math.min(deadline, Date.now() + 8_000);
          while (!provider.attachmentAccepted(root, intended.name) && Date.now() < acceptedBy)
            await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, 100)), stopped]);
          if (!provider.attachmentAccepted(root, intended.name)) throw unavailable();
          swapped = true;
          attachments.splice(
            attachments.findIndex((candidate) => candidate.control === control),
            1,
          );
        }
      }
      if (!swapped) {
        inspection.resolve(action.ref);
        if (control.files?.length !== 1 || !control.validity.valid) throw unavailable();
      }
    }
    mark("final-check");
    await fresh();
    requireWrittenFields();
    requireAttachments();
    for (const field of inspection.form.fields)
      if (field.type !== "file") inspection.resolve(field.ref);
    if (
      !root.isConnected ||
      (!takeover && !provider.rootValid(root)) ||
      confirmationNodes().length !== 0 ||
      provider.submitControl(root, profile) !== button
    )
      throw unavailable();
    actionable(button);
    current();
    if (takeover) {
      keepForReview = options.fillOnly === true;
      return { kind: "challenge_required" };
    }
    // Spend synchronously before click. No later code path invokes click again.
    submitted = true;
    const clickedAt = Date.now();
    button.click();
    while (Date.now() < deadline) {
      await fresh();
      if (provider.challengePresent(document)) return { kind: "challenge_required" };
      const observed = confirmation();
      if (observed) {
        const observedAt = Date.now();
        const encoded = new TextEncoder().encode(
          JSON.stringify({
            v: 1,
            attemptId: options.attemptId,
            packetHash: options.packetHash,
            adapterVersion: profile.adapterVersion,
            variantId: profile.variantId,
            documentUrl: options.employerUrl,
            documentId: options.documentId,
            clickedAt,
            observedAt,
            ...(observed.reference ? { reference: observed.reference } : {}),
          }),
        );
        const hash = new Uint8Array(
          await Promise.race([crypto.subtle.digest("SHA-256", encoded), stopped]),
        );
        encoded.fill(0);
        const fingerprintSha256 = [...hash]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        hash.fill(0);
        await fresh();
        if (provider.challengePresent(document)) return { kind: "challenge_required" };
        const finalConfirmation = confirmation();
        if (
          finalConfirmation?.node !== observed.node ||
          finalConfirmation.reference !== observed.reference
        )
          throw unavailable();
        return {
          kind: "confirmed",
          confirmation: {
            kind: "provider_confirmation_page",
            observedAt: new Date(observedAt).toISOString(),
            fingerprintSha256,
            ...(observed.reference ? { providerReference: observed.reference } : {}),
          },
        };
      }
      // The form may be replaced by the confirmation message, so only the document-wide challenge
      // scan above applies here; a missing message ends in a timeout the candidate reconciles.
      await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, 200)), stopped]);
    }
    return { kind: "timeout" };
  } catch (error) {
    // The step, field name and error kind only: never a value.
    const kind =
      error instanceof Error ? error.message.replace(/[^A-Za-z0-9]/gu, "").slice(0, 40) : "";
    options.onStage?.(
      `${where}${detail ? `:${detail.replace(/[^A-Za-z0-9._-]/gu, "").slice(0, 40)}` : ""}${kind ? ` ${kind}` : ""}`,
    );
    return { kind: submitted || claimed ? "unrecognized_response" : "precondition_failed" };
  } finally {
    if (keepForReview) controller.abort();
    else abort();
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    inspection?.dispose();
    if (!keepForReview) clearAttachments();
  }
}
