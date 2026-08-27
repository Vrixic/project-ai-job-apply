import { getAuth0Client } from "./auth0";
import type { ModerationBffDependencies } from "./moderation-bff";

export function moderationDependencies(): ModerationBffDependencies {
  return {
    getSession: () => getAuth0Client().getSession(),
    getAccessToken: () => getAuth0Client().getAccessToken(),
    fetch,
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
  };
}
