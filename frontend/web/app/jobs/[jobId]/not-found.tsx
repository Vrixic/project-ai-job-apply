export default function PublicJobNotFound() {
  return (
    <main className="public-job-page">
      <section className="public-job-card" aria-labelledby="missing-job-heading">
        <h1 id="missing-job-heading">Job not found</h1>
        <p>This job is unavailable, inactive, or has expired.</p>
      </section>
    </main>
  );
}
