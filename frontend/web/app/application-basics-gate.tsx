import React from "react";
import type { ApplicationBasics } from "./use-application-basics";

const SECTION_NAME = {
  personal: "Personal",
  education: "Education",
} as const;

/**
 * Shown in place of the Apply step until the candidate's Profile holds the basics every application
 * asks. It names what is missing and where to add it; nothing is filled in for them.
 */
export function ApplicationBasicsGate({ basics }: { basics: ApplicationBasics }) {
  if (basics.status === "loading")
    return <p role="status">Checking that your profile has the basics for applying...</p>;
  if (basics.status === "unavailable")
    return (
      <section aria-label="Profile check" className="apply-basics">
        <p role="alert">We could not check your profile, so applying is paused.</p>
        <button type="button" onClick={basics.retry}>
          Check again
        </button>
      </section>
    );
  if (basics.missing.length === 0) return null;
  return (
    <section aria-label="Finish your profile" className="apply-basics">
      <h3>Finish your profile before applying</h3>
      <p>
        Every application asks for these. Add them once in your profile and they are used for every
        job.
      </p>
      <ul>
        {basics.missing.map((item) => (
          <li key={item.key}>
            {item.label} ({SECTION_NAME[item.section]})
          </li>
        ))}
      </ul>
      <a href="/profile" target="_blank" rel="noopener">
        Open my profile
      </a>
      <button type="button" onClick={basics.retry}>
        I added them, check again
      </button>
    </section>
  );
}
