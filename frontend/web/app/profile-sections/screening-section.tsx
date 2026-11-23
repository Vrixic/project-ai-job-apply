"use client";

import type { ProfileApplicationAnswer } from "@ai-job-apply/api-contracts";
import type { ProfileQuestion } from "@ai-job-apply/ats-sdk/profile-questions";
import {
  formatCountryCodes,
  parseCountryCodes,
  profileQuestionValue,
} from "@ai-job-apply/ats-sdk/profile-questions";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { countries, countryName } from "../../lib/countries";
import {
  EQUAL_EMPLOYMENT_QUESTIONS,
  SCREENING_QUESTIONS,
  savedAnswerFor,
} from "../../lib/screening-questions";
import { createEntry, deleteEntry, loadEntries, updateEntry } from "./api";
import { PROFILE_SECTIONS } from "./sections";

const section = PROFILE_SECTIONS.applicationAnswer;
const NOT_ANSWERED = "";

/**
 * Questions answered once by choosing, never by typing (ADR-062, amended 2026-11-23). Each answer is
 * saved as an ordinary saved answer under the question's exact text, and an application uses it as
 * chosen. An optional question can be set back to "Not answered", which removes the saved answer.
 */
function ProfileQuestionsSection({
  title,
  intro,
  questions,
  authenticated,
  onSaved,
}: {
  title: string;
  intro: string;
  questions: readonly ProfileQuestion[];
  authenticated: boolean;
  onSaved?: (() => void) | undefined;
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

  async function save(item: ProfileQuestion, answer: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      const existing = savedAnswerFor(records, item.question);
      if (answer === NOT_ANSWERED) {
        if (existing) await deleteEntry(section, existing);
      } else if (existing) await updateEntry(section, existing, { answer });
      else await createEntry(section, { question: item.question, answer });
      await load();
      if (mounted.current) setMessage("Saved.");
      onSaved?.();
    } catch {
      if (mounted.current) setMessage("That did not save. Try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const disabled = busy || !authenticated;

  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="section-heading">
        <h2 id={`${id}-heading`}>{title}</h2>
      </div>
      <p className="field-help">{intro}</p>
      <ul className="profile-questions">
        {questions.map((item) => {
          const saved = profileQuestionValue(item, savedAnswerFor(records, item.question)?.answer);
          const fieldId = `${id}-${item.fieldKey}`;
          return (
            <li key={item.fieldKey}>
              <label htmlFor={fieldId}>
                {item.label}
                {item.required || item.group === "equal_employment" ? null : (
                  <span className="field-optional"> (optional)</span>
                )}
              </label>
              {item.kind === "countries" ? (
                <CountryPicker
                  id={fieldId}
                  selected={parseCountryCodes(typeof saved === "string" ? saved : undefined)}
                  disabled={disabled}
                  onChange={(codes) => void save(item, formatCountryCodes(codes) ?? NOT_ANSWERED)}
                />
              ) : (
                <select
                  id={fieldId}
                  disabled={disabled}
                  value={
                    saved === undefined
                      ? NOT_ANSWERED
                      : saved === true
                        ? "Yes"
                        : saved === false
                          ? "No"
                          : saved
                  }
                  onChange={(event) => void save(item, event.target.value)}
                >
                  <option value={NOT_ANSWERED} disabled={item.required === true}>
                    {item.required ? "Choose your answer" : "Not answered"}
                  </option>
                  {(item.kind === "yes_no" ? ["Yes", "No"] : (item.options ?? [])).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}
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

/** A country multi-select: choose one to add it, remove one with its button. */
function CountryPicker({
  id,
  selected,
  disabled,
  onChange,
}: {
  id: string;
  selected: readonly string[];
  disabled: boolean;
  onChange: (codes: string[]) => void;
}) {
  return (
    <div className="country-picker">
      {selected.length > 0 && (
        <ul className="country-chips" aria-label="Chosen countries">
          {selected.map((code) => (
            <li key={code}>
              {countryName(code)}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${countryName(code)}`}
                onClick={() => onChange(selected.filter((other) => other !== code))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        id={id}
        disabled={disabled}
        value=""
        onChange={(event) => {
          const code = event.target.value;
          if (code && !selected.includes(code)) onChange([...selected, code]);
        }}
      >
        <option value="">{selected.length ? "Add another country" : "Choose a country"}</option>
        {countries()
          .filter((country) => !selected.includes(country.code))
          .map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
      </select>
    </div>
  );
}

export function ScreeningSection({
  authenticated,
  onSaved,
}: {
  authenticated: boolean;
  onSaved?: () => void;
}) {
  return (
    <ProfileQuestionsSection
      title="Screening questions"
      intro="Employers ask these on almost every application. Answer once; the extension fills them exactly as you choose."
      questions={SCREENING_QUESTIONS}
      authenticated={authenticated}
      onSaved={onSaved}
    />
  );
}

export function EqualEmploymentSection({ authenticated }: { authenticated: boolean }) {
  return (
    <ProfileQuestionsSection
      title="Equal employment"
      intro="Voluntary self-identification that many employers ask for. Every question is optional, and answering never affects whether you can apply."
      questions={EQUAL_EMPLOYMENT_QUESTIONS}
      authenticated={authenticated}
    />
  );
}
