export const dynamic = "force-dynamic";

export default async function SignedOutPage({
  searchParams,
}: {
  searchParams: Promise<{ cleanup?: string }>;
}) {
  const requested = (await searchParams).cleanup === "requested";
  return (
    <main className="container">
      <h1>Sign-out</h1>
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
