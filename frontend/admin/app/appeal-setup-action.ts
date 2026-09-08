"use server";

import { headers } from "next/headers";
import { verifyAppealSetup, type AppealSetupResult } from "../lib/appeal-setup";
import { getAuth0Client } from "../lib/auth0";

/** The browser supplies no identity, token, file path, or scope to this action. */
export async function verifyReviewerSetup(): Promise<AppealSetupResult> {
  try {
    return await verifyAppealSetup(await headers(), {
      environment: process.env,
      now: Date.now,
      getSession: () => getAuth0Client().getSession(),
      fetch: globalThis.fetch,
    });
  } catch {
    return { status: "verification_failed" };
  }
}
