"use client";

import type {
  CreateProfileFactRequest,
  ProfileFact,
  ProfileFactCollection,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { candidateSafeProblemMessage } from "../lib/candidate-safe-problem";
import { validateFoundationResponse } from "../lib/foundation-response-bff";

const kinds: Array<{ value: CreateProfileFactRequest["kind"]; label: string }> = [
  { value: "identity", label: "Contact or identity" },
  { value: "employment", label: "Employment" },
  { value: "education", label: "Education" },
  { value: "project", label: "Project" },
  { value: "skill", label: "Skill" },
  { value: "certification", label: "Certification" },
  { value: "preference", label: "Application preference" },
];

const factMutationTimeoutMilliseconds = 20_000;
const factMutationTimeoutMessage = "Saving timed out. Retry to safely check the same profile fact.";
const factMutationFailureMessage = "Profile facts are temporarily unavailable.";
const factLoadTimeoutMilliseconds = 20_000;
const factLoadFailureMessage = "Profile facts are temporarily unavailable.";

interface FactMutationIntent {
  method: "POST" | "PATCH";
  path: string;
  body: string;
  idempotencyKey: string;
}

interface FactMutationOwner {
  generation: number;
  intent: FactMutationIntent;
  controller: AbortController;
  timeout: number | undefined;
  timedOut: boolean;
}

interface FactLoadOwner {
  requestVersion: number;
  controller: AbortController;
  timeout: number | undefined;
  timedOut: boolean;
}

class FactMutationTimeoutError extends Error {
  constructor() {
    super("The profile fact mutation timed out");
    this.name = "FactMutationTimeoutError";
  }
}

class FactLoadTimeoutError extends Error {
  constructor() {
    super("The profile facts load timed out");
    this.name = "FactLoadTimeoutError";
  }
}

async function factRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    throw new FactRequestError(
      await candidateSafeProblemMessage(response, "profile_facts"),
      response.status,
    );
  }
  return (await response.json()) as T;
}

class FactRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FactRequestError";
  }
}

