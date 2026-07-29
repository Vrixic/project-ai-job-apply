function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function validateAuthorizationCallback(options: {
  callbackUrl: string;
  expectedRedirectUri: string;
  expectedState: string;
}): string {
  const callback = new URL(options.callbackUrl);
  const redirect = new URL(options.expectedRedirectUri);
  if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) {
    throw new Error("The authorization callback did not use the exact extension redirect");
  }
  if (callback.searchParams.get("state") !== options.expectedState) {
    throw new Error("The authorization callback state did not match");
  }
  const providerError = callback.searchParams.get("error");
  if (providerError) {
    throw new Error(
      providerError === "access_denied" ? "authorization_cancelled" : "provider_error",
    );
  }
  const code = callback.searchParams.get("code");
  if (!code) {
    throw new Error("The authorization callback did not contain a code");
  }
  return code;
}
