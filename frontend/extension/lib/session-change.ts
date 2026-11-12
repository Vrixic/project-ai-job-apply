/** The account fence a stored session carries, when it can be read. */
function fenceOf(session: unknown): string | undefined {
  return session && typeof session === "object" && "identityFence" in session
    ? typeof session.identityFence === "string"
      ? session.identityFence
      : undefined
    : undefined;
}

/**
 * Whether a change to the stored session only renewed the tokens of the account that is already
 * signed in. A token refresh rewrites the session this way, and must not end what the candidate has
 * prepared. Signing in, signing out, signing in as someone else, or a session that cannot be read
 * to compare, is not a renewal.
 */
export function isTokenRenewal(change: { oldValue?: unknown; newValue?: unknown } | undefined) {
  const before = fenceOf(change?.oldValue);
  return before !== undefined && before === fenceOf(change?.newValue);
}
