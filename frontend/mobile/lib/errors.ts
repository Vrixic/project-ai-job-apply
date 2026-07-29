interface AuthLikeError {
  code?: unknown;
  message?: unknown;
  type?: unknown;
}

export function sanitizedAuthMessage(error: unknown, action: "login" | "logout" | "refresh") {
  const candidate = error as AuthLikeError;
  const code = [candidate.code, candidate.type, candidate.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (code.includes("cancel")) {
    return action === "login" ? "Login cancelled." : "Authentication action cancelled.";
  }
  if (code.includes("network") || code.includes("browser_not_available")) {
    return "Authentication service is temporarily unavailable.";
  }
  return action === "refresh"
    ? "The local session could not be renewed."
    : `Auth0 ${action} did not complete.`;
}
