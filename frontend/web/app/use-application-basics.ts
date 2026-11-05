"use client";

import {
  compileComponentValidator,
  type ProfileEducationEntry,
  type RestrictedAnswer,
} from "@ai-job-apply/api-contracts";
import { useCallback, useEffect, useState } from "react";
import { type MissingBasic, missingBasics } from "../lib/application-basics";
import { isRestrictedAnswerVaultUiEnabled } from "../lib/restricted-answer-fields";
import { loadEntries, loadPersonal } from "./profile-sections/api";
import { PROFILE_SECTIONS } from "./profile-sections/sections";

const validAnswers = compileComponentValidator("RestrictedAnswerCollection");

async function loadRestricted(signal: AbortSignal): Promise<readonly RestrictedAnswer[]> {
  const response = await fetch("/api/platform/restricted-answers", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("unavailable");
  const body: unknown = await response.json();
  if (!validAnswers(body)) throw new Error("unavailable");
  return (body as { answers: RestrictedAnswer[] }).answers;
}

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
    const controller = new AbortController();
    const check = () => {
      void (async () => {
        try {
          const [personal, entries, restricted] = await Promise.all([
            loadPersonal(),
            loadEntries(PROFILE_SECTIONS.education),
            isRestrictedAnswerVaultUiEnabled() ? loadRestricted(controller.signal) : undefined,
          ]);
          if (controller.signal.aborted) return;
          setState({
            status: "ready",
            missing: missingBasics({
              personal,
              education: entries as ProfileEducationEntry[],
              restricted,
            }),
          });
        } catch {
          if (!controller.signal.aborted) setState({ status: "unavailable", missing: [] });
        }
      })();
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      controller.abort();
      window.removeEventListener("focus", check);
    };
  }, [enabled, attempt]);

  return { ...state, retry };
}
