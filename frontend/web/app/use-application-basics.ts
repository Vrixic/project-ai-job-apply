"use client";

import type {
  JobPreferenceSet,
  ProfileApplicationAnswer,
  ProfileEducationEntry,
  RestrictedAnswerCollection,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";
import {
  type BasicsPreferences,
  type MissingBasic,
  missingBasics,
} from "../lib/application-basics";
import { isRestrictedAnswerVaultUiEnabled } from "../lib/restricted-answer-fields";
import { savedSalary } from "../lib/salary-expectation";
import { type ScreeningFieldKey, screeningAnswers } from "../lib/screening-questions";
import { loadEntries, loadPersonal } from "./profile-sections/api";
import { PROFILE_SECTIONS } from "./profile-sections/sections";

/** The screening answers are required once the Profile service saves them (a deployment step). */
export function screeningRequired(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NEXT_PUBLIC_SCREENING_ANSWERS_REQUIRED === "enabled";
}

/** The saved Job preferences, or null when none are saved. Throws when they cannot be read. */
async function loadPreferences(): Promise<BasicsPreferences | null> {
  const response = await fetch("/api/platform/job-preferences", { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("preferences unavailable");
  const saved = (await response.json()) as Partial<JobPreferenceSet>;
  return {
    relocation: saved.relocation,
    noticePeriod: saved.noticePeriod,
    availableStartDate: saved.availableStartDate,
  };
}

/** Which required sensitive answers are saved, or undefined while that tab is off. */
async function loadSensitive(): Promise<
  { workCountries: boolean; sponsorship: boolean } | undefined
> {
  if (
    !isRestrictedAnswerVaultUiEnabled({
      NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI: process.env.NEXT_PUBLIC_RESTRICTED_ANSWER_VAULT_UI,
    })
  )
    return undefined;
  const response = await fetch("/api/platform/restricted-answers", { cache: "no-store" });
  if (!response.ok) throw new Error("sensitive answers unavailable");
  const { answers } = (await response.json()) as RestrictedAnswerCollection;
  const active = (key: string) =>
    answers.some((answer) => answer.fieldKey === key && answer.state === "active");
  return {
    workCountries: active("authorization.work_countries"),
    sponsorship: active("authorization.sponsorship_required"),
  };
}

export interface ApplicationBasics {
  status: "loading" | "ready" | "unavailable";
  missing: readonly MissingBasic[];
  /** The candidate's screening answers, as the entries an application is prepared with. */
  answers: Partial<Record<ScreeningFieldKey, boolean>>;
  /** The annual salary the candidate set, which an application carries for salary questions. */
  salary: number | undefined;
  retry(): void;
}

/**
 * Checks the candidate's saved Profile for the basics and screening answers every application needs.
 * It fails closed: a profile that cannot be read is not a complete one. It checks again when the
 * candidate comes back to this tab, since they complete the basics in the Profile.
 */
export function useApplicationBasics(enabled: boolean): ApplicationBasics {
  const [state, setState] = useState<Omit<ApplicationBasics, "retry">>({
    status: "loading",
    missing: [],
    answers: {},
    salary: undefined,
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a retry is the trigger
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const check = () => {
      void (async () => {
        try {
          const [personal, entries, saved, work, preferences, sensitive] = await Promise.all([
            loadPersonal(),
            loadEntries(PROFILE_SECTIONS.education),
            loadEntries(PROFILE_SECTIONS.applicationAnswer),
            loadEntries(PROFILE_SECTIONS.workExperience),
            loadPreferences(),
            loadSensitive(),
          ]);
          if (!current) return;
          const answers = screeningAnswers(saved as ProfileApplicationAnswer[]);
          const salary = savedSalary(saved as ProfileApplicationAnswer[]);
          setState({
            status: "ready",
            answers,
            salary,
            missing: missingBasics({
              personal,
              education: entries as ProfileEducationEntry[],
              screening: answers,
              requireScreening: screeningRequired(),
              salary,
              workExperienceCount: work.length,
              preferences,
              ...(sensitive ? { sensitive } : {}),
            }),
          });
        } catch {
          if (current)
            setState({ status: "unavailable", missing: [], answers: {}, salary: undefined });
        }
      })();
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      current = false;
      window.removeEventListener("focus", check);
    };
  }, [enabled, attempt]);

  return { ...state, retry };
}
