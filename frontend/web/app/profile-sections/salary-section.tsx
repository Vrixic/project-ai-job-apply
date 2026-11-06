"use client";

import type { ProfileApplicationAnswer } from "@ai-job-apply/api-contracts";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  formatSalary,
  parseSalaryInput,
  SALARY_QUESTION,
  salaryRecord,
  savedSalary,
} from "../../lib/salary-expectation";
import { createEntry, loadEntries, updateEntry } from "./api";
import { PROFILE_SECTIONS } from "./sections";

const section = PROFILE_SECTIONS.applicationAnswer;

/**
 * The annual salary the candidate wants, set once. Applications answer every salary question from
 * it. It is saved as an ordinary saved answer, so nothing else in the Profile changes.
 */
export function SalarySection({
  authenticated,
  onSaved,
}: {
  authenticated: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [records, setRecords] = useState<ProfileApplicationAnswer[]>([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!authenticated) return;
    try {
      const entries = (await loadEntries(section)) as ProfileApplicationAnswer[];
      if (!mounted.current) return;
      setRecords(entries);
      const saved = savedSalary(entries);
      if (saved !== undefined) setText(String(saved));
      setLoaded(true);
    } catch {
      if (mounted.current) setMessage("Your saved salary is temporarily unavailable.");
    }
  }, [authenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const parsed = parseSalaryInput(text);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const existing = salaryRecord(records);
      const answer = String(parsed.amount);
      if (existing) await updateEntry(section, existing, { answer });
      else await createEntry(section, { question: SALARY_QUESTION, answer });
      await load();
      if (mounted.current) {
        setText(answer);
        setMessage("Saved.");
      }
      onSaved?.();
    } catch {
      if (mounted.current) setMessage("That did not save. Try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const saved = savedSalary(records);
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="section-heading">
        <h2 id={`${id}-heading`}>Salary</h2>
      </div>
      <p className="field-help">
        The annual salary you want, in US dollars. Applications use it to answer salary questions: a
        box gets this number, a list of ranges gets the range that holds it (the closest one if none
        does), and "does the posted salary meet your expectations?" gets Yes unless the posted range
        tops out below it. Questions about an hourly rate or another currency are left to you.
      </p>
      <div className="profile-entry-field">
        <label htmlFor={`${id}-salary`}>Desired annual salary (US dollars)</label>
        <input
          id={`${id}-salary`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="120000"
          value={text}
          disabled={busy || !authenticated}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
      </div>
      <div className="profile-entry-actions">
        <button type="button" disabled={busy || !authenticated} onClick={() => void save()}>
          {busy ? "Saving..." : "Save salary"}
        </button>
      </div>
      {loaded && saved !== undefined && (
        <p className="field-help">Currently saved: ${formatSalary(saved)} a year.</p>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
