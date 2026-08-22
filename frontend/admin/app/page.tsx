import { getAuth0Client, isAuth0Configured } from "../lib/auth0";
import { ModerationConsole } from "./moderation-console";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const configured = isAuth0Configured();
  const session = configured ? await getAuth0Client().getSession() : null;
  return (
    <main>
      <p className="eyebrow">Restricted internal console</p>
      <h1>Job and source moderation</h1>
      <p className="lede">
        Candidate reports are evidence only. Every block or source pause below requires an explicit,
        version-fenced human decision and is recorded in the append-only audit ledger.
      </p>
      {!configured ? (
        <div className="notice" role="status">
          Configure the dedicated admin Auth0 client before using this console.
        </div>
      ) : !session ? (
        <div className="notice">
          {parameters.auth_error === "authentication_failed" ? (
            <p role="alert">
              Authentication failed. Try again or contact the identity administrator.
            </p>
          ) : null}
          <a className="button-link" href="/auth/login">
            Sign in as moderator
          </a>
        </div>
      ) : (
        <>
          <nav aria-label="Admin session">
            <span>Privileged session active</span>
            <a href="/auth/logout">Sign out</a>
          </nav>
          <ModerationConsole />
        </>
      )}
    </main>
  );
}
