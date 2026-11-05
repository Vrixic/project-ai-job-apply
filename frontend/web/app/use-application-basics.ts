"use client";

import type { ProfileEducationEntry } from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { type MissingBasic, missingBasics } from "../lib/application-basics";
import { loadEntries, loadPersonal } from "./profile-sections/api";
import { PROFILE_SECTIONS } from "./profile-sections/sections";

export interface ApplicationBasics {
  status: "loading" | "ready" | "unavailable";
  missing: readonly MissingBasic[];
  retry(): void;
}

/**
 * Checks the candidate's saved Profile for the basics every application needs. It fails closed: a
 * profile that cannot be read is not a complete one. It checks again when the candidate comes back to
 * this tab, since they complete the basics in the Profile.
 */
export function useApplicationBasics(enabled: boolean): ApplicationBasics {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "unavailable";
    missing: readonly MissingBasic[];
  }>({ status: "loading", missing: [] });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const check = () => {
      void (async () => {
        try {
          const [personal, entries] = await Promise.all([
            loadPersonal(),
            loadEntries(PROFILE_SECTIONS.education),
          ]);
          if (!current) return;
          setState({
            status: "ready",
            missing: missingBasics({ personal, education: entries as ProfileEducationEntry[] }),
          });
        } catch {
          if (current) setState({ status: "unavailable", missing: [] });
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
