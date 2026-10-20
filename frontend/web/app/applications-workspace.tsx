"use client";

import {
  type Application,
  type ApplicationPacketPreparation,
  COVER_LETTER_DISCLOSURE_VERSION,
  type PrepareApplicationPacketRequest,
} from "@ai-job-apply/api-contracts";
import { validateApplication } from "@ai-job-apply/api-contracts/browser-validators";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { materialDeadline } from "../lib/application-material-lifetime";
import {
  preparationFailureCopy,
  prepareApplicationPacket,
} from "../lib/application-preparation-client";
import {
  APPLICATIONS_CHANGED_EVENT,
  type ApplicationsCallResult,
  applicationsCall,
  commandKey,
  findLiveApplication,
  sha256Hex,
  startManualApplicationSubmission,
} from "../lib/applications-client";
import {
  applyPlan,
  GENERATION_POLL_LIMIT_MS,
  type GenerationView,
  generationView,
  packetResumeSource,
} from "../lib/apply-flow";
import {
  discardTransferredNativeMaterials,
  type NativeExtensionMessenger,
  nativeExtensionId,
  nativeExtensionMessenger,
  sendApplyIntent,
  transferWhenSelected,
} from "../lib/native-extension-transfer";
import {
  announceNativeMaterialSignOut,
  NATIVE_MATERIAL_SIGN_OUT_CHANNEL,
} from "../lib/native-material-sign-out-signal";
import { ApplicationPreparationProgress } from "./application-preparation-progress";
import { type ApplicationReviewActions, ApplicationReviewPanel } from "./application-review-panel";
import {
  acknowledgementsForApply,
  applyBlockers,
  canApply,
  reviewGroups,
} from "./application-review-state";
import { ApplyPanel, type ExtensionHandoffState, safeApplyUrl } from "./apply-panel";
import { CoverLetterSection, GeneratedResumePanel, useTicker } from "./generated-resume-panel";
import type { ManualFormObservation } from "./manual-form-confirmation";
import {
  type SavedApplicationAnswerSelection,
  SavedApplicationAnswers,
} from "./saved-application-answers";
import { useMaterialExpiry } from "./use-material-expiry";

type Entries = Readonly<Record<string, string | boolean>>;
const coverLetterUiEnabled = process.env.NEXT_PUBLIC_COVER_LETTER_PREPARATION_UI === "enabled";
const savedAnswersUiEnabled =
  process.env.NEXT_PUBLIC_APPLICATION_SAVED_ANSWER_SELECTION_UI === "enabled";
const nativeMaterialsUiEnabled = () => process.env.NEXT_PUBLIC_NATIVE_MATERIAL_UI === "enabled";

const GENERATION_UNAVAILABLE_COPY =
  "Resume generation is not available right now. You can still apply with your uploaded resume.";

/**
 * One job's apply flow, in the order a candidate thinks about it: read the position, then either
 * Generate a resume (a loading step that resolves by itself to ready, failed or expired) or apply
 * directly, then Apply. Apply opens the employer's page and arms the extension with the exact
 * resume to use: the valid generated PDF, otherwise the candidate's own uploaded resume. Nothing is
 * submitted here or by the extension; the candidate confirms the final submit on the employer page.
 */
export function ApplicationsWorkspace({
  jobId,
  applicationId,
  applyUrl,
  fetchImplementation,
  coverLetterPreparationEnabled = coverLetterUiEnabled,
  savedAnswerSelectionEnabled = savedAnswersUiEnabled,
}: {
  jobId: string;
  applicationId?: string;
  /** The employer's application page, from the job's own source link. */
  applyUrl?: string | undefined;
  fetchImplementation?: typeof globalThis.fetch;
  coverLetterPreparationEnabled?: boolean;
  savedAnswerSelectionEnabled?: boolean;
}) {
  return (
    <JobApplicationWorkspace
      key={`${jobId}:${applicationId ?? ""}`}
      jobId={jobId}
      {...(applicationId ? { applicationId } : {})}
      applyUrl={applyUrl}
      coverLetterPreparationEnabled={coverLetterPreparationEnabled}
      savedAnswerSelectionEnabled={savedAnswerSelectionEnabled}
      {...(fetchImplementation ? { fetchImplementation } : {})}
    />
  );
}

