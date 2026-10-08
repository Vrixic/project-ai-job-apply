import { randomUUID } from "node:crypto";
import { compileComponentValidator } from "@ai-job-apply/api-contracts";
import type { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextRequest, NextResponse } from "next/server";
import { validateAppBaseUrl } from "./auth0";

type LogoutClient = Pick<Auth0Client, "getSession" | "middleware">;
type Environment = Readonly<Record<string, string | undefined>>;
const validReceipt = compileComponentValidator("NativeMaterialWithdrawal");
const jsonType = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;

function requestId(): string {
  const timestamp = Date.now().toString(16).padStart(12, "0");
  const random = randomUUID();
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(15, 18)}${random.slice(18)}`;
}

function unavailable(status: 403 | 503): NextResponse {
  return NextResponse.json(
    {
      message:
        status === 403 ? "Open Settings to log out." : "Sign-out is unavailable. Please retry.",
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** Requests durable owner-wide withdrawal before ending the server-held session.
 * Acceptance means queued cleanup, never proof that all remote copies were deleted.
 */
export async function nativeMaterialLogout(
  request: NextRequest,
  client: LogoutClient,
  environment: Environment,
  dependencies: { fetch?: typeof fetch; timeoutMilliseconds?: number } = {},
): Promise<NextResponse> {
  let appOrigin: string;
  try {
    appOrigin = validateAppBaseUrl(environment.APP_BASE_URL ?? "");
  } catch {
    return unavailable(503);
  }
  // The existing same-origin Settings link and direct user navigation are allowed.
  // A different site must not be able to withdraw this owner's active material.
  const site = request.headers.get("sec-fetch-site");
  const referer = request.headers.get("referer");
  const origin = request.headers.get("origin");
  try {
    if (
      request.method !== "GET" ||
      request.nextUrl.origin !== appOrigin ||
      (site !== "same-origin" && site !== "none") ||
      (referer !== null && new URL(referer).origin !== appOrigin) ||
      (origin !== null && origin !== appOrigin)
    )
      return unavailable(403);
  } catch {
    return unavailable(403);
  }

  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const interrupt = () => {
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      interrupt();
      reject(new Error("Logout cleanup deadline"));
    }, dependencies.timeoutMilliseconds ?? 5_000);
  });
  const withdraw = async (): Promise<void> => {
    if (environment.AUTH0_APPLICATIONS_SCOPES !== "enabled")
      throw new Error("Cleanup authorization unavailable");
    const session = await client.getSession(request);
    const token = session?.tokenSet.accessToken;
    if (typeof token !== "string" || token.length === 0)
      throw new Error("Cleanup authorization unavailable");
    const base = new URL(environment.PLATFORM_API_BASE_URL ?? "");
    if (
      (base.protocol !== "https:" &&
        !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error("Cleanup endpoint unavailable");
    if (controller.signal.aborted) throw new Error("Cleanup interrupted");
    // Use the existing access token: refreshing during logout could outlive the bounded
    // cleanup attempt and rotate a token after SDK revocation. Expiry stays unconfirmed.
    const id = requestId();
    const response = await (dependencies.fetch ?? fetch)(
      new URL(`/v1/material-withdrawals/${id}`, base),
      {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Cleanup interrupted");
    }
    const length = response.headers.get("content-length");
    if (
      response.status !== 202 ||
      !jsonType.test(response.headers.get("content-type") ?? "") ||
      (length !== null && (!/^\d+$/u.test(length) || Number(length) > 4096)) ||
      !response.body
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("Cleanup receipt unavailable");
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (!controller.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) throw new Error("Cleanup receipt exceeds limit");
      chunks.push(chunk.value);
    }
    if (controller.signal.aborted) throw new Error("Cleanup interrupted");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validReceipt(value) || (value as { requestId: string }).requestId !== id) {
      throw new Error("Cleanup receipt mismatch");
    }
  };
  let cleanup = "unconfirmed";
  try {
    await Promise.race([withdraw(), deadline]);
    cleanup = "requested";
  } catch {
    // Logout remains available during provider/API failure. The fixed return page explains
    // uncertainty; no upstream body, token, receipt, user or task identifier is sent to the UI.
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    interrupt();
  }
  const target = new URL("/signed-out", appOrigin);
  target.searchParams.set("cleanup", cleanup);
  const logout = new URL("/auth/logout", appOrigin);
  logout.searchParams.set("returnTo", target.href);
  try {
    const response = await client.middleware(new NextRequest(logout, { headers: request.headers }));
    response.headers.set("cache-control", "no-store");
    response.headers.set("clear-site-data", '"cache", "storage"');
    return response;
  } catch {
    return unavailable(503);
  }
}