function displayValue(value: ProfileFact["value"]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function partitionProfileFacts(facts: readonly ProfileFact[]) {
  const available = facts.filter((fact) => fact.availability?.state !== "invalidated");
  return {
    proposed: available.filter((fact) => fact.verification === "proposed"),
    reviewed: available.filter(
      (fact) => fact.verification === "confirmed" || fact.verification === "rejected",
    ),
    invalidated: facts.filter((fact) => fact.availability?.state === "invalidated"),
  };
}

export function ProfileFactsForm({
  authenticated,
  refreshVersion = 0,
}: {
  authenticated: boolean;
  refreshVersion?: number;
}) {
  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [kind, setKind] = useState<CreateProfileFactRequest["kind"] | "">("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<ProfileFact>();
  const [editedValue, setEditedValue] = useState("");
  const [loading, setLoading] = useState(authenticated);
  const [saving, setSaving] = useState(false);
  const [savingFactId, setSavingFactId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const lastRefreshVersion = useRef(0);
  const loadRequestVersion = useRef(0);
  const sessionGeneration = useRef(0);
  const sessionController = useRef<AbortController | undefined>(undefined);
  const mutationIntent = useRef<FactMutationIntent | undefined>(undefined);
  const activeMutation = useRef<FactMutationOwner | undefined>(undefined);
  const activeLoad = useRef<FactLoadOwner | undefined>(undefined);

  const cancelActiveMutation = useCallback((): void => {
    const mutation = activeMutation.current;
    activeMutation.current = undefined;
    mutationIntent.current = undefined;
    if (!mutation) return;
    window.clearTimeout(mutation.timeout);
    mutation.timeout = undefined;
    mutation.controller.abort();
  }, []);

  const cancelActiveLoad = useCallback((): void => {
    const load = activeLoad.current;
    activeLoad.current = undefined;
    if (!load) return;
    window.clearTimeout(load.timeout);
    load.timeout = undefined;
    load.controller.abort();
  }, []);

  function isActiveMutation(mutation: FactMutationOwner): boolean {
    return activeMutation.current === mutation;
  }

  function ownsMutation(mutation: FactMutationOwner): boolean {
    return (
      authenticatedRef.current &&
      mutation.generation === sessionGeneration.current &&
      isActiveMutation(mutation)
    );
  }

  const isActiveLoad = useCallback((load: FactLoadOwner): boolean => {
    return activeLoad.current === load;
  }, []);

  const ownsLoad = useCallback(
    (load: FactLoadOwner, generation: number, requestVersion: number): boolean => {
      return (
        authenticatedRef.current &&
        generation === sessionGeneration.current &&
        requestVersion === load.requestVersion &&
        isActiveLoad(load)
      );
    },
    [isActiveLoad],
  );

  const beginLoad = useCallback((): FactLoadOwner | undefined => {
    if (!authenticatedRef.current) return undefined;
    if (activeLoad.current) {
      cancelActiveLoad();
    }
    const requestVersion = ++loadRequestVersion.current;
    const load: FactLoadOwner = {
      requestVersion,
      controller: new AbortController(),
      timeout: undefined,
      timedOut: false,
    };
    activeLoad.current = load;
    return load;
  }, [cancelActiveLoad]);

  const clearLoad = useCallback(
    (load: FactLoadOwner): void => {
      if (isActiveLoad(load)) activeLoad.current = undefined;
    },
    [isActiveLoad],
  );

  const runLoad = useCallback(async <T,>(load: FactLoadOwner): Promise<T> => {
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    let response: Response | undefined;
    load.timeout = window.setTimeout(() => {
      if (activeLoad.current !== load) return;
      load.timedOut = true;
      load.controller.abort();
      rejectDeadline?.(new FactLoadTimeoutError());
    }, factLoadTimeoutMilliseconds);

    try {
      const successfulLoad = (async (): Promise<T> => {
        response = await fetch("/api/platform/profile-facts", {
          signal: load.controller.signal,
        });
        if (!response.ok) {
          throw new FactRequestError(factLoadFailureMessage, response.status);
        }
        const validatedResponse = response.ok
          ? await validateFoundationResponse(
              response,
              200,
              "ProfileFactCollection",
              load.controller.signal,
              factLoadTimeoutMilliseconds,
            )
          : response;
        if (!validatedResponse.ok) {
          throw new FactRequestError(factLoadFailureMessage, validatedResponse.status);
        }
        return (await validatedResponse.json()) as T;
      })();
      return (await Promise.race([successfulLoad, deadline])) as T;
    } finally {
      window.clearTimeout(load.timeout);
      load.timeout = undefined;
      if (response?.body) {
        void Promise.resolve(response.body.cancel()).catch(() => undefined);
      }
    }
  }, []);

  function beginMutation(
    method: FactMutationIntent["method"],
    path: string,
    body: string,
  ): FactMutationOwner | undefined {
    if (!authenticatedRef.current || activeMutation.current) return undefined;
    const currentIntent = mutationIntent.current;
    const intent =
      currentIntent?.method === method && currentIntent.path === path && currentIntent.body === body
        ? currentIntent
        : {
            method,
            path,
            body,
            idempotencyKey: `profile-fact-${crypto.randomUUID()}`,
          };
    mutationIntent.current = intent;
    const mutation: FactMutationOwner = {
      generation: sessionGeneration.current,
      intent,
      controller: new AbortController(),
      timeout: undefined,
      timedOut: false,
    };
    activeMutation.current = mutation;
    return mutation;
  }

  function clearMutationIntent(mutation: FactMutationOwner): void {
    if (mutationIntent.current === mutation.intent) mutationIntent.current = undefined;
  }

  async function runMutation<T>(mutation: FactMutationOwner): Promise<T> {
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    mutation.timeout = window.setTimeout(() => {
      if (activeMutation.current !== mutation) return;
      mutation.timedOut = true;
      mutation.controller.abort();
      rejectDeadline?.(new FactMutationTimeoutError());
    }, factMutationTimeoutMilliseconds);

    try {
      return await Promise.race([
        factRequest<T>(mutation.intent.path, {
          method: mutation.intent.method,
          signal: mutation.controller.signal,
          headers: { "idempotency-key": mutation.intent.idempotencyKey },
          body: mutation.intent.body,
        }),
        deadline,
      ]);
    } finally {
      window.clearTimeout(mutation.timeout);
      mutation.timeout = undefined;
    }
  }

  function mutationMessage(error: unknown, timedOut: boolean): string {
    if (timedOut || error instanceof FactMutationTimeoutError) return factMutationTimeoutMessage;
    return error instanceof FactRequestError ? error.message : factMutationFailureMessage;
  }

  const loadMessage = useCallback((error: unknown, timedOut: boolean): string => {
    if (timedOut || error instanceof FactLoadTimeoutError) return factLoadFailureMessage;
    return factLoadFailureMessage;
  }, []);

  const load = useCallback(
    async (announceResumeResult: boolean, generation: number, signal: AbortSignal) => {
      const loadOwner = beginLoad();
      if (!loadOwner) return;
      const { requestVersion } = loadOwner;
      const onAbort = () => loadOwner.controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      setLoading(true);
      try {
        const collection = await runLoad<ProfileFactCollection>(loadOwner);
        if (!ownsLoad(loadOwner, generation, requestVersion)) return;
        setFacts(collection.facts);
        if (announceResumeResult) {
          setMessage(
            collection.proposedCount === 1
              ? "1 extracted fact is waiting for your review."
              : collection.proposedCount > 1
                ? `${collection.proposedCount} extracted facts are waiting for your review.`
                : "Resume parsing finished; no extracted facts are waiting for review.",
          );
        }
      } catch (error) {
        if (!signal.aborted && ownsLoad(loadOwner, generation, requestVersion)) {
          setMessage(loadMessage(error, loadOwner.timedOut));
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        clearLoad(loadOwner);
        if (
          !signal.aborted &&
          generation === sessionGeneration.current &&
          requestVersion === loadRequestVersion.current
        ) {
          setLoading(false);
        }
      }
    },
    [beginLoad, ownsLoad, runLoad, clearLoad, loadMessage],
  );

  useEffect(() => {
    const generation = ++sessionGeneration.current;
    cancelActiveMutation();
    cancelActiveLoad();
    sessionController.current?.abort();
    const controller = new AbortController();
    sessionController.current = controller;
    loadRequestVersion.current += 1;
    setFacts([]);
    setKind("");
    setKey("");
    setValue("");
    setEditing(undefined);
    setEditedValue("");
    setMessage(undefined);
    setSaving(false);
    setSavingFactId(undefined);
    setLoading(authenticated);

    return () => {
      if (sessionGeneration.current === generation) {
        cancelActiveMutation();
        cancelActiveLoad();
        controller.abort();
      }
    };
  }, [authenticated, cancelActiveMutation, cancelActiveLoad]);

  useEffect(() => {
    const announceResumeResult = refreshVersion > lastRefreshVersion.current;
    lastRefreshVersion.current = refreshVersion;
    const controller = sessionController.current;
    if (!authenticated || !controller) return;
    void load(announceResumeResult, sessionGeneration.current, controller.signal);
  }, [authenticated, load, refreshVersion]);

  async function createFact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeMutation.current) return;
    if (!kind) {
      setMessage("Choose a fact category before saving.");
      return;
    }
    const body = JSON.stringify({
      kind,
      key: key.trim(),
      value: value.trim(),
      sensitivity: "confidential",
    });
    const mutation = beginMutation("POST", "/api/platform/profile-facts", body);
    if (!mutation) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const created = await runMutation<ProfileFact>(mutation);
      if (!ownsMutation(mutation)) return;
      clearMutationIntent(mutation);
      setFacts((current) => [...current, created]);
      setKind("");
      setKey("");
      setValue("");
      setMessage("Profile fact saved as confirmed user input.");
    } catch (error) {
      if (!ownsMutation(mutation)) return;
      if (error instanceof FactRequestError && error.status < 500) {
        clearMutationIntent(mutation);
      }
      setMessage(mutationMessage(error, mutation.timedOut));
    } finally {
      if (isActiveMutation(mutation)) {
        activeMutation.current = undefined;
        if (mutation.generation === sessionGeneration.current) setSaving(false);
      }
    }
  }

  async function updateFact(
    fact: ProfileFact,
    command: Omit<UpdateProfileFactRequest, "expectedVersion">,
  ) {
    if (activeMutation.current) return;
    const generation = sessionGeneration.current;
    const session = sessionController.current;
    if (!authenticated || !session) return;
    const path = `/api/platform/profile-facts/${encodeURIComponent(fact.id)}`;
    const body = JSON.stringify({ expectedVersion: fact.version, ...command });
    const mutation = beginMutation("PATCH", path, body);
    if (!mutation) return;
    setSavingFactId(fact.id);
    setMessage(undefined);
    try {
      const updated = await runMutation<ProfileFact>(mutation);
      if (!ownsMutation(mutation)) return;
      clearMutationIntent(mutation);
      setFacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditing(undefined);
      setMessage("A new profile fact version was saved. Prior versions remain auditable.");
    } catch (error) {
      if (!ownsMutation(mutation)) return;
      if (error instanceof FactRequestError && error.status < 500) {
        clearMutationIntent(mutation);
      }
      if (error instanceof FactRequestError && error.status === 409) {
        await load(false, generation, session.signal);
        if (ownsMutation(mutation) && !session.signal.aborted) {
          setMessage(
            "This proposal changed after it was loaded. The latest version is shown; review it again.",
          );
        }
      } else {
        setMessage(mutationMessage(error, mutation.timedOut));
      }
    } finally {
      if (isActiveMutation(mutation)) {
        activeMutation.current = undefined;
        if (mutation.generation === sessionGeneration.current) setSavingFactId(undefined);
      }
    }
  }

  function beginCorrection(fact: ProfileFact) {
    if (!authenticated || saving || savingFactId !== undefined) return;
    setEditing(fact);
    setEditedValue(displayValue(fact.value));
  }

  const {
    proposed: proposedFacts,
    reviewed: reviewedFacts,
    invalidated: invalidatedFacts,
  } = partitionProfileFacts(facts);

  if (!authenticated) {
    return (
      <section className="profile-facts" aria-labelledby="profile-facts-heading">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Truth profile</div>
            <h2 id="profile-facts-heading">Your profile facts</h2>
          </div>
        </div>
        <p>Sign in to review or add profile facts.</p>
      </section>
    );
  }

  function factCard(fact: ProfileFact, review: boolean, mutable = true) {
    const source = fact.evidence?.supportingSpans[0];
    const cardSaving = savingFactId === fact.id;
    const anyFactSaving = !authenticated || savingFactId !== undefined;
    return (
      <li key={fact.id}>
        <div>
          <strong>{fact.key}</strong>
          <span>{displayValue(fact.value)}</span>
          <small>
            {fact.kind} · {fact.verification} · version {fact.version}
            {fact.availability?.state === "invalidated" ? " · unavailable" : ""}
            {source
              ? ` · source page ${source.page ?? "unknown"}, block ${source.blockIndex + 1}`
              : ""}
          </small>
        </div>
        {mutable && (
          <div className="fact-actions">
            {review && (
              <button
                type="button"
                onClick={() => void updateFact(fact, { verification: "confirmed" })}
                disabled={anyFactSaving}
                aria-label={`Confirm ${fact.key}`}
              >
                {cardSaving ? "Saving…" : "Confirm"}
              </button>
            )}
            <button type="button" onClick={() => beginCorrection(fact)} disabled={anyFactSaving}>
              {review ? "Edit & confirm" : "Correct"}
            </button>
            {fact.verification !== "rejected" && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void updateFact(fact, { verification: "rejected" })}
                disabled={anyFactSaving}
                aria-label={`Reject ${fact.key}`}
              >
                Reject
              </button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <section className="profile-facts" aria-labelledby="profile-facts-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Truth profile</div>
          <h2 id="profile-facts-heading">Your profile facts</h2>
        </div>
        <span>
          {
            facts.filter(
              (fact) =>
                fact.verification === "confirmed" && fact.availability?.state !== "invalidated",
            ).length
          }{" "}
          confirmed
        </span>
      </div>
      <p>
        Add only facts that are true. Corrections create a new version; no extracted or generated
        fact is silently confirmed.
      </p>

      {loading ? (
        <p>Loading profile facts…</p>
      ) : (
        <>
          <h3>Review extracted facts</h3>
          {proposedFacts.length === 0 ? (
            <p>No extracted facts are waiting for review.</p>
          ) : (
            <ul className="fact-list">{proposedFacts.map((fact) => factCard(fact, true))}</ul>
          )}
          <h3>Reviewed facts</h3>
          {reviewedFacts.length === 0 ? (
            <p>No facts have been confirmed or rejected yet.</p>
          ) : (
            <ul className="fact-list">{reviewedFacts.map((fact) => factCard(fact, false))}</ul>
          )}
          {invalidatedFacts.length > 0 && (
            <>
              <h3>Security-invalidated facts</h3>
              <p>These facts are unavailable because their source document failed a later check.</p>
              <ul className="fact-list">
                {invalidatedFacts.map((fact) => factCard(fact, false, false))}
              </ul>
            </>
          )}
        </>
      )}

      {editing && (
        <form
          className="compact-form"
          onSubmit={(event) => {
            event.preventDefault();
            void updateFact(editing, { value: editedValue.trim(), verification: "confirmed" });
          }}
        >
          <label>
            Correct {editing.key}
            <input
              value={editedValue}
              onChange={(event) => setEditedValue(event.target.value)}
              disabled={!authenticated || saving || savingFactId !== undefined}
              required
            />
          </label>
          <div className="fact-actions">
            <button type="submit" disabled={!authenticated || saving || savingFactId !== undefined}>
              Save correction
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setEditing(undefined)}
              disabled={!authenticated || saving || savingFactId !== undefined}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <form className="compact-form" onSubmit={createFact}>
        <label>
          Fact category
          <select
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as CreateProfileFactRequest["kind"] | "")
            }
            required
            disabled={!authenticated || loading || saving || savingFactId !== undefined}
          >
            <option value="">Choose a category</option>
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="field-help">
          Direct-entered profile facts are stored as confidential. Restricted sponsorship,
          work-authorization, demographic, disability, veteran, and legal answers are not collected
          here; their dedicated restricted-data flow is not yet available.
        </p>
        <label>
          Fact name
          <span>For example: programming language, degree, or employer</span>
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            disabled={!authenticated || loading || saving || savingFactId !== undefined}
            required
          />
        </label>
        <label>
          Confirmed value
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={!authenticated || loading || saving || savingFactId !== undefined}
            required
          />
        </label>
        <button
          type="submit"
          disabled={!authenticated || loading || saving || savingFactId !== undefined || !kind}
        >
          {saving ? "Saving…" : "Add confirmed fact"}
        </button>
      </form>
      {message && <output>{message}</output>}
    </section>
  );
}