function JobApplicationWorkspace({
  jobId,
  applicationId,
  applyUrl,
  fetchImplementation,
  coverLetterPreparationEnabled,
  savedAnswerSelectionEnabled,
}: Parameters<typeof ApplicationsWorkspace>[0]) {
  const headingId = useId();
  const [nativeMaterials] = useState(nativeMaterialsUiEnabled);
  const [createKey] = useState(() => `web-create-${crypto.randomUUID()}`);
  const [application, setApplication] = useState<Application>();
  const [entries, setEntries] = useState<Entries>({});
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [preparation, setPreparation] = useState<ApplicationPacketPreparation>();
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const [shownResumeHash, setShownResumeHash] = useState<string>();
  const [pollExpired, setPollExpired] = useState(false);
  // The hand-off belongs to one packet: it is ignored for any other, with no reset race.
  const [handoffState, setHandoffState] = useState<{
    packetHash: string;
    state: ExtensionHandoffState;
  }>();
  // The packet the candidate just applied with: its outcome prompt opens by itself.
  const [appliedPacketHash, setAppliedPacketHash] = useState<string>();
  const handoffPacket = useRef<string | undefined>(undefined);
  const prepareIntent = useRef<{ signature: string; key: string } | undefined>(undefined);
  const reconciliationIntent = useRef<{ signature: string; body: unknown } | undefined>(undefined);
  const lifetime = useRef(new AbortController());
  const starting = useRef(false);
  const handoffAbort = useRef<AbortController | undefined>(undefined);
  const transferred = useRef<
    | {
        messenger: NativeExtensionMessenger;
        extensionId: string;
        receipt: Parameters<typeof discardTransferredNativeMaterials>[2];
      }
    | undefined
  >(undefined);

  const packet = application?.currentPacket;
  const handoff: ExtensionHandoffState =
    handoffState && handoffState.packetHash === packet?.packetHash
      ? handoffState.state
      : { phase: "none" };
  const material = packet?.temporaryMaterials?.find((item) => item.kind === "tailored_resume");
  // Flips the page at the fixed expiry even when it is idle in a background tab.
  useMaterialExpiry(material ? materialDeadline(material) : undefined);
  const baseView = generationView(application, nativeMaterials, Date.now());
  const view: GenerationView =
    baseView.kind === "preparing" && pollExpired
      ? { kind: "failed", code: "generation_timed_out" }
      : baseView;
  const clock = useTicker(
    view.kind === "preparing" || view.kind === "ready",
    view.kind === "preparing" ? 1000 : 15_000,
  );
  const groups = application ? reviewGroups(application) : undefined;
  const blockers = groups ? applyBlockers(groups, acknowledged) : [];
  const href = safeApplyUrl(applyUrl);

  const acceptApplication = useCallback((next: Application) => {
    setApplication((current) =>
      current?.id === next.id && current.revision > next.revision ? current : next,
    );
  }, []);
  const withdrawTransfer = useCallback(() => {
    handoffAbort.current?.abort();
    handoffAbort.current = undefined;
    const previous = transferred.current;
    transferred.current = undefined;
    if (previous)
      discardTransferredNativeMaterials(previous.messenger, previous.extensionId, previous.receipt);
  }, []);
  const preparationResolved = useCallback(
    (operation: ApplicationPacketPreparation, current: Application) => {
      acceptApplication(current);
      setPreparation(undefined);
      setNotice(
        operation.state === "failed"
          ? preparationFailureCopy(operation.errorCode)
          : "Your cover letter is ready.",
      );
    },
    [acceptApplication],
  );
  const options = {
    get signal() {
      return lifetime.current.signal;
    },
    ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
  };

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      withdrawTransfer();
    };
  }, [withdrawTransfer]);

  // Withdraw everything held in this page when the candidate signs out here or in another tab.
  useEffect(() => {
    let channel: BroadcastChannel | undefined;
    const leave = () => {
      withdrawTransfer();
      setHandoffState(undefined);
    };
    try {
      channel = new BroadcastChannel(NATIVE_MATERIAL_SIGN_OUT_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === "withdraw") leave();
      };
    } catch {
      // Without the channel only this tab's own sign-out and unload clear the held copies.
    }
    const signingOut = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const target = new URL(anchor.href);
      if (target.origin === window.location.origin && target.pathname === "/auth/logout") {
        announceNativeMaterialSignOut();
        leave();
      }
    };
    document.addEventListener("click", signingOut, true);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("click", signingOut, true);
      channel?.close();
      window.removeEventListener("pagehide", leave);
    };
  }, [withdrawTransfer]);

  // A new packet means new answers to check and a new exact resume to have seen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the packet identity changes.
  useEffect(() => {
    setAcknowledged(new Set());
    setShownResumeHash(undefined);
    // Only a hand-off for another packet is withdrawn; the current packet's own is kept.
    if (handoffPacket.current !== undefined && handoffPacket.current !== packet?.packetHash) {
      handoffPacket.current = undefined;
      withdrawTransfer();
    }
  }, [packet?.id, packet?.packetHash]);

  useEffect(() => {
    if (application?.packetAvailability === "withheld") setEntries({});
  }, [application?.packetAvailability]);

  // Open the candidate's existing live application for this job, if there is one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per job; `options` is derived from a stable prop.
  useEffect(() => {
    const controller = new AbortController();
    setChecking(true);
    setLookupFailed(false);
    const timeout = setTimeout(() => {
      controller.abort();
      setChecking(false);
      setLookupFailed(Boolean(applicationId));
    }, 20_000);
    const lookup = async () => {
      if (!applicationId)
        return findLiveApplication(jobId, { ...options, signal: controller.signal });
      const result = await applicationsCall("GET", `/api/platform/applications/${applicationId}`, {
        ...options,
        signal: controller.signal,
      });
      return result.ok &&
        result.application.id === applicationId &&
        result.application.canonicalJobId === jobId
        ? { ok: true as const, application: result.application }
        : { ok: false as const };
    };
    void lookup().then((found) => {
      if (controller.signal.aborted) return;
      clearTimeout(timeout);
      if (found.ok && found.application) setApplication(found.application);
      if (applicationId && (!found.ok || !found.application)) setLookupFailed(true);
      setChecking(false);
    });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [jobId, applicationId, lookupAttempt]);

  // While generating, follow the application by itself until it is ready, failed or expired.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart only when the application or its generation state changes.
  useEffect(() => {
    const id = application?.id;
    if (!id || baseView.kind !== "preparing") return;
    setPollExpired(false);
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (controller.signal.aborted) return;
      if (Date.now() - startedAt > GENERATION_POLL_LIMIT_MS) {
        setPollExpired(true);
        return;
      }
      const result = await applicationsCall("GET", `/api/platform/applications/${id}`, {
        ...options,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (
        result.ok &&
        validateApplication(result.application) &&
        result.application.id === id &&
        result.application.canonicalJobId === jobId
      )
        acceptApplication(result.application);
      timer = setTimeout(() => void read(), 3_000);
    };
    timer = setTimeout(() => void read(), 3_000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [application?.id, baseView.kind]);

  // Extension submission changes server state while this workspace is in another tab.
  useEffect(() => {
    const id = application?.id;
    if (
      !id ||
      !["approved", "submitting", "takeover", "reconciliation_required"].includes(
        application.status,
      )
    )
      return;
    let pending: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const refreshOnReturn = () => {
      if (disposed || pending || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      pending = controller;
      timer = setTimeout(() => controller.abort(), 10_000);
      void applicationsCall("GET", `/api/platform/applications/${id}`, {
        signal: controller.signal,
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      })
        .then((result) => {
          if (
            disposed ||
            controller.signal.aborted ||
            !result.ok ||
            !validateApplication(result.application) ||
            result.application.id !== id ||
            result.application.canonicalJobId !== jobId
          )
            return;
          acceptApplication(result.application);
          if (result.application.status === "applied")
            window.dispatchEvent(new Event(APPLICATIONS_CHANGED_EVENT));
        })
        .finally(() => {
          clearTimeout(timer);
          if (pending === controller) pending = undefined;
        });
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      disposed = true;
      clearTimeout(timer);
      pending?.abort();
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [application?.id, application?.status, jobId, fetchImplementation, acceptApplication]);

  async function refresh(id: string) {
    const latest = await applicationsCall("GET", `/api/platform/applications/${id}`, options);
    if (latest.ok && !lifetime.current.signal.aborted && latest.application.id === id)
      acceptApplication(latest.application);
  }

  /** Applies a result to state; a failure sets the fixed copy and throws so the caller stops. */
  async function settle(result: ApplicationsCallResult, id?: string): Promise<Application> {
    if (lifetime.current.signal.aborted) throw new Error("Workspace closed");
    if (result.ok) {
      acceptApplication(result.application);
      if (result.application.status === "applied")
        window.dispatchEvent(new Event(APPLICATIONS_CHANGED_EVENT));
      return result.application;
    }
    setNotice(result.message);
    if (result.code === "application_revision_conflict" && id) await refresh(id);
    throw new Error(result.code);
  }

  async function ensureApplication(): Promise<Application> {
    if (application) return application;
    const result = await applicationsCall("POST", "/api/platform/applications", {
      ...options,
      body: { jobId },
      idempotencyKey: createKey,
    });
    if (!result.ok && result.code === "application_already_exists") {
      // A live application appeared since this page loaded: use it instead of failing.
      const found = await findLiveApplication(jobId, options);
      if (found.ok && found.application) {
        setApplication(found.application);
        return found.application;
      }
    }
    return settle(result);
  }

  /** An approved application is reopened before a new packet can be prepared; nothing else changes. */
  async function ensureEditable(current: Application): Promise<Application> {
    if (current.status !== "approved") return current;
    return settle(
      await applicationsCall("POST", `/api/platform/applications/${current.id}/reopen`, {
        ...options,
        body: { expectedRevision: current.revision },
        idempotencyKey: commandKey("reopen", current.id, current.revision),
      }),
      current.id,
    );
  }

  /** Builds a new packet. Returns the application, or nothing when a cover-letter operation started. */
  async function prepare(
    current: Application,
    settings: {
      resume: "generate" | "uploaded";
      answers?: Entries;
      includeCoverLetter?: boolean;
      selected?: SavedApplicationAnswerSelection;
    },
  ): Promise<Application | undefined> {
    // A withheld packet grants no authority to reuse answers kept in this workspace's memory.
    const answers = current.packetAvailability === "withheld" ? {} : (settings.answers ?? entries);
    const previousEntries = Object.fromEntries(
      (current.currentPacket?.fields ?? [])
        .filter(
          (field) =>
            field.origin === "user_entered" &&
            (typeof field.value === "string" || typeof field.value === "boolean"),
        )
        .map((field) => [field.fieldKey, field.value as string | boolean]),
    );
    // Reconstruct only exact selection metadata; values remain owned by the protected vault read.
    const selections: PrepareApplicationPacketRequest["vaultSelections"] =
      settings.selected?.vaultSelections ??
      (current.currentPacket?.fields ?? []).flatMap((field) =>
        field.origin === "answer_vault" &&
        field.vaultReference &&
        !Object.hasOwn(answers, field.fieldKey)
          ? [
              {
                id: field.vaultReference.id,
                version: field.vaultReference.version,
                fieldKey: field.fieldKey,
                context: field.vaultReference.context,
                questionHash: field.vaultReference.questionHash,
                meaningConfirmed: true as const,
              },
            ]
          : [],
      );
    const form = settings.selected?.form ?? current.currentPacket?.form;
    const selectedKeys = new Set(selections.map((selection) => selection.fieldKey));
    const userEntries = Object.entries({ ...previousEntries, ...answers })
      .filter(([fieldKey]) => !selectedKeys.has(fieldKey))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fieldKey, value]) => ({ fieldKey, value }));
    const coverLetter = settings.includeCoverLetter
      ? {
          disclosure: {
            noticeVersion: COVER_LETTER_DISCLOSURE_VERSION,
            acknowledged: true as const,
          },
        }
      : undefined;
    const signature = JSON.stringify([
      current.id,
      current.revision,
      settings.resume,
      userEntries,
      coverLetter,
      form,
      selections,
    ]);
    if (prepareIntent.current?.signature !== signature)
      prepareIntent.current = { signature, key: `web-prepare-${crypto.randomUUID()}` };
    const result = await prepareApplicationPacket(
      current.id,
      {
        expectedRevision: current.revision,
        ...(userEntries.length ? { userEntries } : {}),
        ...(coverLetter ? { coverLetter } : {}),
        ...(form ? { form } : {}),
        ...(selections.length ? { vaultSelections: selections } : {}),
        ...(settings.resume === "uploaded" ? { resume: "uploaded" as const } : {}),
      },
      prepareIntent.current.key,
      options,
    );
    if (lifetime.current.signal.aborted) return undefined;
    if (result.ok && result.kind === "preparation") {
      setPreparation(result.preparation);
      return undefined;
    }
    return settle(result.ok ? { ok: true, application: result.application } : result, current.id);
  }

  async function run(action: () => Promise<void>) {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
    } catch {
      // The notice already carries the fixed copy for this failure.
    } finally {
      starting.current = false;
      if (!lifetime.current.signal.aborted) setBusy(false);
    }
  }

  function generate(withCoverLetter = false) {
    void run(async () => {
      let current = await ensureApplication();
      current = await ensureEditable(current);
      const next = await prepare(current, {
        resume: "generate",
        includeCoverLetter: withCoverLetter && Boolean(coverLetterPreparationEnabled),
      });
      if (
        next &&
        generationView(next, nativeMaterials, Date.now()).kind === "idle" &&
        nativeMaterials
      )
        setNotice(GENERATION_UNAVAILABLE_COPY);
      setPollExpired(false);
    });
  }

  /** The resume the Apply button will use, shown beside it so the choice is never hidden. */
  const plan = applyPlan(application, view);
  const resumeShown =
    plan.resume === "uploaded" ||
    (packet?.artifactHashes.resume !== undefined &&
      shownResumeHash === packet.artifactHashes.resume);
  const applyDisabled =
    busy ||
    checking ||
    !href ||
    blockers.length > 0 ||
    !resumeShown ||
    (application?.status !== undefined &&
      !["preparing", "review_required", "approved"].includes(application.status)) ||
    application?.packetAvailability === "withheld" ||
    Boolean(preparation);

  function apply(forceUploaded = false) {
    // A second click while one is running must not open another employer tab.
    if (starting.current) return;
    const displayedHash = packet?.packetHash;
    // Open the employer page now, on the candidate's click, so no popup blocker applies; it is
    // pointed at the page only after the application is ready. The link back to this page is
    // severed first, and it carries no data.
    let employerTab: Window | null = null;
    try {
      employerTab = href ? window.open("", "_blank") : null;
      if (employerTab) employerTab.opener = null;
    } catch {
      employerTab = null;
    }
    void run(async () => {
      try {
        let current = await ensureApplication();
        const chosen = forceUploaded
          ? {
              resume: "uploaded" as const,
              needsNewPacket: packetResumeSource(current.currentPacket) !== "uploaded",
            }
          : applyPlan(current, generationView(current, nativeMaterials, Date.now()));
        if (chosen.needsNewPacket) {
          current = await ensureEditable(current);
          const next = await prepare(current, { resume: "uploaded" });
          if (!next) throw new Error("Preparation started");
          current = next;
        }
        current = await approveForApply(current, displayedHash, chosen.resume);
        setAppliedPacketHash(current.currentPacket?.packetHash);
        if (href && employerTab && !employerTab.closed) employerTab.location.replace(href);
        employerTab = null;
        await startHandoff(current, chosen.resume);
      } finally {
        if (employerTab && !employerTab.closed) employerTab.close();
      }
    });
  }

  /** Apply is the approval of the exact packet shown. The server still binds it to that packet. */
  async function approveForApply(
    current: Application,
    displayedHash: string | undefined,
    resume: "generated" | "uploaded",
  ): Promise<Application> {
    let next = current;
    if (next.status === "approved" && next.currentAction === "re_review")
      next = await ensureEditable(next);
    if (next.status === "review_required") {
      const nextGroups = reviewGroups(next);
      // Checks and the resume preview belong to the packet the candidate was shown. A packet that
      // was rebuilt during this click inherits none of them.
      const rebuilt = next.currentPacket?.packetHash !== displayedHash;
      const confirmed: ReadonlySet<string> = rebuilt ? new Set<string>() : acknowledged;
      if (!canApply(nextGroups, confirmed) || (rebuilt && resume === "generated")) {
        setNotice(
          rebuilt
            ? "Your answers were updated. Review them below, then press Apply."
            : "Answer or check the items below, then press Apply.",
        );
        throw new Error("Needs input");
      }
      next = await settle(
        await applicationsCall("POST", `/api/platform/applications/${next.id}/approval`, {
          ...options,
          body: {
            expectedRevision: next.revision,
            packetHash: next.currentPacket?.packetHash,
            acknowledgedFieldKeys: acknowledgementsForApply(nextGroups, confirmed),
          },
          idempotencyKey: commandKey("approve", next.id, next.revision),
        }),
        next.id,
      );
    }
    if (next.status !== "approved" || next.currentAction !== "ready_to_submit") {
      setNotice("That action is not available in the current state.");
      throw new Error("Not approved");
    }
    return next;
  }

  /** Arms the extension with identifiers only, then hands the generated PDF over when it asks. */
  async function startHandoff(current: Application, resume: "generated" | "uploaded") {
    const extensionId = nativeExtensionId();
    const messenger = nativeExtensionMessenger();
    const approved = current.approval;
    const currentPacket = current.currentPacket;
    if (!currentPacket) return;
    const settleHandoff = (state: ExtensionHandoffState) =>
      setHandoffState({ packetHash: currentPacket.packetHash, state });
    if (!extensionId || !messenger || !approved) {
      settleHandoff({ phase: "unavailable" });
      return;
    }
    withdrawTransfer();
    handoffPacket.current = currentPacket.packetHash;
    const controller = new AbortController();
    handoffAbort.current = controller;
    // The extension identifies this page by its review link.
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `/jobs?application=${current.id}&job=${current.canonicalJobId}`,
      );
    } catch {
      // The extension then refuses the sender; the manual path below still works.
    }
    const armed = await sendApplyIntent({
      extensionId,
      messenger,
      intent: {
        applicationId: current.id,
        jobId: current.canonicalJobId,
        packetId: currentPacket.id,
        packetHash: currentPacket.packetHash,
      },
      signal: controller.signal,
    });
    if (!armed) {
      settleHandoff({ phase: "unavailable" });
      return;
    }
    const materials = currentPacket.temporaryMaterials ?? [];
    if (resume === "uploaded" || !materials.length) {
      settleHandoff({ phase: "armed" });
      return;
    }
    settleHandoff({ phase: "waiting_for_extension" });
    const giveUpAtMs = Math.min(
      armed.expiresAtMs,
      Date.parse(approved.expiresAt),
      ...materials.map(materialDeadline),
    );
    void transferWhenSelected({
      extensionId,
      messenger,
      binding: {
        applicationId: current.id,
        packetId: currentPacket.id,
        packetHash: currentPacket.packetHash,
        approvalId: approved.id,
        revision: current.revision,
        approvalExpiresAtMs: Date.parse(approved.expiresAt),
        materials,
      },
      isCurrent: () => !controller.signal.aborted && !lifetime.current.signal.aborted,
      signal: controller.signal,
      giveUpAtMs,
      ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
    })
      .then((receipt) => {
        if (controller.signal.aborted) {
          discardTransferredNativeMaterials(messenger, extensionId, receipt);
          return;
        }
        transferred.current = { messenger, extensionId, receipt };
        settleHandoff({ phase: "resume_sent" });
      })
      .catch(() => {
        if (!controller.signal.aborted) settleHandoff({ phase: "armed" });
      });
  }

  /** Reports the candidate's own statement of what happened. The same body is retried on a replay. */
  async function reconcile(
    current: Application,
    attemptId: string,
    kind: "submitted" | "not_submitted",
  ) {
    const path = `/api/platform/applications/${current.id}/attempts/${attemptId}/reconciliation`;
    const signature = `${attemptId}:${kind}`;
    if (reconciliationIntent.current?.signature !== signature) {
      const observedAt = new Date().toISOString();
      const body =
        kind === "submitted"
          ? {
              kind: "user_attested_submitted",
              observedAt,
              fingerprintSha256: await sha256Hex(`user-attested:${attemptId}:${observedAt}`),
            }
          : { kind: "user_attested_not_submitted", acknowledgesDuplicateRisk: true };
      reconciliationIntent.current = { signature, body };
    }
    await settle(
      await applicationsCall("POST", path, {
        ...options,
        body: reconciliationIntent.current.body,
        idempotencyKey: commandKey(`reconcile-${kind}`, current.id, current.revision),
      }),
      current.id,
    );
  }

  /** Starts the manual attempt when none is open, then records the candidate's outcome. */
  async function recordSubmission(
    outcome: "submitted" | "not_submitted",
    observation?: ManualFormObservation,
  ) {
    if (!application) return;
    let current = application;
    if (current.status === "approved") {
      const result = await startManualApplicationSubmission(
        current.id,
        current.revision,
        options,
        observation,
      );
      // A lost response may already have started takeover. Read it before offering another capture.
      if (!result.ok && observation) await refresh(current.id);
      current = await settle(result, current.id);
    }
    const attempt = current.attempts.find(
      (candidate) => candidate.status === "ambiguous" || candidate.status === "taken_over",
    );
    if (!attempt) {
      setNotice("That action is not available in the current state.");
      throw new Error("No open attempt");
    }
    await reconcile(current, attempt.id, outcome);
  }

  const actions: ApplicationReviewActions | undefined = application
    ? {
        async onProvideEntry({ fieldKey, value }) {
          const next = { ...entries, [fieldKey]: value };
          setEntries(next);
          const current = await ensureEditable(application);
          const source = packetResumeSource(current.currentPacket);
          await prepare(current, {
            resume: source === "uploaded" || source === "none" ? "uploaded" : "generate",
            answers: next,
          });
        },
      }
    : undefined;

  const terminal = application?.status === "applied" || application?.status === "cancelled";
  const approvedReady =
    application?.status === "approved" &&
    application.currentAction === "ready_to_submit" &&
    application.packetAvailability !== "withheld";
  const inFlight =
    application?.status === "submitting" ||
    application?.status === "takeover" ||
    application?.status === "reconciliation_required";
  // The candidate is on the employer's page with an attempt open and only the outcome is missing.
  const awaitingOutcome =
    (application?.status === "takeover" || application?.status === "reconciliation_required") &&
    application.attempts.some(
      (attempt) => attempt.status === "ambiguous" || attempt.status === "taken_over",
    );

  return (
    <section aria-labelledby={headingId} className="apply-flow">
      <h2 id={headingId}>Apply to this job</h2>
      {checking && !application ? (
        <p role="status">Checking for an existing application...</p>
      ) : lookupFailed ? (
        <>
          <p role="alert">
            This application could not be opened. Check your account and try again.
          </p>
          <button type="button" onClick={() => setLookupAttempt((current) => current + 1)}>
            Reload application
          </button>
        </>
      ) : (
        <>
          {!terminal && !inFlight && !approvedReady ? (
            <>
              {preparation ? (
                <ApplicationPreparationProgress
                  key={preparation.id}
                  preparation={preparation}
                  onResolved={preparationResolved}
                  {...(fetchImplementation ? { fetchImplementation } : {})}
                />
              ) : (
                <GeneratedResumePanel
                  application={application}
                  view={view}
                  nativeMaterials={nativeMaterials}
                  nowMs={clock}
                  busy={busy}
                  onGenerate={() => generate()}
                  onApplyWithUploaded={() => apply(true)}
                  onPreviewShown={setShownResumeHash}
                  {...(fetchImplementation ? { fetchImplementation } : {})}
                />
              )}
              {!preparation ? (
                <CoverLetterSection
                  key={`${application?.id}:${packet?.id}:${packet?.packetHash}`}
                  application={application}
                  enabled={Boolean(coverLetterPreparationEnabled)}
                  busy={busy || checking}
                  onGenerate={() => generate(true)}
                  {...(fetchImplementation ? { fetchImplementation } : {})}
                />
              ) : null}
              {application && actions && !preparation ? (
                <ApplicationReviewPanel
                  application={application}
                  actions={actions}
                  acknowledged={acknowledged}
                  onToggle={(fieldKey) =>
                    setAcknowledged((current) => {
                      const next = new Set(current);
                      if (next.has(fieldKey)) next.delete(fieldKey);
                      else next.add(fieldKey);
                      return next;
                    })
                  }
                />
              ) : null}
              {application &&
              !preparation &&
              savedAnswerSelectionEnabled &&
              application.status === "review_required" ? (
                <SavedApplicationAnswers
                  key={`${application.id}:${application.revision}`}
                  application={application}
                  {...(fetchImplementation ? { fetchImplementation } : {})}
                  onPrepare={async (selection) => {
                    await run(async () => {
                      await prepare(application, {
                        resume:
                          packetResumeSource(application.currentPacket) === "uploaded"
                            ? "uploaded"
                            : "generate",
                        selected: selection,
                      });
                    });
                  }}
                />
              ) : null}
              <section aria-label="Apply" className="apply-action">
                <p>
                  {plan.resume === "generated"
                    ? "Apply will use your generated resume (PDF), exactly as shown above."
                    : view.kind === "preparing"
                      ? "Apply now uses your own uploaded resume. To use the generated one, wait for it to finish."
                      : "Apply will use your own uploaded resume, unchanged."}{" "}
                  It opens the employer's page. You confirm sensitive answers and the final submit
                  there.
                </p>
                {!href ? (
                  <p>
                    We do not have a safe link to this application page. Find the job on the
                    employer's site.
                  </p>
                ) : null}
                {blockers.length > 0 ? (
                  <ul aria-label="Why you cannot apply yet">
                    {blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  className="primary-action"
                  disabled={applyDisabled}
                  onClick={() => apply()}
                >
                  {busy ? "Working..." : "Apply"}
                </button>
              </section>
            </>
          ) : null}
          {application && (approvedReady || awaitingOutcome) ? (
            <ApplyPanel
              application={application}
              applyUrl={applyUrl}
              handoff={handoff}
              promptOutcome={
                appliedPacketHash !== undefined && appliedPacketHash === packet?.packetHash
              }
              {...(fetchImplementation ? { fetchImplementation } : {})}
              onRecordSubmission={({ outcome, observation }) =>
                recordSubmission(outcome, observation)
              }
            />
          ) : null}
          {application && terminal ? (
            <ApplicationReviewPanel
              application={application}
              actions={
                actions ?? {
                  onProvideEntry: () => undefined,
                }
              }
              acknowledged={acknowledged}
              onToggle={() => undefined}
            />
          ) : null}
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
