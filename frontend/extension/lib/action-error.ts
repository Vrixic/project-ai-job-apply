export function safeActionErrorMessage(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("cancel") ||
    message.includes("access_denied") ||
    message === "authorization_cancelled"
  ) {
    return "Authentication action cancelled.";
  }
  if (message === "configuration_required") return "Public Auth0 configuration is required.";
  if (message === "api_configuration_required") {
    return "Configure the API origin before using account delivery.";
  }
  if (message === "reauthentication_required" || message === "authentication_required") {
    return "Log in again to continue.";
  }
  if (message === "capture_required") {
    return "Inspect the current page again before continuing.";
  }
  if (message === "retention_policy_required") {
    return "Pending-item retention must be configured before adding a job.";
  }
  if (message === "contribution_capability_disabled") {
    return "Public contribution is currently disabled by its signed capability policy.";
  }
  if (message === "development_contribution_disabled") {
    return "This unpacked development build accepts only explicitly selected and detector-enabled provider pages for extension version 0.2.0.";
  }
  if (message === "queue_capacity_reached") {
    return "The delivery queue is full. Retry pending items or remove stopped items.";
  }
  if (message === "contribution_request_too_large") {
    return "Job details exceed the 64 KiB delivery limit. This job cannot be added. No shortened text was shared.";
  }
  if (message === "token_request_failed") {
    return action === "login"
      ? "Auth0 did not accept the sign-in token exchange. Check the exact callback URL and application grants, then try again."
      : "Auth0 did not refresh the session. Sign in again to continue.";
  }
  if (message === "invalid_token_response") {
    return "Auth0 returned an invalid session response. Sign in again to continue.";
  }
  if (message === "invalid_token_identity") {
    return "Auth0 returned an invalid account identity. Sign in again to continue.";
  }
  if (message === "identity_changed") {
    return "Auth0 returned a different account during refresh. Sign in again before adding a job.";
  }
  if (message === "required_scope_missing") {
    return "The Auth0 application grant is missing a required API permission.";
  }
  if (
    message === "provider_error" ||
    message.includes("authorization callback") ||
    message.includes("callback state")
  ) {
    return "The authentication response was rejected. Start sign in again.";
  }
  if (message === "revocation_failed") {
    return "Auth0 revocation could not be confirmed. Local extension data was cleared.";
  }
  return "The action did not complete.";
}
