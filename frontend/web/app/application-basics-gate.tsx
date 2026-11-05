import React, { useEffect, useRef } from "react";
import type { ApplicationBasics } from "./use-application-basics";

/** The Profile address of the first tab that still has something to fill in. */
export function profileHrefFor(missing: ApplicationBasics["missing"]): string {
  const first = missing[0];
  return first ? `/profile?tab=${first.section}&from=apply` : "/profile";
}

/**
 * A popup, shown in place of any inline block, that asks the candidate to finish their screening
 * before applying. It names what is missing and takes them to the Profile tab that holds it; nothing
 * is filled in for them.
 */
export function ApplicationBasicsDialog({
  basics,
  open,
  onClose,
}: {
  basics: ApplicationBasics;
  open: boolean;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const showing = open && basics.status !== "loading";

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (showing && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (!showing && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [showing]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="apply-screening-heading"
      className="apply-basics"
      onClose={onClose}
    >
      {basics.status === "unavailable" ? (
        <>
          <h3 id="apply-screening-heading">We could not check your profile</h3>
          <p role="alert">Applying is paused until we can.</p>
          <button type="button" onClick={basics.retry}>
            Check again
          </button>
        </>
      ) : (
        <>
          <h3 id="apply-screening-heading">Complete your screening to apply</h3>
          <p>
            Every application asks for these. Add them once in your profile and they are used for
            every job.
          </p>
          <ul>
            {basics.missing.map((item) => (
              <li key={item.key}>{item.label}</li>
            ))}
          </ul>
          <a href={profileHrefFor(basics.missing)} target="_blank" rel="noopener">
            Go to my profile
          </a>
          <button type="button" onClick={basics.retry}>
            I completed it, check again
          </button>
        </>
      )}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
