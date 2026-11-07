/**
 * Records why a signed-in session could not get an access token, so a stuck session can be
 * explained instead of guessed at. Only the SDK's own short error code is written (for example
 * `missing_refresh_token` or `failed_to_refresh_token`): never the message, a token or a user.
 */
export function logAccessTokenUnavailable(error: unknown): void {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const safe = typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : "unknown";
  console.warn(JSON.stringify({ event: "auth_access_token_unavailable", code: safe }));
}
