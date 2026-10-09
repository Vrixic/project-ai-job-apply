"use client";

import type { Application } from "@ai-job-apply/api-contracts";
import { useEffect, useState } from "react";

export function ExtensionApplicationHandoff({ application }: { application: Application }) {
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setLink(
      `${window.location.origin}/jobs?application=${application.id}&job=${application.canonicalJobId}`,
    );
    setNotice(undefined);
  }, [application.id, application.canonicalJobId]);
  if (
    process.env.NEXT_PUBLIC_APPLICATION_EXTENSION_HANDOFF !== "enabled" ||
    application.status !== "approved" ||
    application.currentAction !== "ready_to_submit"
  )
    return null;
  return (
    <section aria-label="Continue with the extension">
      <h3>Continue with the extension</h3>
      <p>
        Copy this review link, open the employer page, then paste it into ApplyDash’s “Complete an
        approved application” panel. Review each answer before copying it. You submit the employer
        form yourself.
      </p>
      <label>
        Application review link
        <input type="url" readOnly value={link} onFocus={(event) => event.target.select()} />
      </label>
      <button
        type="button"
        disabled={!link}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setNotice("Application review link copied.");
          } catch {
            setNotice("Select the review link and copy it manually.");
          }
        }}
      >
        Copy application review link
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
