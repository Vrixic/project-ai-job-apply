"use client";

import type { ProfileImportDraft } from "@ai-job-apply/api-contracts";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ResumeUploadForm } from "../resume-upload-form";
import { useApplicationBasics } from "../use-application-basics";
import { loadDrafts } from "./api";
import { EntrySection } from "./entry-section";
import { PersonalSection } from "./personal-section";
import { SalarySection } from "./salary-section";
import { ScreeningSection } from "./screening-section";
import { PROFILE_SECTIONS, type SectionKey } from "./sections";

type TabId = "personal" | SectionKey | "screening" | "salary" | "resume" | "preferences";

interface Tab {
  id: TabId;
  label: string;
}

const BASE_TABS: readonly Tab[] = [
  { id: "personal", label: "Personal" },
  { id: "education", label: "Education" },
  { id: "screening", label: "Screening questions" },
  { id: "salary", label: "Salary" },
  { id: "workExperience", label: "Work experience" },
  { id: "skill", label: "Skills" },
  { id: "applicationAnswer", label: "Application answers" },
  { id: "resume", label: "Resume" },
  { id: "preferences", label: "Job preferences" },
];

/**
 * The candidate's structured Profile (ADR-052): one page with a tab per section. Resume uploads
 * produce suggestions that only join the profile when the candidate saves them.
 */
export function ProfileArea({
  authenticated,
  name,
  email,
  preferences,
}: {
  authenticated: boolean;
  name?: string | undefined;
  email?: string | undefined;
  preferences: ReactNode;
}) {
  const tabs: readonly Tab[] = BASE_TABS;
  const [active, setActive] = useState<TabId>("personal");
  const basics = useApplicationBasics(authenticated);
  const stillNeeded = basics.missing.filter((item) => item.section === active);

  // The apply popup links here with the tab that still has something to fill in.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    const match = BASE_TABS.find((tab) => tab.id === wanted);
    if (match) setActive(match.id);
  }, []);
  // Coming back to a tab, or saving in one, is when what is still missing can have changed.
  const refreshBasics = basics.retry;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a tab change is the trigger
  useEffect(() => refreshBasics(), [active]);
  const [drafts, setDrafts] = useState<ProfileImportDraft[]>([]);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshDrafts = useCallback(async () => {
    if (!authenticated) return;
    try {
      const loaded = await loadDrafts();
      if (mounted.current) setDrafts(loaded);
    } catch {
      // Suggestions are optional; the saved profile still works without them.
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
      setDrafts([]);
      return;
    }
    void refreshDrafts();
  }, [authenticated, refreshDrafts]);

  const draftsFor = (section: SectionKey | "personal") =>
    drafts.filter((draft) => draft.section === section);
  const pending = drafts.length;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    setActive(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  const badge = (id: TabId): number =>
    id === "personal" || id in PROFILE_SECTIONS
      ? draftsFor(id as SectionKey | "personal").length
      : 0;

  return (
    <section aria-label="Profile" className="profile-area">
      {pending > 0 && (
        <output className="profile-import-banner" aria-live="polite">
          {pending === 1
            ? "1 detail found in your resume is waiting for your review."
            : `${pending} details found in your resume are waiting for your review.`}
        </output>
      )}
      <div role="tablist" aria-label="Profile sections" className="profile-tablist">
        {tabs.map((tab, index) => {
          const count = badge(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`profile-tab-${tab.id}`}
              aria-selected={active === tab.id}
              aria-controls={`profile-panel-${tab.id}`}
              tabIndex={active === tab.id ? 0 : -1}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
              {count > 0 && <span className="profile-tab-count"> ({count} to review)</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`profile-panel-${tab.id}`}
          aria-labelledby={`profile-tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {active === tab.id && (
            <>
              {stillNeeded.length > 0 && (
                <output className="profile-import-banner" aria-live="polite">
                  Still needed before you can apply:{" "}
                  {stillNeeded.map((item) => item.label).join("; ")}.
                </output>
              )}
              {tab.id === "personal" && (
                <PersonalSection
                  authenticated={authenticated}
                  name={name}
                  email={email}
                  drafts={draftsFor("personal")}
                  onDraftsChanged={() => void refreshDrafts()}
                />
              )}
              {tab.id in PROFILE_SECTIONS && (
                <EntrySection
                  section={PROFILE_SECTIONS[tab.id as SectionKey]}
                  authenticated={authenticated}
                  drafts={draftsFor(tab.id as SectionKey)}
                  onDraftsChanged={() => void refreshDrafts()}
                />
              )}
              {tab.id === "resume" && (
                <section aria-labelledby="profile-resume-heading">
                  <div className="section-heading">
                    <h2 id="profile-resume-heading">Resume</h2>
                  </div>
                  <p className="field-help">
                    Details found in an uploaded resume appear as suggestions in the other tabs.
                    Nothing joins your profile until you save it.
                  </p>
                  <ResumeUploadForm
                    authenticated={authenticated}
                    onDocumentParsed={() => void refreshDrafts()}
                    onDocumentDeleted={() => void refreshDrafts()}
                  />
                </section>
              )}
              {tab.id === "screening" && (
                <ScreeningSection authenticated={authenticated} onSaved={refreshBasics} />
              )}
              {tab.id === "salary" && (
                <SalarySection authenticated={authenticated} onSaved={refreshBasics} />
              )}
              {tab.id === "preferences" && preferences}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
