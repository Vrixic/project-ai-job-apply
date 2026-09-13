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
          Understand delivery states, retry safely, and manage an accepted contribution without
          sharing job details with a support channel.
        </p>
      </header>

      <aside className="extension-support-notice" aria-labelledby="development-access-heading">
        <h2 id="development-access-heading">Development access only</h2>
        <p>
          The extension is not available for public installation or browser store distribution. This
          page documents the current controlled development build.
        </p>
      </aside>

      <section className="extension-support-section" aria-labelledby="delivery-heading">
        <h2 id="delivery-heading">Read the delivery queue</h2>
        <div className="extension-support-definitions">
          <div>
            <h3>Pending</h3>
            <p>
              The selected fields remain on this device. Sign in if requested, then choose Retry
              now. A manual retry skips only the scheduled wait.
            </p>
          </div>
          <div>
            <h3>Stopped</h3>
            <p>
              Delivery reached a terminal state. Choose Retry stopped only after the stated issue is
              resolved, or remove the item from this device.
            </p>
          </div>
          <div>
            <h3>Held for another account</h3>
            <p>
              The item cannot move to a different identity. Sign back into the original account or
              remove it and create a new contribution while using the current account.
            </p>
          </div>
        </div>
      </section>

      <section className="extension-support-section" aria-labelledby="rights-heading">
        <h2 id="rights-heading">Manage an accepted contribution</h2>
        <ol className="extension-support-steps">
          <li>Open Your shared jobs in the extension.</li>
          <li>
            Choose Refresh processing to load the current processing state, then Refresh Trust to
            load the current Trust state.
          </li>
          <li>
            To request withdrawal, choose Withdraw when available and confirm removal of this
            contribution from Trust eligibility.
          </li>
          <li>
            To request an appeal, choose Appeal when available, enter supporting evidence, then
            choose Confirm &amp; submit appeal and confirm the submission prompt.
          </li>
        </ol>
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
          documents when troubleshooting. The extension is designed to send only the public fields
          you selected after an explicit add command.
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
