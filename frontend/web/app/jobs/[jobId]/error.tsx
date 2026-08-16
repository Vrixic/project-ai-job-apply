"use client";

export default function PublicJobError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="public-job-page">
      <section className="public-job-card" aria-labelledby="job-error-heading">
        <h1 id="job-error-heading">Job detail is temporarily unavailable</h1>
        <p>No job detail was shown because the current record could not be verified safely.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
