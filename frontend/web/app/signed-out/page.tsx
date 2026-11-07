export const dynamic = "force-dynamic";

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<{ cleanup?: string; reason?: string }>;
}) {
  const query = await searchParams;
  const requested = query.cleanup === "requested";
  const expired = query.reason === "session_expired";
  return (
    <main className="container">
      <MaterialSignOutSignal />
      <h1>Sign-out</h1>
      {expired ? (
        <p role="status">
          Your session expired, so you were signed out. <a href="/auth/login">Sign in</a> to
          continue.
        </p>
      ) : null}
      <p>
        {requested
          ? "Cleanup of temporary application documents was requested. Cleanup may still be in progress."
          : "We could not confirm cleanup of temporary application documents. Their normal expiry still applies."}
      </p>
      <p>This does not delete files you downloaded or copies held by another service.</p>
      <a href="/">Return home</a>
    </main>
  );
}

import { MaterialSignOutSignal } from "./material-sign-out-signal";
