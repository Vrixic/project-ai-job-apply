"use client";

import type { ProfileApplicationAnswer, ProfileEducationEntry } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { type MissingBasic, missingBasics } from "../lib/application-basics";
import { type ScreeningFieldKey, screeningAnswers } from "../lib/screening-questions";
import { loadEntries, loadPersonal } from "./profile-sections/api";
import { PROFILE_SECTIONS } from "./profile-sections/sections";

/** The screening answers are required once the Profile service saves them (a deployment step). */
export function screeningRequired(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NEXT_PUBLIC_SCREENING_ANSWERS_REQUIRED === "enabled";
}

export interface ApplicationBasics {
  status: "loading" | "ready" | "unavailable";
  missing: readonly MissingBasic[];
  /** The candidate's screening answers, as the entries an application is prepared with. */
  answers: Partial<Record<ScreeningFieldKey, boolean>>;
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
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const check = () => {
      void (async () => {
        try {
          const [personal, entries, saved] = await Promise.all([
            loadPersonal(),
            loadEntries(PROFILE_SECTIONS.education),
            loadEntries(PROFILE_SECTIONS.applicationAnswer),
          ]);
          if (!current) return;
          const answers = screeningAnswers(saved as ProfileApplicationAnswer[]);
          setState({
            status: "ready",
            answers,
            missing: missingBasics({
              personal,
              education: entries as ProfileEducationEntry[],
              screening: answers,
              requireScreening: screeningRequired(),
            }),
          });
        } catch {
          if (current) setState({ status: "unavailable", missing: [], answers: {} });
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
