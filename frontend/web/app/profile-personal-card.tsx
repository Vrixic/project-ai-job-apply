"use client";

import type { CreateProfileFactRequest, ProfileFact } from "@ai-job-apply/api-contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { candidateSafeProblemMessage } from "../lib/candidate-safe-problem";
import { validateFoundationResponse } from "../lib/foundation-response-bff";

const requestTimeoutMilliseconds = 20_000;
const loadFailureMessage = "Personal details are temporarily unavailable.";
const saveFailureMessage = "Could not save your personal details. Try again.";

interface PersonalField {
  key: string;
  label: string;
  placeholder: string;
}

const personalFields: readonly PersonalField[] = [
  { key: "location", label: "Location", placeholder: "City, state" },
  { key: "phone", label: "Phone", placeholder: "+1 555 000 0000" },
  { key: "linkedin_url", label: "LinkedIn", placeholder: "https://linkedin.com/in/you" },
  { key: "github_url", label: "GitHub", placeholder: "https://github.com/you" },
] as const;

function latestByKey(facts: readonly ProfileFact[]): Map<string, ProfileFact> {
  const byKey = new Map<string, ProfileFact>();
  for (const fact of facts) {
    if (fact.kind !== "identity" || fact.availability?.state === "invalidated") continue;
    if (!personalFields.some((field) => field.key === fact.key)) continue;
    const current = byKey.get(fact.key);
    if (!current || fact.updatedAt > current.updatedAt) byKey.set(fact.key, fact);
  }
  return byKey;
}

export function ProfilePersonalCard({
  authenticated,
  name,
  email,
}: {
  authenticated: boolean;
  name?: string | undefined;
  email?: string | undefined;
}) {
  const [facts, setFacts] = useState<Map<string, ProfileFact>>(new Map());
  const [loading, setLoading] = useState(authenticated);
  const [editing, setEditing] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setFacts(new Map());
      setLoading(false);
      setEditing(false);
      setMessage(undefined);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const response = await fetch("/api/platform/profile-facts", {
          signal: AbortSignal.timeout(requestTimeoutMilliseconds),
        });
        if (!response.ok) throw new Error(loadFailureMessage);
        const validated = await validateFoundationResponse(response, 200, "ProfileFactCollection");
        if (!validated.ok) throw new Error(loadFailureMessage);
        const collection = (await validated.json()) as { facts: ProfileFact[] };
        if (!mounted.current) return;
        setFacts(latestByKey(collection.facts));
      } catch {
        if (mounted.current) setMessage(loadFailureMessage);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [authenticated]);

  function beginEditing() {
    setFieldValues(
      Object.fromEntries(
        personalFields.map((field) => [field.key, facts.get(field.key)?.value ?? ""]),
      ) as Record<string, string>,
    );
    setMessage(undefined);
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    const nextFacts = new Map(facts);
    try {
      for (const field of personalFields) {
        const nextValue = (fieldValues[field.key] ?? "").trim();
        const existing = facts.get(field.key);
        if (!nextValue) continue;
        if (existing && existing.value === nextValue) continue;
        const signal = AbortSignal.timeout(requestTimeoutMilliseconds);
        const response = existing
          ? await fetch(`/api/platform/profile-facts/${encodeURIComponent(existing.id)}`, {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
                "idempotency-key": `profile-fact-${crypto.randomUUID()}`,
              },
              body: JSON.stringify({ expectedVersion: existing.version, value: nextValue }),
              signal,
            })
          : await fetch("/api/platform/profile-facts", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "idempotency-key": `profile-fact-${crypto.randomUUID()}`,
              },
              body: JSON.stringify({
                kind: "identity",
                key: field.key,
                value: nextValue,
                sensitivity: "standard",
              } satisfies CreateProfileFactRequest),
              signal,
            });
        if (!response.ok) {
          throw new Error(await candidateSafeProblemMessage(response, "profile_facts"));
        }
        const validated = await validateFoundationResponse(
          response,
          existing ? 200 : 201,
          "ProfileFact",
        );
        if (!validated.ok) throw new Error(saveFailureMessage);
        const saved = (await validated.json()) as ProfileFact;
        nextFacts.set(field.key, saved);
      }
      if (!mounted.current) return;
      setFacts(nextFacts);
      setEditing(false);
      setMessage("Personal details saved.");
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error ? error.message : saveFailureMessage);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  if (!authenticated) return null;

  return (
    <section className="profile-personal" aria-labelledby="profile-personal-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Personal</div>
          <h2 id="profile-personal-heading">{name ?? "Your profile"}</h2>
        </div>
        {!editing && (
          <button
            type="button"
            className="secondary-button"
            onClick={beginEditing}
            disabled={loading}
          >
            Edit
          </button>
        )}
      </div>

      {loading ? (
        <p>Loading personal details…</p>
      ) : editing ? (
        <form className="personal-field-form" onSubmit={save}>
          {personalFields.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                value={fieldValues[field.key] ?? ""}
                placeholder={field.placeholder}
                maxLength={500}
                onChange={(event) =>
                  setFieldValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
                disabled={saving}
              />
            </label>
          ))}
          <div className="fact-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="personal-field-list">
          {email && (
            <div>
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
          )}
          {personalFields.map((field) => {
            const value = facts.get(field.key)?.value;
            return value ? (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{String(value)}</dd>
              </div>
            ) : null;
          })}
        </dl>
      )}
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
