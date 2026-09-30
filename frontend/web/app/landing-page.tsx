import { resolveProductBrand } from "@ai-job-apply/config/brand";

const productBrand = resolveProductBrand({
  name: process.env.NEXT_PUBLIC_PRODUCT_BRAND_NAME,
  candidateDomain: process.env.NEXT_PUBLIC_PRODUCT_BRAND_DOMAIN,
});

const CAPABILITIES = [
  {
    title: "Tailored applications",
    body: "Every application is drafted against the specific role, not a generic template blasted to every listing.",
  },
  {
    title: "Conservative matching",
    body: "We only surface roles when the fit holds up - no inflated match scores to keep you scrolling.",
  },
  {
    title: "Works where you already apply",
    body: "Connects to the ATS platforms employers actually use, including Greenhouse, Lever, and Ashby.",
  },
  {
    title: "You stay in control",
    body: "Review and confirm every submission yourself. Your data, your export, your call.",
  },
] as const;

const STEPS = [
  {
    number: "1",
    title: "Tell us what fits you",
    body: "Share your resume and preferences once.",
  },
  {
    number: "2",
    title: "We tailor the application",
    body: "Each draft is built for the specific job posting.",
  },
  {
    number: "3",
    title: "You review and submit",
    body: "Nothing goes out without your confirmation.",
  },
] as const;

export function LandingPage({ authenticationFailed }: { authenticationFailed: boolean }) {
  return (
    <main className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <a className="landing-logo" href="#landing-top">
            {productBrand.name}
          </a>
          <nav className="landing-nav" aria-label="Primary">
            <a href="#capabilities">What you get</a>
            <a href="#how-it-works">How it works</a>
          </nav>
          <div className="landing-header-actions">
            <a className="landing-link-button" href="/auth/login">
              Sign in
            </a>
            <a className="landing-cta-button" href="/auth/login?screen_hint=signup">
              Join now
            </a>
          </div>
        </div>
      </header>

      {authenticationFailed && (
        <p className="landing-auth-error" role="alert">
          We couldn&apos;t sign you in. Please try again.
        </p>
      )}

      <section id="landing-top" className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">For job seekers</p>
          <h1>No more solo job hunting. Do it with AI.</h1>
          <p className="lede">
            {productBrand.name} drafts tailored, quality-gated applications for the roles that
            actually fit you - and stops the moment you&apos;ve confirmed a submission.
          </p>
          <a className="landing-cta-button landing-cta-large" href="/auth/login?screen_hint=signup">
            Try it free
          </a>
        </div>
        <div className="landing-hero-visual" aria-hidden="true">
          <div className="landing-mock-window">
            <div className="landing-mock-titlebar">
              <span />
              <span />
              <span />
            </div>
            <div className="landing-mock-line landing-mock-line-title" />
            <div className="landing-mock-line" />
            <div className="landing-mock-line landing-mock-line-short" />
            <div className="landing-mock-chip" />
          </div>
        </div>
      </section>

      <section id="capabilities" className="landing-capabilities">
        <h2>Built to keep you moving, not guessing</h2>
        <div className="landing-capability-grid">
          {CAPABILITIES.map((capability) => (
            <article key={capability.title}>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="landing-how">
        <h2>One home for every application</h2>
        <ol className="landing-steps">
          {STEPS.map((step) => (
            <li key={step.number}>
              <span className="landing-step-number">{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-final-cta">
        <h2>Ready to apply smarter?</h2>
        <a className="landing-cta-button landing-cta-large" href="/auth/login?screen_hint=signup">
          Create your free account
        </a>
      </section>

      <footer className="landing-footer">
        <span>{productBrand.name}</span>
        <a href="/auth/login">Sign in</a>
      </footer>
    </main>
  );
}
