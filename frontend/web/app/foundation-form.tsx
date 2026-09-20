"use client";

import {
  compileComponentValidator,
  type EntitlementSummary,
  type JobPreferenceSet,
  type Operation,
  type PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type CandidateProblemSurface,
  candidateSafeProblemMessage,
} from "../lib/candidate-safe-problem";
import { isIsolationOperationEligible } from "../lib/isolation-operation";
import { CandidateRightsPanel } from "./candidate-rights-panel";
import { EntitlementStatus } from "./entitlement-status";
import { JobSearchForm } from "./job-search-form";
import {
  buildJobPreferenceRequest,
  type EmploymentType,
  emptyJobPreferenceFields,
  hydrateJobPreferenceFields,
  type JobPreferenceFields,
  toggleOrderedChoice,
  type WorkMode,
} from "./preference-form-state";
import { ProfileFactsForm } from "./profile-facts-form";
import { ResumeUploadForm } from "./resume-upload-form";
import { SavedJobsPanel } from "./saved-jobs-panel";

const workModeOptions: ReadonlyArray<{ value: WorkMode; label: string }> = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "on_site", label: "On-site" },
];
const employmentTypeOptions: ReadonlyArray<{ value: EmploymentType; label: string }> = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];
const workModeValues = workModeOptions.map((option) => option.value);
const employmentTypeValues = employmentTypeOptions.map((option) => option.value);
type RepeatablePreferenceField = "targetRoles" | "locations";
type LegacyJobPreferenceSet = JobPreferenceSet & { requiresSponsorship?: boolean };

const validateJobPreferenceSet = compileComponentValidator("JobPreferenceSet");

function parseJobPreferenceSet(value: unknown): LegacyJobPreferenceSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The preference response is invalid");
  }
  if (Object.hasOwn(value, "requiresSponsorship")) {
    const legacy = value as Record<string, unknown>;
    if (typeof legacy.requiresSponsorship !== "boolean") {
      throw new Error("The preference response is invalid");
    }
    const { requiresSponsorship, ...current } = legacy;
    if (!validateJobPreferenceSet(current)) {
      throw new Error("The preference response is invalid");
    }
    return { ...(current as JobPreferenceSet), requiresSponsorship };
  }
  if (!validateJobPreferenceSet(value)) {
    throw new Error("The preference response is invalid");
  }
  return value as JobPreferenceSet;
}

const preferenceLoadTimeoutMilliseconds = 20_000;
const preferenceLoadTimeoutMessage =
  "Loading saved preferences timed out. Retry to check your current preferences.";
const preferenceLoadFailureMessage = "Job preferences are temporarily unavailable.";
const preferenceSaveTimeoutMilliseconds = 20_000;
const preferenceSaveTimeoutMessage =
  "Saving preferences timed out. Retry to safely check the same preference update.";
const preferenceSaveFailureMessage = "Job preferences are temporarily unavailable.";
const operationPollIntervalMilliseconds = 1_500;
const operationPollTimeoutMilliseconds = 20_000;
const operationPollTimeoutMessage =
  "The saved check timed out. Checking will continue automatically.";
const operationPollFailureMessage = "The saved check is temporarily unavailable.";

interface PreferenceSaveIntent {
  body: string;
  idempotencyKey: string;
}

interface PreferenceLoadOwner {
  generation: number;
  controller: AbortController;
  timeout: number | undefined;
  timedOut: boolean;
}

interface PreferenceSaveOwner {
  generation: number;
  intent: PreferenceSaveIntent;
  controller: AbortController;
  timeout: number | undefined;
  timedOut: boolean;
}

