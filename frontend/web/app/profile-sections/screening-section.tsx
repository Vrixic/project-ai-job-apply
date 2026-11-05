"use client";

import type { ProfileApplicationAnswer } from "@ai-job-apply/api-contracts";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { SCREENING_QUESTIONS, savedAnswerFor, yesNo } from "../../lib/screening-questions";
import { createEntry, loadEntries, updateEntry } from "./api";
import { PROFILE_SECTIONS } from "./sections";

const section = PROFILE_SECTIONS.applicationAnswer;

/**
 * The screening questions every application asks, answered once. Each answer is saved as an ordinary
 * saved answer and an application uses it exactly as chosen.
 */
export function ScreeningSection({
  authenticated,
  onSaved,
}: {
  authenticated: boolean;
  onSaved?: () => void;
}) {
  const id = useId();
  const [records, setRecords] = useState<ProfileApplicationAnswer[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
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
      const loaded = (await loadEntries(section)) as ProfileApplicationAnswer[];
      if (mounted.current) setRecords(loaded);
    } catch {
      if (mounted.current) setMessage("Your saved answers are temporarily unavailable.");
    }
  }, [authenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(question: string, answer: "Yes" | "No") {
    setBusy(true);
    setMessage(undefined);
    try {
      const existing = savedAnswerFor(records, question);
      if (existing) await updateEntry(section, existing, { answer });
      else await createEntry(section, { question, answer });
      await load();
      if (mounted.current) setMessage("Saved.");
      onSaved?.();
    } catch {
      if (mounted.current) setMessage("That did not save. Try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="section-heading">
        <h2 id={`${id}-heading`}>Screening questions</h2>
      </div>
      <p className="field-help">
        Employers ask these on almost every application. Answer once; the extension fills them
        exactly as you choose.
      </p>
      <ul>
        {SCREENING_QUESTIONS.map((item) => {
          const saved = yesNo(savedAnswerFor(records, item.question)?.answer);
          return (
            <li key={item.fieldKey}>
              <label htmlFor={`${id}-${item.fieldKey}`}>{item.question}</label>
              <select
                id={`${id}-${item.fieldKey}`}
                disabled={busy || !authenticated}
                value={saved === undefined ? "" : saved ? "Yes" : "No"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "Yes" || value === "No") void save(item.question, value);
                }}
              >
                <option value="" disabled>
                  Choose your answer
                </option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
