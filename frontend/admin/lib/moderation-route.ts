import { getAuth0Client } from "./auth0";
import { type ModerationBffDependencies } from "./moderation-bff";

export function moderationDependencies(): ModerationBffDependencies {
  const auth0 = getAuth0Client();
  return {
    getSession: () => auth0.getSession(),
    getAccessToken: () => auth0.getAccessToken(),
    fetch,
    baseUrl: process.env.PLATFORM_API_BASE_URL ?? "http://localhost:4000",
  };
}
