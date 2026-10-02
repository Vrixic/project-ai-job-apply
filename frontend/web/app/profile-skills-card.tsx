"use client";

import type { CreateProfileFactRequest, ProfileFact } from "@ai-job-apply/api-contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { candidateSafeProblemMessage } from "../lib/candidate-safe-problem";
import { validateFoundationResponse } from "../lib/foundation-response-bff";

const requestTimeoutMilliseconds = 20_000;
const skillsFactKey = "skills";
const loadFailureMessage = "Skills are temporarily unavailable.";
const saveFailureMessage = "Could not save your skills. Try again.";

function findSkillsFact(facts: readonly ProfileFact[]): ProfileFact | undefined {
  const candidates = facts.filter(
    (fact) =>
      fact.kind === "skill" &&
      fact.key === skillsFactKey &&
      fact.availability?.state !== "invalidated",
  );
  return candidates.reduce<ProfileFact | undefined>(
    (latest, fact) => (!latest || fact.updatedAt > latest.updatedAt ? fact : latest),
    undefined,
  );
}

export function ProfileSkillsCard({ authenticated }: { authenticated: boolean }) {
  const [fact, setFact] = useState<ProfileFact>();
  const [loading, setLoading] = useState(authenticated);
  const [newSkill, setNewSkill] = useState("");
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
      setFact(undefined);
      setLoading(false);
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
        setFact(findSkillsFact(collection.facts));
      } catch {
        if (mounted.current) setMessage(loadFailureMessage);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
  }, [authenticated]);

  const skills = Array.isArray(fact?.value) ? fact.value : [];

  async function saveSkills(nextSkills: string[]) {
    setSaving(true);
    setMessage(undefined);
    try {
      const signal = AbortSignal.timeout(requestTimeoutMilliseconds);
      const response = fact
        ? await fetch(`/api/platform/profile-facts/${encodeURIComponent(fact.id)}`, {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "idempotency-key": `profile-fact-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({ expectedVersion: fact.version, value: nextSkills }),
            signal,
          })
        : await fetch("/api/platform/profile-facts", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": `profile-fact-${crypto.randomUUID()}`,
            },
            body: JSON.stringify({
              kind: "skill",
              key: skillsFactKey,
              value: nextSkills,
              sensitivity: "standard",
            } satisfies CreateProfileFactRequest),
            signal,
          });
      if (!response.ok) {
        throw new Error(await candidateSafeProblemMessage(response, "profile_facts"));
      }
      const validated = await validateFoundationResponse(response, fact ? 200 : 201, "ProfileFact");
      if (!validated.ok) throw new Error(saveFailureMessage);
      const saved = (await validated.json()) as ProfileFact;
      if (!mounted.current) return;
      setFact(saved);
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error ? error.message : saveFailureMessage);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  function addSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newSkill.trim();
    if (!trimmed || skills.includes(trimmed) || skills.length >= 100) return;
    setNewSkill("");
    void saveSkills([...skills, trimmed]);
  }

  function removeSkill(skill: string) {
    void saveSkills(skills.filter((current) => current !== skill));
  }

  if (!authenticated) return null;

  return (
    <section className="profile-skills" aria-labelledby="profile-skills-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Skills</div>
          <h2 id="profile-skills-heading">Skills</h2>
        </div>
        <span>{skills.length} added</span>
      </div>

      {loading ? (
        <p>Loading skills…</p>
      ) : (
        <>
          {skills.length > 0 && (
            <ul className="skill-tag-list">
              {skills.map((skill) => (
                <li key={skill} className="skill-tag">
                  {skill}
                  <button
                    type="button"
                    aria-label={`Remove skill ${skill}`}
                    onClick={() => removeSkill(skill)}
                    disabled={saving}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="skill-add-form" onSubmit={addSkill}>
            <input
              aria-label="Add a skill"
              value={newSkill}
              onChange={(event) => setNewSkill(event.target.value)}
              placeholder="Add a skill"
              maxLength={500}
              disabled={saving || skills.length >= 100}
            />
            <button type="submit" disabled={saving || !newSkill.trim() || skills.length >= 100}>
              {saving ? "Saving…" : "Add"}
            </button>
          </form>
        </>
      )}
      {message && <output aria-live="polite">{message}</output>}
    </section>
  );
}