interface OperationPollOwner {
  version: number;
  controller: AbortController;
  timeout: number | undefined;
  timedOut: boolean;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

class PreferenceSaveTimeoutError extends Error {
  constructor() {
    super("The preference save timed out");
    this.name = "PreferenceSaveTimeoutError";
  }
}

class PreferenceLoadTimeoutError extends Error {
  constructor() {
    super("The preference load timed out");
    this.name = "PreferenceLoadTimeoutError";
  }
}

class OperationPollTimeoutError extends Error {
  constructor() {
    super("The saved-preference operation poll timed out");
    this.name = "OperationPollTimeoutError";
  }
}

async function apiRequest<T>(
  path: string,
  surface: CandidateProblemSurface,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new ApiRequestError(
      await candidateSafeProblemMessage(response, surface),
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function FoundationForm({
  authConfigured,
  authConformanceEnabled,
  authenticationFailed,
  authenticated,
  crossUserProbeArmed,
  displayName,
  workloadConformanceEnabled,
}: {
  authConfigured: boolean;
  authConformanceEnabled: boolean;
  authenticationFailed: boolean;
  authenticated: boolean;
  crossUserProbeArmed: boolean;
  displayName?: string;
  workloadConformanceEnabled: boolean;
}) {
  const [profileRefreshVersion, setProfileRefreshVersion] = useState(0);
  const [maxStoredResumes, setMaxStoredResumes] = useState<number>();
  const handleEntitlementSummary = useCallback(
    (summary: EntitlementSummary | undefined) =>
      setMaxStoredResumes(summary?.limits?.maxStoredResumes),
    [],
  );
  const handleDocumentParsed = useCallback(
    () => setProfileRefreshVersion((version) => version + 1),
    [],
  );
  const [preferenceFields, setPreferenceFields] = useState<JobPreferenceFields>(() =>
    emptyJobPreferenceFields(),
  );
  const [loadingPreferences, setLoadingPreferences] = useState(authenticated);
  const [preferenceLoadFailed, setPreferenceLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renewingSession, setRenewingSession] = useState(false);
  const [checkingJobRead, setCheckingJobRead] = useState(false);
  const [armingIsolation, setArmingIsolation] = useState(false);
  const [checkingIsolation, setCheckingIsolation] = useState(false);
  const [runningWorkload, setRunningWorkload] = useState(false);
  const [workloadMetrics, setWorkloadMetrics] = useState<Record<string, unknown>>();
  const [isolationArmed, setIsolationArmed] = useState(crossUserProbeArmed);
  const [operationId, setOperationId] = useState<string>();
  const [operation, setOperation] = useState<Operation>();
  const [message, setMessage] = useState<string>();
  const [operationPollMessage, setOperationPollMessage] = useState<string>();
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const preferenceSessionGeneration = useRef(0);
  const activePreferenceLoad = useRef<PreferenceLoadOwner | undefined>(undefined);
  const preferenceSaveIntent = useRef<PreferenceSaveIntent | undefined>(undefined);
  const activePreferenceSave = useRef<PreferenceSaveOwner | undefined>(undefined);
  const operationPollVersion = useRef(0);
  const activeOperationPoll = useRef<OperationPollOwner | undefined>(undefined);
  const preferenceRowSequence = useRef(0);
  const [preferenceRowIds, setPreferenceRowIds] = useState<
    Record<RepeatablePreferenceField, string[]>
  >({ targetRoles: ["target-role-initial"], locations: [] });
  const preferenceControlsDisabled =
    loadingPreferences || preferenceLoadFailed || saving || !authenticated;

  const cancelPreferenceLoad = useCallback((): void => {
    const owner = activePreferenceLoad.current;
    activePreferenceLoad.current = undefined;
    if (!owner) return;
    window.clearTimeout(owner.timeout);
    owner.timeout = undefined;
    owner.controller.abort();
  }, []);

  const cancelPreferenceSave = useCallback((): void => {
    const owner = activePreferenceSave.current;
    activePreferenceSave.current = undefined;
    preferenceSaveIntent.current = undefined;
    if (!owner) return;
    window.clearTimeout(owner.timeout);
    owner.timeout = undefined;
    owner.controller.abort();
  }, []);

  function isActivePreferenceSave(owner: PreferenceSaveOwner): boolean {
    return activePreferenceSave.current === owner;
  }

  function ownsPreferenceSave(owner: PreferenceSaveOwner): boolean {
    return (
      authenticatedRef.current &&
      owner.generation === preferenceSessionGeneration.current &&
      isActivePreferenceSave(owner)
    );
  }

  function beginPreferenceSave(body: string): PreferenceSaveOwner | undefined {
    if (!authenticatedRef.current || activePreferenceSave.current) return undefined;
    const currentIntent = preferenceSaveIntent.current;
    const intent =
      currentIntent?.body === body
        ? currentIntent
        : {
            body,
            idempotencyKey: `preferences-${crypto.randomUUID()}`,
          };
    preferenceSaveIntent.current = intent;
    const owner: PreferenceSaveOwner = {
      generation: preferenceSessionGeneration.current,
      intent,
      controller: new AbortController(),
      timeout: undefined,
      timedOut: false,
    };
    activePreferenceSave.current = owner;
    return owner;
  }

  function clearPreferenceSaveIntent(owner: PreferenceSaveOwner): void {
    if (preferenceSaveIntent.current === owner.intent) preferenceSaveIntent.current = undefined;
  }

  async function runPreferenceSave(owner: PreferenceSaveOwner): Promise<PutJobPreferencesResponse> {
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    owner.timeout = window.setTimeout(() => {
      if (!isActivePreferenceSave(owner)) return;
      owner.timedOut = true;
      owner.controller.abort();
      rejectDeadline?.(new PreferenceSaveTimeoutError());
    }, preferenceSaveTimeoutMilliseconds);

    try {
      return await Promise.race([
        apiRequest<PutJobPreferencesResponse>("/api/platform/job-preferences", "preferences", {
          method: "PUT",
          signal: owner.controller.signal,
          headers: { "idempotency-key": owner.intent.idempotencyKey },
          body: owner.intent.body,
        }),
        deadline,
      ]);
    } finally {
      window.clearTimeout(owner.timeout);
      owner.timeout = undefined;
    }
  }

  const replacePreferenceFields = useCallback((fields: JobPreferenceFields) => {
    setPreferenceFields(fields);
    setPreferenceRowIds({
      targetRoles: fields.targetRoles.map(() => `target-role-${++preferenceRowSequence.current}`),
      locations: fields.locations.map(() => `location-${++preferenceRowSequence.current}`),
    });
  }, []);

  const loadPreferences = useCallback(
    async (generation: number): Promise<void> => {
      if (!authenticatedRef.current || activePreferenceLoad.current) return;
      const owner: PreferenceLoadOwner = {
        generation,
        controller: new AbortController(),
        timeout: undefined,
        timedOut: false,
      };
      activePreferenceLoad.current = owner;
      setLoadingPreferences(true);
      setPreferenceLoadFailed(false);
      setMessage(undefined);

      function ownsLoad(): boolean {
        return (
          authenticatedRef.current &&
          owner.generation === preferenceSessionGeneration.current &&
          activePreferenceLoad.current === owner
        );
      }

      let rejectDeadline: ((reason?: unknown) => void) | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
      });
      owner.timeout = window.setTimeout(() => {
        if (!ownsLoad()) return;
        owner.timedOut = true;
        owner.controller.abort();
        rejectDeadline?.(new PreferenceLoadTimeoutError());
      }, preferenceLoadTimeoutMilliseconds);

      try {
        const result = await Promise.race([
          (async () => {
            const response = await fetch("/api/platform/job-preferences", {
              cache: "no-store",
              signal: owner.controller.signal,
            });
            if (response.status === 404) return undefined;
            if (!response.ok) {
              await candidateSafeProblemMessage(response, "preferences");
              throw new Error(preferenceLoadFailureMessage);
            }
            return parseJobPreferenceSet(await response.json());
          })(),
          deadline,
        ]);
        if (!ownsLoad()) return;
        if (!result) {
          replacePreferenceFields(emptyJobPreferenceFields());
          setMessage(undefined);
          return;
        }
        const fields = hydrateJobPreferenceFields(result);
        replacePreferenceFields(fields);
        setMessage(
          fields.legacySponsorshipPresent
            ? "These saved preferences contain a legacy sponsorship answer. It is not shown here, and saving is unavailable until it moves to the restricted-data boundary."
            : "Saved preferences loaded.",
        );
      } catch (error) {
        if (!ownsLoad()) return;
        setPreferenceLoadFailed(true);
        setMessage(
          owner.timedOut || error instanceof PreferenceLoadTimeoutError
            ? preferenceLoadTimeoutMessage
            : preferenceLoadFailureMessage,
        );
      } finally {
        window.clearTimeout(owner.timeout);
        owner.timeout = undefined;
        if (activePreferenceLoad.current === owner) {
          activePreferenceLoad.current = undefined;
          if (
            authenticatedRef.current &&
            owner.generation === preferenceSessionGeneration.current
          ) {
            setLoadingPreferences(false);
          }
        }
      }
    },
    [replacePreferenceFields],
  );

  useEffect(() => {
    const generation = ++preferenceSessionGeneration.current;
    cancelPreferenceLoad();
    cancelPreferenceSave();
    setSaving(false);
    setPreferenceLoadFailed(false);
    setMessage(undefined);
    if (!authenticated) {
      replacePreferenceFields(emptyJobPreferenceFields());
      setOperationId(undefined);
      setOperation(undefined);
      setLoadingPreferences(false);
      return;
    }

    void loadPreferences(generation);
    return () => {
      if (preferenceSessionGeneration.current === generation) {
        cancelPreferenceLoad();
        cancelPreferenceSave();
      }
    };
  }, [
    authenticated,
    cancelPreferenceLoad,
    cancelPreferenceSave,
    loadPreferences,
    replacePreferenceFields,
  ]);

  useEffect(() => {
    const pollVersion = ++operationPollVersion.current;
    setOperationPollMessage(undefined);
    if (
      !authenticated ||
      !operationId ||
      operation?.state === "succeeded" ||
      operation?.state === "failed"
    ) {
      return;
    }

    function isCurrentPoll(owner: OperationPollOwner): boolean {
      return (
        authenticatedRef.current &&
        owner.version === operationPollVersion.current &&
        activeOperationPoll.current === owner
      );
    }

    function finishPoll(owner: OperationPollOwner): void {
      window.clearTimeout(owner.timeout);
      owner.timeout = undefined;
      if (activeOperationPoll.current === owner) activeOperationPoll.current = undefined;
    }

    const timer = window.setInterval(async () => {
      if (activeOperationPoll.current) return;
      let rejectDeadline: ((reason?: unknown) => void) | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
      });
      const owner: OperationPollOwner = {
        version: pollVersion,
        controller: new AbortController(),
        timeout: undefined,
        timedOut: false,
      };
      activeOperationPoll.current = owner;
      owner.timeout = window.setTimeout(() => {
        if (!isCurrentPoll(owner)) return;
        owner.timedOut = true;
        owner.controller.abort();
        rejectDeadline?.(new OperationPollTimeoutError());
      }, operationPollTimeoutMilliseconds);

      try {
        const next = await Promise.race([
          apiRequest<Operation>(
            `/api/platform/operations/${encodeURIComponent(operationId)}`,
            "operation",
            { signal: owner.controller.signal },
          ),
          deadline,
        ]);
        if (isCurrentPoll(owner)) {
          setOperationPollMessage(undefined);
          setOperation(next);
        }
      } catch (error) {
        if (isCurrentPoll(owner)) {
          setOperationPollMessage(
            owner.timedOut || error instanceof OperationPollTimeoutError
              ? operationPollTimeoutMessage
              : error instanceof ApiRequestError
                ? error.message
                : operationPollFailureMessage,
          );
        }
      } finally {
        finishPoll(owner);
      }
    }, operationPollIntervalMilliseconds);
    return () => {
      operationPollVersion.current += 1;
      window.clearInterval(timer);
      const owner = activeOperationPoll.current;
      if (owner?.version === pollVersion) {
        activeOperationPoll.current = undefined;
        window.clearTimeout(owner.timeout);
        owner.timeout = undefined;
        owner.controller.abort();
      }
    };
  }, [authenticated, operationId, operation?.state]);

  function updateRepeatablePreference(
    field: RepeatablePreferenceField,
    index: number,
    value: string,
  ) {
    setPreferenceFields((current) => ({
      ...current,
      [field]: current[field].map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  }

  function addRepeatablePreference(field: RepeatablePreferenceField) {
    if (preferenceFields[field].length >= 10) return;
    setPreferenceFields((current) => ({ ...current, [field]: [...current[field], ""] }));
    setPreferenceRowIds((current) => ({
      ...current,
      [field]: [...current[field], `${field}-${++preferenceRowSequence.current}`],
    }));
  }

  function removeRepeatablePreference(field: RepeatablePreferenceField, index: number) {
    setPreferenceFields((current) => {
      const remaining = current[field].filter((_, itemIndex) => itemIndex !== index);
      return {
        ...current,
        [field]: field === "targetRoles" && remaining.length === 0 ? [""] : remaining,
      };
    });
    setPreferenceRowIds((current) => ({
      ...current,
      [field]: current[field].filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preferenceLoadFailed || loadingPreferences || activePreferenceSave.current) return;
    setMessage(undefined);
    const result = buildJobPreferenceRequest(preferenceFields);
    if (!result.ok) {
      preferenceSaveIntent.current = undefined;
      setMessage(result.message);
      return;
    }
    const serializedBody = JSON.stringify(result.request);
    const owner = beginPreferenceSave(serializedBody);
    if (!owner) return;
    setSaving(true);
    try {
      const response = await runPreferenceSave(owner);
      if (!ownsPreferenceSave(owner)) return;
      clearPreferenceSaveIntent(owner);
      replacePreferenceFields(hydrateJobPreferenceFields(response.preferences));
      setOperationId(response.operationId);
      setOperation({
        id: response.operationId,
        kind: "profile_readiness",
        state: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setMessage("Preferences saved. Checking optional preference details.");
    } catch (error) {
      if (!ownsPreferenceSave(owner)) return;
      if (error instanceof ApiRequestError && error.status < 500) {
        clearPreferenceSaveIntent(owner);
      }
      setMessage(
        owner.timedOut || error instanceof PreferenceSaveTimeoutError
          ? preferenceSaveTimeoutMessage
          : error instanceof ApiRequestError
            ? error.message
            : preferenceSaveFailureMessage,
      );
    } finally {
      if (isActivePreferenceSave(owner)) {
        activePreferenceSave.current = undefined;
        if (owner.generation === preferenceSessionGeneration.current) setSaving(false);
      }
    }
  }

  async function verifySessionRenewal() {
    setRenewingSession(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/auth-conformance/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Session renewal failed");
      }
      setMessage("Auth0 conformance check passed: the server-held session renewed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Session renewal failed");
    } finally {
      setRenewingSession(false);
    }
  }

  async function verifyJobRead() {
    setCheckingJobRead(true);
    setMessage(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/auth-conformance/job-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Job-read authorization check failed");
      }
      setMessage("Job-read authorization passed: the server-held session has jobs:read.");
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Job-read authorization check timed out. Confirm the deployed gateway is healthy, then retry."
          : error instanceof Error
            ? error.message
            : "Job-read authorization check failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setCheckingJobRead(false);
    }
  }

  async function armIsolationProbe() {
    if (!operationId || !isIsolationOperationEligible(operation?.state, false)) {
      setMessage("Create a completed saved-preference check before arming the isolation check.");
      return;
    }
    setArmingIsolation(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/auth-conformance/isolation/arm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId }),
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Could not arm the isolation check");
      }
      setIsolationArmed(true);
      setMessage(
        "Isolation probe armed for 15 minutes. Log out, sign in with a different synthetic account, then run the check.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not arm the isolation check");
    } finally {
      setArmingIsolation(false);
    }
  }

  async function runIsolationProbe() {
    setCheckingIsolation(true);
    setMessage(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/auth-conformance/isolation/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
      });
      const outcome = (await response.json()) as { message?: string; state?: string };
      if (!response.ok) {
        throw new Error(outcome.message ?? "Cross-user isolation check failed");
      }
      setIsolationArmed(false);
      setMessage(
        "Cross-user isolation passed: this account could not read the first account’s operation.",
      );
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "Isolation check timed out. Confirm the deployed gateway is healthy, then retry."
          : error instanceof Error
            ? error.message
            : "Cross-user isolation check failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setCheckingIsolation(false);
    }
  }

  async function runPhase0Workload() {
    if (
      !window.confirm(
        "Run the fixed Phase 0 workload: 500 public probes and 25 preference workflows?",
      )
    ) {
      return;
    }
    setRunningWorkload(true);
    setWorkloadMetrics(undefined);
    setMessage(undefined);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch("/api/auth-conformance/workload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "run-phase0-staging-foundation-workload-v1" }),
        signal: controller.signal,
      });
      const outcome = (await response.json()) as {
        message?: string;
        metrics?: Record<string, unknown>;
      };
      if (!response.ok || !outcome.metrics) {
        throw new Error(outcome.message ?? "Phase 0 workload failed");
      }
      setWorkloadMetrics(outcome.metrics);
      setMessage("Phase 0 workload passed. Review the aggregate metrics below.");
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? "The Phase 0 workload timed out. Stop and inspect the deployed environment."
          : error instanceof Error
            ? error.message
            : "Phase 0 workload failed",
      );
    } finally {
      window.clearTimeout(timeout);
      setRunningWorkload(false);
    }
  }

  return (
    <main>
      <section className="eyebrow">Foundation vertical slice</section>
      <h1>Tell us what work fits you.</h1>
      <p className="lede">
        These preferences will eventually drive fresh job discovery and rapid, tailored
        applications. Application history stops at confirmed submission.
      </p>

      {authConfigured && authenticated && (
        <nav className="session" aria-label="Account">
          <span>Signed in{displayName ? ` as ${displayName}` : ""}</span>
          <a href="/auth/logout">Log out</a>
        </nav>
      )}

      {authConformanceEnabled && authenticated && (
        <aside>
          <strong>Development Auth0 conformance</strong>
          <p>
            Force a server-side renewal before and after revoking this test account&apos;s
            application authorization. No token material is returned to the browser.
          </p>
          <button type="button" onClick={verifySessionRenewal} disabled={renewingSession}>
            {renewingSession ? "Renewing…" : "Verify session renewal"}
          </button>
          <button type="button" onClick={verifyJobRead} disabled={checkingJobRead}>
            {checkingJobRead ? "Checking…" : "Verify job-read authorization"}
          </button>
          <hr />
          <strong>Deployed cross-user isolation</strong>
          <p>
            Arm an owner-visible operation, log out, and sign in with a different synthetic account.
            The server keeps only an encrypted, expiring probe and returns no identity, token, or
            operation identifier.
          </p>
          {!isolationArmed ? (
            <button
              type="button"
              onClick={armIsolationProbe}
              disabled={armingIsolation || !isIsolationOperationEligible(operation?.state, false)}
            >
              {armingIsolation ? "Arming…" : "Arm cross-user isolation check"}
            </button>
          ) : (
            <button type="button" onClick={runIsolationProbe} disabled={checkingIsolation}>
              {checkingIsolation ? "Checking…" : "Run check as this account"}
            </button>
          )}
          {workloadConformanceEnabled && (
            <>
              <hr />
              <strong>Phase 0 workload</strong>
              <p>
                Run the fixed synthetic profile only after reviewing its runbook. The server-held
                token, saved preferences, and operation identifiers never enter the result.
              </p>
              <button type="button" onClick={runPhase0Workload} disabled={runningWorkload}>
                {runningWorkload ? "Running workload…" : "Run Phase 0 workload"}
              </button>
            </>
          )}
        </aside>
      )}

      {authConfigured && !authenticated && (
        <aside>
          <strong>Sign in to save your preferences.</strong>
          <div className="auth-actions">
            <a className="button-link" href="/auth/login">
              Log in
            </a>
            <a className="secondary-link" href="/auth/login?screen_hint=signup">
              Create account
            </a>
          </div>
        </aside>
      )}

      {authenticationFailed && !authenticated && (
        <aside>
          <strong>Sign-in was not completed.</strong>
          <p>
            The account may be unavailable or blocked. Try again after confirming the account is
            active.
          </p>
        </aside>
      )}

      {authenticated && (
        <>
          <form className="preference-form" aria-label="Job preferences" onSubmit={save}>
            <fieldset className="repeatable-field" disabled={preferenceControlsDisabled}>
              <legend>Target roles</legend>
              <span className="field-help">
                Add up to ten roles; punctuation stays within each role
              </span>
              {preferenceRowIds.targetRoles.map((rowId, index) => (
                <div className="repeatable-row" key={rowId}>
                  <label>
                    Target role {index + 1}
                    <textarea
                      maxLength={100}
                      rows={2}
                      value={preferenceFields.targetRoles[index] ?? ""}
                      onChange={(event) =>
                        updateRepeatablePreference("targetRoles", index, event.target.value)
                      }
                      required
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove target role ${index + 1}`}
                    onClick={() => removeRepeatablePreference("targetRoles", index)}
                    disabled={preferenceFields.targetRoles.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addRepeatablePreference("targetRoles")}
                disabled={preferenceFields.targetRoles.length >= 10}
              >
                Add target role
              </button>
            </fieldset>
            <fieldset className="repeatable-field" disabled={preferenceControlsDisabled}>
              <legend>Locations</legend>
              <span className="field-help">Optional; add up to ten locations</span>
              {preferenceRowIds.locations.map((rowId, index) => (
                <div className="repeatable-row" key={rowId}>
                  <label>
                    Location {index + 1}
                    <textarea
                      maxLength={120}
                      rows={2}
                      value={preferenceFields.locations[index] ?? ""}
                      onChange={(event) =>
                        updateRepeatablePreference("locations", index, event.target.value)
                      }
                      required
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove location ${index + 1}`}
                    onClick={() => removeRepeatablePreference("locations", index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addRepeatablePreference("locations")}
                disabled={preferenceFields.locations.length >= 10}
              >
                Add location
              </button>
            </fieldset>
            <fieldset disabled={preferenceControlsDisabled}>
              <legend>Work modes</legend>
              <span className="field-help">Select every mode you would accept</span>
              <div className="choice-group">
                {workModeOptions.map((option) => (
                  <label className="choice-option" key={option.value}>
                    <input
                      type="checkbox"
                      checked={preferenceFields.workModes.includes(option.value)}
                      onChange={(event) =>
                        setPreferenceFields((current) => ({
                          ...current,
                          workModes: toggleOrderedChoice(
                            workModeValues,
                            current.workModes,
                            option.value,
                            event.target.checked,
                          ),
                        }))
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={preferenceControlsDisabled}>
              <legend>Employment types</legend>
              <span className="field-help">Select every type you would accept</span>
              <div className="choice-group">
                {employmentTypeOptions.map((option) => (
                  <label className="choice-option" key={option.value}>
                    <input
                      type="checkbox"
                      checked={preferenceFields.employmentTypes.includes(option.value)}
                      onChange={(event) =>
                        setPreferenceFields((current) => ({
                          ...current,
                          employmentTypes: toggleOrderedChoice(
                            employmentTypeValues,
                            current.employmentTypes,
                            option.value,
                            event.target.checked,
                          ),
                        }))
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="paired-fields">
              <label>
                Minimum compensation amount
                <span>Optional; enter a whole number</span>
                <input
                  inputMode="numeric"
                  value={preferenceFields.salaryMinimum}
                  onChange={(event) =>
                    setPreferenceFields((current) => ({
                      ...current,
                      salaryMinimum: event.target.value,
                    }))
                  }
                  disabled={preferenceControlsDisabled}
                />
              </label>
              <label>
                Compensation currency
                <span>Three-letter code, such as USD</span>
                <input
                  maxLength={3}
                  value={preferenceFields.salaryCurrency}
                  onChange={(event) =>
                    setPreferenceFields((current) => ({
                      ...current,
                      salaryCurrency: event.target.value.toUpperCase(),
                    }))
                  }
                  disabled={preferenceControlsDisabled}
                />
              </label>
            </div>
            <button type="submit" disabled={preferenceControlsDisabled}>
              {loadingPreferences ? "Loading…" : saving ? "Saving…" : "Save preferences"}
            </button>
            {preferenceLoadFailed && !loadingPreferences && (
              <button
                type="button"
                onClick={() => void loadPreferences(preferenceSessionGeneration.current)}
              >
                Retry loading preferences
              </button>
            )}
          </form>

          <ResumeUploadForm
            authenticated
            maxStoredResumes={maxStoredResumes}
            onDocumentParsed={handleDocumentParsed}
          />
          <ProfileFactsForm authenticated refreshVersion={profileRefreshVersion} />
        </>
      )}
      <JobSearchForm authenticated={authenticated} />
      <SavedJobsPanel authenticated={authenticated} />
      <EntitlementStatus onSummary={handleEntitlementSummary} authenticated={authenticated} />
      <CandidateRightsPanel authenticated={authenticated} />

      {!authConfigured && (
        <aside>
          Auth0 client credentials are not configured. The application fails closed; browser
          development tokens are not supported.
        </aside>
      )}
      {authenticated && message && <output aria-live="polite">{message}</output>}
      {workloadMetrics && (
        <section className="result" aria-live="polite">
          <strong>Aggregate Phase 0 workload metrics</strong>
          <pre>{JSON.stringify(workloadMetrics, null, 2)}</pre>
        </section>
      )}
      {authenticated && operation && (
        <section className="result" aria-live="polite">
          <strong>Saved-preference check: {operation.state.replaceAll("_", " ")}</strong>
          {operationPollMessage && <p>{operationPollMessage}</p>}
          {operation.result && (
            <>
              <p>
                {operation.result.missingFields.length > 0
                  ? `Optional preference details not saved: ${operation.result.missingFields.join(", ")}.`
                  : "All details evaluated by this saved-preference check are present."}
              </p>
              <small>
                This check only reports whether optional location and minimum compensation
                preferences are saved. It does not assess resume processing, profile facts,
                matching, or application readiness.
              </small>
            </>
          )}
        </section>
      )}
    </main>
  );
}
