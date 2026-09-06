import { NextResponse } from "next/server";
import {
  AdminMfaRequiredError,
  getAuth0Client,
  isAuth0Configured,
  validateAppBaseUrl,
} from "./lib/auth0";

export async function proxy(request: Request) {
  if (!isAuth0Configured()) {
    if (new URL(request.url).pathname.startsWith("/auth/")) {
      return NextResponse.json(
        {
          type: "urn:ai-job-apply:problem:identity_unavailable",
          title: "Admin identity is not configured",
          status: 503,
          code: "identity_unavailable",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.next();
  }
  try {
    // The SDK runs beforeSessionSaved after onCallback. Await here so a rejected
    // MFA check cannot escape as a generic server error or persist a session.
    return await getAuth0Client().middleware(request);
  } catch (error) {
    if (new URL(request.url).pathname === "/auth/callback") {
      const target = new URL("/", validateAppBaseUrl(process.env.APP_BASE_URL as string));
      target.searchParams.set(
        "auth_error",
        error instanceof AdminMfaRequiredError ? "mfa_required" : "authentication_failed",
      );
      return NextResponse.redirect(target, { headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
