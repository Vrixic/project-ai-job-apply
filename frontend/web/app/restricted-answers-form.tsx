"use client";

import type {
  RestrictedAnswer,
  RestrictedAnswerCollection,
  SaveRestrictedAnswerRequest,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { candidateSafeProblemMessage } from "../lib/candidate-safe-problem";
import { validateFoundationResponse } from "../lib/foundation-response-bff";
import { restrictedAnswerField, restrictedAnswerFields } from "../lib/restricted-answer-fields";

const requestTimeoutMilliseconds = 20_000;
const loadFailureMessage = "Restricted answers are temporarily unavailable.";
const mutationTimeoutMessage =
  "Saving timed out. Retry to safely check the same restricted answer.";

interface SaveIntent {
  signature: string;
  path: string;
  body: string;
  idempotencyKey: string;
}

interface RequestOwner {
  generation: number;
  controller: AbortController;
  timeout: number | undefined;
  timedOut: boolean;
}

class VaultRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VaultRequestError";
  }
}

function exactEntry(
  answers: readonly RestrictedAnswer[],
  fieldKey: string,
  context: string | undefined,
): RestrictedAnswer | undefined {
  return answers.find((answer) => answer.fieldKey === fieldKey && answer.context === context);
}

function contextQuery(context: string | undefined): string {
  return context === undefined ? "" : `?${new URLSearchParams({ context })}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function RestrictedAnswersForm({ authenticated }: { authenticated: boolean }) {
  const [answers, setAnswers] = useState<RestrictedAnswer[]>([]);
  const [fieldKey, setFieldKey] = useState("");
  const [answerValue, setAnswerValue] = useState("");
  const [questionContext, setQuestionContext] = useState("");
  const [confirmedSave, setConfirmedSave] = useState(false);
  const [loading, setLoading] = useState(authenticated);
  const [message, setMessage] = useState<string>();
  const [mutatingKey, setMutatingKey] = useState<string>();
  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;
  const sessionGeneration = useRef(0);
  const activeLoad = useRef<RequestOwner | undefined>(undefined);
  const activeMutation = useRef<RequestOwner | undefined>(undefined);
  const saveIntent = useRef<SaveIntent | undefined>(undefined);

  const cancelRequest = useCallback((owner: RequestOwner | undefined): void => {
    if (!owner) return;
    window.clearTimeout(owner.timeout);
    owner.timeout = undefined;
    owner.controller.abort();
  }, []);

  const runWithDeadline = useCallback(
    async <T,>(owner: RequestOwner, operation: () => Promise<T>): Promise<T> => {
      let rejectDeadline: ((reason?: unknown) => void) | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        rejectDeadline = reject;
      });
      owner.timeout = window.setTimeout(() => {
        owner.timedOut = true;
        owner.controller.abort();
        rejectDeadline?.(new Error("Restricted answer request timed out"));
      }, requestTimeoutMilliseconds);
      try {
        return await Promise.race([operation(), deadline]);
      } finally {
        window.clearTimeout(owner.timeout);
        owner.timeout = undefined;
      }
    },
    [],
  );

  const loadAnswers = useCallback(
    async (generation: number): Promise<void> => {
      cancelRequest(activeLoad.current);
      const owner: RequestOwner = {
        generation,
        controller: new AbortController(),
        timeout: undefined,
        timedOut: false,
      };
      activeLoad.current = owner;
      setLoading(true);
      try {
        const collection = await runWithDeadline(owner, async () => {
          const response = await fetch("/api/platform/restricted-answers", {
            signal: owner.controller.signal,
          });
          if (!response.ok) throw new VaultRequestError(loadFailureMessage, response.status);
          const validated = await validateFoundationResponse(
            response,
            200,
            "RestrictedAnswerCollection",
            owner.controller.signal,
            requestTimeoutMilliseconds,
          );
          if (!validated.ok) throw new VaultRequestError(loadFailureMessage, validated.status);
          return (await validated.json()) as RestrictedAnswerCollection;
        });
        if (
          activeLoad.current === owner &&
          authenticatedRef.current &&
          sessionGeneration.current === generation
        ) {
          setAnswers(collection.answers);
          setMessage(undefined);
        }
      } catch {
        if (
          activeLoad.current === owner &&
          authenticatedRef.current &&
          sessionGeneration.current === generation
        ) {
          setMessage(loadFailureMessage);
        }
      } finally {
        if (activeLoad.current === owner) {
          activeLoad.current = undefined;
          if (sessionGeneration.current === generation) setLoading(false);
        }
      }
    },
    [cancelRequest, runWithDeadline],
  );

  useEffect(() => {
    const generation = ++sessionGeneration.current;
    cancelRequest(activeLoad.current);
    cancelRequest(activeMutation.current);
    activeLoad.current = undefined;
    activeMutation.current = undefined;
    saveIntent.current = undefined;
    setAnswers([]);
    setFieldKey("");
    setAnswerValue("");
    setQuestionContext("");
    setConfirmedSave(false);
    setMessage(undefined);
    setMutatingKey(undefined);
    setLoading(authenticated);
    if (authenticated) void loadAnswers(generation);
    return () => {
      if (sessionGeneration.current !== generation) return;
      cancelRequest(activeLoad.current);
      cancelRequest(activeMutation.current);
    };
  }, [authenticated, cancelRequest, loadAnswers]);

  function beginMutation(key: string): RequestOwner | undefined {
    if (!authenticatedRef.current || activeMutation.current) return undefined;
    const owner: RequestOwner = {
      generation: sessionGeneration.current,
      controller: new AbortController(),
      timeout: undefined,
      timedOut: false,
    };
    activeMutation.current = owner;
    setMutatingKey(key);
    setMessage(undefined);
    return owner;
  }

  function ownsMutation(owner: RequestOwner): boolean {
    return (
      activeMutation.current === owner &&
      authenticatedRef.current &&
      owner.generation === sessionGeneration.current
    );
  }

  async function saveAnswer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const definition = restrictedAnswerField(fieldKey);
    const normalizedContext = questionContext.trim() || undefined;
    const normalizedValue = answerValue.trim();
    if (!definition || !normalizedValue || !confirmedSave) {
      setMessage("Choose an answer, enter its value, and confirm that you want to save it.");
      return;
    }
    if (normalizedContext && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(normalizedContext)) {
      setMessage("Use a lowercase dotted context key, such as jurisdiction.us.");
      return;
    }

    const current = exactEntry(answers, fieldKey, normalizedContext);
    const signature = JSON.stringify({
      fieldKey,
      context: normalizedContext,
      value: normalizedValue,
      expectedVersion: current?.version ?? 0,
    });
    const path = `/api/platform/restricted-answers/${encodeURIComponent(fieldKey)}${contextQuery(normalizedContext)}`;
    const existingIntent = saveIntent.current;
    const intent: SaveIntent =
      existingIntent?.signature === signature
        ? existingIntent
        : {
            signature,
            path,
            idempotencyKey: `restricted-answer-${crypto.randomUUID()}`,
            body: JSON.stringify({
              expectedVersion: current?.version ?? 0,
              valueType: definition.valueType,
              value: normalizedValue,
              sensitivity: "restricted",
              sourceReference: "candidate.settings",
              confirmedAt: new Date().toISOString(),
            } satisfies SaveRestrictedAnswerRequest),
          };
    saveIntent.current = intent;
    const owner = beginMutation(fieldKey);
    if (!owner) return;

    try {
      const saved = await runWithDeadline(owner, async () => {
        const response = await fetch(intent.path, {
          method: "PUT",
          body: intent.body,
          signal: owner.controller.signal,
          headers: {
            "content-type": "application/json",
            "idempotency-key": intent.idempotencyKey,
          },
        });
        if (!response.ok) {
          throw new VaultRequestError(
            await candidateSafeProblemMessage(response, "restricted_answers"),
            response.status,
          );
        }
        const validated = await validateFoundationResponse(
          response,
          200,
          "RestrictedAnswer",
          owner.controller.signal,
          requestTimeoutMilliseconds,
        );
        if (!validated.ok) throw new VaultRequestError(loadFailureMessage, validated.status);
        return (await validated.json()) as RestrictedAnswer;
      });
      if (!ownsMutation(owner)) return;
      saveIntent.current = undefined;
      setAnswers((currentAnswers) => [
        ...currentAnswers.filter(
          (answer) => answer.fieldKey !== saved.fieldKey || answer.context !== saved.context,
        ),
        saved,
      ]);
      setAnswerValue("");
      setConfirmedSave(false);
      setMessage("Restricted answer saved. Its value is encrypted and is not displayed again.");
    } catch (error) {
      if (!ownsMutation(owner)) return;
      if (error instanceof VaultRequestError && error.status < 500) saveIntent.current = undefined;
      if (error instanceof VaultRequestError && error.status === 409) {
        await loadAnswers(owner.generation);
        if (authenticatedRef.current && sessionGeneration.current === owner.generation) {
          setMessage("This saved answer changed. The latest metadata is shown; review it again.");
        }
      } else {
        setMessage(
          owner.timedOut
            ? mutationTimeoutMessage
            : error instanceof VaultRequestError
              ? error.message
              : loadFailureMessage,
        );
      }
    } finally {
      if (activeMutation.current === owner) {
        activeMutation.current = undefined;
        if (owner.generation === sessionGeneration.current) setMutatingKey(undefined);
      }
    }
  }

  async function deleteAnswer(answer: RestrictedAnswer): Promise<void> {
    const owner = beginMutation(`${answer.fieldKey}:${answer.context ?? ""}`);
    if (!owner) return;
    try {
      const response = await runWithDeadline(owner, () =>
        fetch(
          `/api/platform/restricted-answers/${encodeURIComponent(answer.fieldKey)}${contextQuery(answer.context)}`,
          { method: "DELETE", signal: owner.controller.signal },
        ),
      );
      if (!response.ok) {
        throw new VaultRequestError(
          await candidateSafeProblemMessage(response, "restricted_answers"),
          response.status,
        );
      }
      if (response.status !== 204) throw new VaultRequestError(loadFailureMessage, 503);
      if (!ownsMutation(owner)) return;
      setAnswers((currentAnswers) =>
        currentAnswers.map((current) =>
          current.fieldKey === answer.fieldKey && current.context === answer.context
            ? { ...current, state: "deleted", version: current.version + 1 }
            : current,
        ),
      );
      await loadAnswers(owner.generation);
      if (authenticatedRef.current && sessionGeneration.current === owner.generation) {
        setMessage("Restricted answer deleted.");
      }
    } catch (error) {
      if (!ownsMutation(owner)) return;
      setMessage(
        owner.timedOut
          ? "Deleting timed out. Retry to confirm that the answer is deleted."
          : error instanceof VaultRequestError
            ? error.message
            : loadFailureMessage,
      );
    } finally {
      if (activeMutation.current === owner) {
        activeMutation.current = undefined;
        if (owner.generation === sessionGeneration.current) setMutatingKey(undefined);
      }
    }
  }

  const selectedDefinition = restrictedAnswerField(fieldKey);
  const activeAnswers = answers.filter((answer) => answer.state === "active");
  const controlsDisabled = loading || mutatingKey !== undefined;

  if (!authenticated) {
    return (
      <section className="restricted-answers" aria-labelledby="restricted-answers-heading">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Private answers</div>
            <h2 id="restricted-answers-heading">Restricted Answer Vault</h2>
          </div>
        </div>
        <p>Sign in to manage restricted answers.</p>
      </section>
    );
  }

  return (
    <section className="restricted-answers" aria-labelledby="restricted-answers-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Private answers</div>
          <h2 id="restricted-answers-heading">Restricted Answer Vault</h2>
        </div>
        <span>{activeAnswers.length} saved</span>
      </div>
      <p>
        Save only an answer you supplied and want reused. A saved answer can match only the exact
        field and optional context, and it must still be shown in final application review.
      </p>
      <p className="field-help">
        Values are separately encrypted and never displayed after saving. This page shows metadata
        only. Attestations, signatures, CAPTCHA, MFA, and challenge responses are never saved.
      </p>

      <form className="compact-form restricted-answer-form" onSubmit={saveAnswer}>
        <label>
          Restricted question
          <select
            value={fieldKey}
            onChange={(event) => {
              setFieldKey(event.target.value);
              setAnswerValue("");
              setConfirmedSave(false);
            }}
            disabled={controlsDisabled}
            required
          >
            <option value="">Choose a question</option>
            {restrictedAnswerFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Question context key
          <span>Optional. Use only when wording or jurisdiction changes the meaning.</span>
          <input
            value={questionContext}
            onChange={(event) => {
              setQuestionContext(event.target.value);
              setConfirmedSave(false);
            }}
            pattern="[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*"
            maxLength={120}
            placeholder="jurisdiction.us"
            disabled={controlsDisabled}
          />
        </label>
        {selectedDefinition?.valueType === "boolean" ? (
          <label>
            Answer
            <select
              value={answerValue}
              onChange={(event) => {
                setAnswerValue(event.target.value);
                setConfirmedSave(false);
              }}
              disabled={controlsDisabled}
              required
            >
              <option value="">Choose an answer</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        ) : (
          <label>
            Answer
            <span>Enter the exact option text you chose for this question.</span>
            <input
              value={answerValue}
              onChange={(event) => {
                setAnswerValue(event.target.value);
                setConfirmedSave(false);
              }}
              maxLength={3900}
              disabled={controlsDisabled || !selectedDefinition}
              required
            />
          </label>
        )}
        <label className="choice-option restricted-answer-confirmation">
          <input
            type="checkbox"
            checked={confirmedSave}
            onChange={(event) => setConfirmedSave(event.target.checked)}
            disabled={controlsDisabled || !selectedDefinition || !answerValue.trim()}
            required
          />
          I supplied this answer and choose to save it for exact-match reuse.
        </label>
        <button type="submit" disabled={controlsDisabled || !confirmedSave}>
          {mutatingKey === fieldKey ? "Saving…" : "Save restricted answer"}
        </button>
      </form>

      <h3>Saved metadata</h3>
      {loading ? (
        <p>Loading restricted answers…</p>
      ) : activeAnswers.length === 0 ? (
        <p>No restricted answers are saved.</p>
      ) : (
        <ul className="fact-list restricted-answer-list">
          {activeAnswers.map((answer) => {
            const definition = restrictedAnswerField(answer.fieldKey);
            const mutationKey = `${answer.fieldKey}:${answer.context ?? ""}`;
            const expired = answer.expiresAt
              ? new Date(answer.expiresAt).getTime() <= Date.now()
              : false;
            return (
              <li key={`${answer.fieldKey}:${answer.context ?? ""}`}>
                <div>
                  <strong>{definition?.label ?? answer.fieldKey}</strong>
                  <span>{answer.context ? `Context: ${answer.context}` : "No context"}</span>
                  <small>
                    {expired ? "Expired" : "Active"} · confirmed {displayDate(answer.confirmedAt)} ·
                    version {answer.version}
                  </small>
                </div>
                <div className="fact-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setFieldKey(answer.fieldKey);
                      setQuestionContext(answer.context ?? "");
                      setAnswerValue("");
                      setConfirmedSave(false);
                      setMessage("Enter the full replacement value. Saved values cannot be shown.");
                    }}
                    disabled={controlsDisabled}
                  >
                    Replace
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void deleteAnswer(answer)}
                    disabled={controlsDisabled}
                    aria-label={`Delete ${definition?.label ?? answer.fieldKey}${answer.context ? ` for ${answer.context}` : ""}`}
                  >
                    {mutatingKey === mutationKey ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
