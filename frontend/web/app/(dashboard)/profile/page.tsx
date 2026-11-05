import { getAuth0Client, isAuth0Configured } from "../../../lib/auth0";
import { ProfilePageClient } from "./profile-page-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = isAuth0Configured() ? await getAuth0Client().getSession() : null;
  const name = typeof session?.user.name === "string" ? session.user.name : undefined;
  const email = typeof session?.user.email === "string" ? session.user.email : undefined;

  return <ProfilePageClient authenticated name={name} email={email} />;
}
