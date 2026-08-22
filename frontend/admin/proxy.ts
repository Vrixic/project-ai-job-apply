import { NextResponse } from "next/server";
import { getAuth0Client, isAuth0Configured } from "./lib/auth0";

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
  return getAuth0Client().middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
