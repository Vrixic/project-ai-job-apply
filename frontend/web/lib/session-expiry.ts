/**
 * A candidate whose session cookie is still there but whose access token can no longer be had (it
 * expired and could not be refreshed) is neither signed in nor signed out: the header still shows
 * their name while every request fails. The BFF says so with the problem code `session_expired`
 * (and only for this), and the signed-in pages answer by ending the session through the existing
 * sign-out, which also asks for the cleanup of temporary application documents.
 */
export const SESSION_EXPIRED_SIGN_OUT_PATH = "/auth/logout?reason=session_expired";

interface GuardedWindow {
  fetch: typeof fetch;
  location: { origin: string; href: string };
}

function requestUrl(input: RequestInfo | URL, base: string): URL | undefined {
  try {
    const value = input instanceof Request ? input.url : String(input);
    return new URL(value, base);
  } catch {
    return undefined;
  }
}

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    if (!(response.headers.get("content-type") ?? "").includes("json")) return undefined;
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Watches the page's own requests to its BFF (`/api/...`). The first `session_expired` answer
 * starts the sign-out; later ones, from the other requests of the same burst, do nothing more.
 * Every other response, including a plain "authentication required" (which the account-deletion
 * flow uses to ask for a recent sign-in), is left to the page. Returns the function that removes it.
 */
export function installSessionExpiryGuard(target: GuardedWindow, signOut: () => void): () => void {
  const original = target.fetch;
  let ended = false;
  const guarded: typeof fetch = async (input, init) => {
    const response = await original.call(target, input, init);
    if (!ended && response.status === 401) {
      const url = requestUrl(input, target.location.href);
      if (url && url.origin === target.location.origin && url.pathname.startsWith("/api/")) {
        void problemCode(response.clone()).then((code) => {
          if (code === "session_expired" && !ended) {
            ended = true;
            signOut();
          }
        });
      }
    }
    return response;
  };
  target.fetch = guarded;
  return () => {
    if (target.fetch === guarded) target.fetch = original;
  };
}
