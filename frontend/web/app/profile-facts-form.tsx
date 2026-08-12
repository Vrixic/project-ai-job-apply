"use client";

import type {
  CreateProfileFactRequest,
  ProfileFact,
  ProfileFactCollection,
  UpdateProfileFactRequest,
} from "@ai-job-apply/api-contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

const kinds: Array<{ value: CreateProfileFactRequest["kind"]; label: string }> = [
  { value: "identity", label: "Contact or identity" },
  { value: "employment", label: "Employment" },
  { value: "education", label: "Education" },
  { value: "project", label: "Project" },
  { value: "skill", label: "Skill" },
  { value: "certification", label: "Certification" },
  { value: "preference", label: "Application preference" },
];

async function factRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const problem = (await response.json()) as { detail?: string; title?: string };
    throw new Error(problem.detail ?? problem.title ?? "The profile fact request failed");
  }
  return (await response.json()) as T;
}

function displayValue(value: ProfileFact["value"]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function ProfileFactsForm({ authenticated }: { authenticated: boolean }) {
  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [kind, setKind] = useState<CreateProfileFactRequest["kind"]>("skill");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<ProfileFact>();
  const [editedValue, setEditedValue] = useState("");
  const [loading, setLoading] = useState(authenticated);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    if (!authenticated) {
      setLoading(false);
      setFacts([]);
      return;
    }
    setLoading(true);
    try {
      const collection = await factRequest<ProfileFactCollection>("/api/platform/profile-facts");
      setFacts(collection.facts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load profile facts");
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createFact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      const created = await factRequest<ProfileFact>("/api/platform/profile-facts", {
        method: "POST",
        headers: { "idempotency-key": `profile-fact-${crypto.randomUUID()}` },
        body: JSON.stringify({
          kind,
          key: key.trim(),
          value: value.trim(),
          sensitivity: "standard",
        }),
      });
      setFacts((current) => [...current, created]);
      setKey("");
      setValue("");
      setMessage("Profile fact saved as confirmed user input.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save profile fact");
    } finally {
      setSaving(false);
    }
  }

  async function updateFact(
    fact: ProfileFact,
    command: Omit<UpdateProfileFactRequest, "expectedVersion">,
  ) {
    setSaving(true);
    setMessage(undefined);
    try {
      const updated = await factRequest<ProfileFact>(
        `/api/platform/profile-facts/${encodeURIComponent(fact.id)}`,
        {
          method: "PATCH",
          headers: { "idempotency-key": `profile-fact-${crypto.randomUUID()}` },
          body: JSON.stringify({ expectedVersion: fact.version, ...command }),
        },
      );
      setFacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditing(undefined);
      setMessage("A new profile fact version was saved. Prior versions remain auditable.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update profile fact");
    } finally {
      setSaving(false);
    }
  }

  function beginCorrection(fact: ProfileFact) {
    setEditing(fact);
    setEditedValue(displayValue(fact.value));
  }

  return (
    <section className="profile-facts" aria-labelledby="profile-facts-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Truth profile</div>
          <h2 id="profile-facts-heading">Your profile facts</h2>
        </div>
        <span>{facts.filter((fact) => fact.verification === "confirmed").length} confirmed</span>
      </div>
      <p>
        Add only facts that are true. Corrections create a new version; no extracted or generated
        fact is silently confirmed.
      </p>

      {loading ? (
        <p>Loading profile facts…</p>
      ) : facts.length === 0 ? (
        <p>No profile facts saved yet.</p>
      ) : (
        <ul className="fact-list">
          {facts.map((fact) => (
            <li key={fact.id}>
              <div>
                <strong>{fact.key}</strong>
                <span>{displayValue(fact.value)}</span>
                <small>
                  {fact.kind} · {fact.verification} · version {fact.version}
                </small>
              </div>
              <div className="fact-actions">
                <button type="button" onClick={() => beginCorrection(fact)} disabled={saving}>
                  Correct
                </button>
                {fact.verification !== "rejected" && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void updateFact(fact, { verification: "rejected" })}
                    disabled={saving}
                  >
                    Reject
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
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
              required
            />
          </label>
          <div className="fact-actions">
            <button type="submit" disabled={saving}>
              Save correction
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <form className="compact-form" onSubmit={createFact}>
        <label>
          Fact category
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fact name
          <span>For example: programming language, degree, or employer</span>
          <input value={key} onChange={(event) => setKey(event.target.value)} required />
        </label>
        <label>
          Confirmed value
          <input value={value} onChange={(event) => setValue(event.target.value)} required />
        </label>
        <button type="submit" disabled={!authenticated || loading || saving}>
          {saving ? "Saving…" : "Add confirmed fact"}
        </button>
      </form>
      {message && <output>{message}</output>}
    </section>
  );
}
