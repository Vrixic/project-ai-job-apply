"use client";

import {
  compileComponentValidator,
  type JobPreferenceSet,
  type Operation,
  type PutJobPreferencesResponse,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type CandidateProblemSurface,
  candidateSafeProblemMessage,
} from "../../../lib/candidate-safe-problem";
import {
  buildJobPreferenceRequest,
  type EmploymentType,
  emptyJobPreferenceFields,
  hydrateJobPreferenceFields,
  type JobPreferenceFields,
  toggleOrderedChoice,
  type WorkMode,
} from "../../preference-form-state";
import { ProfileArea } from "../../profile-sections/profile-area";

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

/** Read by the Settings page's dev-only isolation-conformance tool. */
const devConformanceOperationStorageKey = "dev-conformance-operation-id";

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

export function ProfilePageClient({
  authenticated,
  name,
  email,
}: {
  authenticated: boolean;
  name?: string | undefined;
  email?: string | undefined;
}) {
  const [preferenceFields, setPreferenceFields] = useState<JobPreferenceFields>(() =>
    emptyJobPreferenceFields(),
  );
  const [loadingPreferences, setLoadingPreferences] = useState(authenticated);
  const [preferenceLoadFailed, setPreferenceLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
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
      try {
        window.sessionStorage.setItem(devConformanceOperationStorageKey, response.operationId);
      } catch {
        // Best-effort only; the dev-only isolation tool degrades gracefully without it.
      }
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

  const preferencesPanel = (
    <>
      {message && <output aria-live="polite">{message}</output>}
      {operation && (
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
                preferences are saved. It does not assess resume processing, saved profile entries,
                matching, or application readiness.
              </small>
            </>
          )}
        </section>
      )}

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
    </>
  );

  return (
    <ProfileArea
      authenticated={authenticated}
      name={name}
      email={email}
      preferences={preferencesPanel}
    />
  );
}
