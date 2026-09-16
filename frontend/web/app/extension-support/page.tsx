import { resolveProductBrand } from "@ai-job-apply/config/brand";
import type { Metadata } from "next";

const productBrand = resolveProductBrand({
  name: process.env.NEXT_PUBLIC_PRODUCT_BRAND_NAME,
  candidateDomain: process.env.NEXT_PUBLIC_PRODUCT_BRAND_DOMAIN,
});

export const metadata: Metadata = {
  title: `Extension help | ${productBrand.name}`,
  description: `Help for the ${productBrand.name} browser extension and its public job contribution controls.`,
};

export default function ExtensionSupportPage() {
  return (
    <main className="extension-support-page">
      <header className="extension-support-header">
        <a className="extension-support-brand" href="/">
          {productBrand.name}
        </a>
        <p className="eyebrow">Browser extension help</p>
        <h1>Control every job contribution.</h1>
        <p className="lede">
          Inspect a public job, review its details, and understand the result of your add action
          without sharing private information.
        </p>
      </header>

      <aside className="extension-support-notice" aria-labelledby="development-access-heading">
        <h2 id="development-access-heading">Development access only</h2>
        <p>
          The extension is not available for public installation or browser store distribution. This
          page describes the intended end-user contribution flow, not development diagnostics.
        </p>
      </aside>

      <section className="extension-support-section" aria-labelledby="delivery-heading">
        <h2 id="delivery-heading">Add a public job</h2>
        <div className="extension-support-definitions">
          <div>
            <h3>Inspect and review</h3>
            <p>
              Open a supported public job page and choose Inspect current tab. Review the detected
              details. Adding the job sends all available public job fields shown in the preview.
            </p>
          </div>
          <div>
            <h3>Add the job</h3>
            <p>
              Sign in if prompted, then choose Add job to shared database once. Read the result
              shown in the extension. If delivery is pending or unconfirmed, do not repeatedly add
              the same job or clear browser storage to try to force delivery.
            </p>
          </div>
          <div>
            <h3>Acknowledgement is not publication</h3>
            <p>
              Receiving a contribution does not immediately publish it. Independent provider
              verification and any required review must complete before it enters the catalog.
            </p>
          </div>
        </div>
      </section>

      <section className="extension-support-section" aria-labelledby="rights-heading">
        <h2 id="rights-heading">Manage an accepted contribution</h2>
        <p>
          Public withdrawal, appeal and takedown instructions will be provided with the verified
          support channel before public release. Development diagnostic controls are not part of the
          end-user extension. No public support channel is currently active.
        </p>
        <p>
          Uninstalling the extension removes local software, but it does not withdraw an already
          accepted server contribution. Candidate export and account deletion remain available in
          the signed-in web application.
        </p>
        <a className="button-link extension-support-action" href="/">
          Open the web application
        </a>
      </section>

      <section className="extension-support-section" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Protect your information</h2>
        <p>
          Do not send access tokens, passwords, browser storage, raw page HTML, or private candidate
          documents when troubleshooting. The extension sends the available public job fields shown
          in the preview only after an explicit add command.
        </p>
      </section>

      <section className="extension-support-section" aria-labelledby="channel-heading">
        <h2 id="channel-heading">Public support channel status</h2>
        <p>
          No monitored public support channel is active for this development candidate. A verified
          channel and response process must be added before browser store distribution. Do not use
          personal contact details as a substitute.
        </p>
      </section>
    </main>
  );
}
