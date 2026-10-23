import { NextRequest, NextResponse } from "next/server";
import { getAuth0Client, isAuth0Configured } from "./lib/auth0";

export async function proxy(request: Request) {
  if (!isAuth0Configured()) {
    if (new URL(request.url).pathname.startsWith("/auth/")) {
      return NextResponse.json(
        {
          type: "urn:ai-job-apply:problem:identity_unavailable",
          title: "Identity is not configured",
          status: 503,
          code: "identity_unavailable",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.next();
  }
  const client = getAuth0Client();
  if (
    process.env.NATIVE_MATERIAL_LOGOUT_ENABLED === "true" &&
    new URL(request.url).pathname === "/auth/logout"
  ) {
    const { nativeMaterialLogout } = await import("./lib/native-material-logout");
    return nativeMaterialLogout(new NextRequest(request), client, process.env);
  }
  return client.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|push-sw.js).*)"],
};
