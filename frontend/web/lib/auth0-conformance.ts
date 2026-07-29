interface Auth0RefreshSession {
  getAccessToken(options: { refresh: true }): Promise<unknown>;
  getSession(): Promise<unknown | null>;
}

interface WebRefreshConformanceDependencies {
  appBaseUrl: string;
  auth0: Auth0RefreshSession;
  enabled: boolean;
}

function result(status: number, state: string, message: string): Response {
  return Response.json(
    { state, message },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

export function isLocalAuth0ConformanceEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.NODE_ENV === "development";
}

export async function forceWebSessionRenewal(
  request: Request,
  dependencies: WebRefreshConformanceDependencies,
): Promise<Response> {
  if (!dependencies.enabled) {
    return result(404, "unavailable", "Not found");
  }

  const expectedOrigin = new URL(dependencies.appBaseUrl).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return result(403, "origin_rejected", "The request origin was rejected");
  }

  const session = await dependencies.auth0.getSession();
  if (!session) {
    return result(401, "reauthentication_required", "Sign in again to continue");
  }

  try {
    await dependencies.auth0.getAccessToken({ refresh: true });
    return result(200, "renewed", "The server-held session renewed successfully");
  } catch {
    return result(
      401,
      "reauthentication_required",
      "Session renewal failed; sign in again to continue",
    );
  }
}
