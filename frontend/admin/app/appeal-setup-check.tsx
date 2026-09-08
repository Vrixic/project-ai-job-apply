"use client";

import { useState } from "react";
import { verifyReviewerSetup } from "./appeal-setup-action";

const messages = {
  verified:
    "Reviewer setup checked. No reviewer roles were changed and no case decision was submitted.",
  unavailable:
    "The local reviewer setup window is unavailable. Ask the setup operator to check it.",
  sign_in_required:
    "Sign out and sign in again with MFA, then verify reviewer setup within 15 minutes.",
  verification_failed:
    "Reviewer setup could not be verified. Ask the setup operator to check the dedicated identity and granted scopes.",
  already_complete:
    "A setup result already exists. Ask the setup operator to check it; it was not overwritten.",
};

export function AppealSetupCheck() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "This local check verifies your reviewer sign-in only. It does not assign permissions or load cases.",
  );
  async function verify() {
    setBusy(true);
    setMessage("Checking reviewer setup…");
    try {
      const result = await verifyReviewerSetup();
      setMessage(messages[result.status] ?? messages.verification_failed);
    } catch {
      setMessage(messages.verification_failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="notice" aria-label="Local reviewer setup">
      <button
        type="button"
        onClick={verify}
        disabled={busy}
        aria-describedby="reviewer-setup-status"
      >
        {busy ? "Checking reviewer setup…" : "Verify reviewer setup"}
      </button>
      <p id="reviewer-setup-status" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
