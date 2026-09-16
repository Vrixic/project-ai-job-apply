import { describe, expect, it } from "vitest";
import { safeActionErrorMessage } from "../lib/action-error";

describe("extension privacy-safe action errors", () => {
  it.each([
    ["authorization_cancelled", "login", "Authentication action cancelled."],
    ["access_denied", "login", "Authentication action cancelled."],
    ["configuration_required", "login", "Public Auth0 configuration is required."],
    [
      "contribution_request_too_large",
      "enqueue",
      "Job details exceed the 64 KiB delivery limit. This job cannot be added. No shortened text was shared.",
    ],
    [
      "development_contribution_disabled",
      "enqueue",
      "This unpacked development build accepts only explicitly selected and detector-enabled provider pages for extension version 0.2.0.",
    ],
    [
      "token_request_failed",
      "login",
      "Auth0 did not accept the sign-in token exchange. Check the exact callback URL and application grants, then try again.",
    ],
    [
      "token_request_failed",
      "refresh",
      "Auth0 did not refresh the session. Sign in again to continue.",
    ],
    [
      "required_scope_missing",
      "login",
      "The Auth0 application grant is missing a required API permission.",
    ],
    [
      "invalid_token_identity",
      "login",
      "Auth0 returned an invalid account identity. Sign in again to continue.",
    ],
    [
      "identity_changed",
      "refresh",
      "Auth0 returned a different account during refresh. Sign in again before adding a job.",
    ],
    [
      "The authorization callback state did not match",
      "login",
      "The authentication response was rejected. Start sign in again.",
    ],
    [
      "revocation_failed",
      "logout",
      "Auth0 revocation could not be confirmed. Local extension data was cleared.",
    ],
  ])("projects %s during %s without raw provider detail", (error, action, expected) => {
    expect(safeActionErrorMessage(new Error(error), action)).toBe(expected);
  });

  it("keeps unknown errors non-disclosing", () => {
    const message = safeActionErrorMessage(
      new Error("request included a token, provider body, and private identifier"),
      "login",
    );
    expect(message).toBe("The action did not complete.");
    expect(message).not.toContain("token");
    expect(message).not.toContain("provider body");
    expect(message).not.toContain("private identifier");
  });
});
