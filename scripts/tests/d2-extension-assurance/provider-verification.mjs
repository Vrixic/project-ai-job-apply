import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { build, stop } from "esbuild";
import { chromium } from "playwright-core";
import { verifyContributionIntake } from "./contribution-intake.mjs";

// Generated page/API pairs only. No live provider, Auth0, API, database, or user profile is used.
// Bundle current source in memory: stale dist output cannot make this composed check pass.
const root = resolve(import.meta.dirname, "../../..");
const timestamp = "2026-09-08T12:00:00.000Z";
const postingId = "12345678-abcd-4abc-8abc-1234567890ab";
const contributionId = "018f0000-0000-7000-8000-000000000001";
const normalizationId = "018f0000-0000-7000-8000-000000000002";
const verificationId = "018f0000-0000-7000-8000-000000000003";
const optionalFields = ["company", "location", "workMode", "description", "externalJobId"];

function testingBrowser() {
  const explicit = process.env.D2_EXTENSION_BROWSER || process.env.D2_EXTENSION_CHROME_FOR_TESTING;
  if (explicit) {
    assert.ok(existsSync(explicit), "The explicitly selected testing browser is unavailable");
    return explicit;
  }
  const base =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : undefined);
  const installed =
    base && existsSync(base)
      ? readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
          .sort((left, right) => right.name.localeCompare(left.name, "en", { numeric: true }))
          .flatMap((entry) => [
            join(base, entry.name, "chrome-win64", "chrome.exe"),
            join(base, entry.name, "chrome-linux", "chrome"),
            join(base, entry.name, "chrome-linux64", "chrome"),
          ])
      : [];
  const candidates = [
    ...installed,
    process.env["ProgramFiles(x86)"]
      ? join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
      : undefined,
    chromium.executablePath(),
  ];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  assert.ok(executable, "Install a testing browser separately; this check never downloads one");
  return executable;
}

function pair(kind, { variant = "blocks", mode = "remote", structured = true } = {}) {
  const provider = kind.startsWith("lever") ? "lever" : "ashby";
  const eu = kind === "lever-eu";
  const host =
    provider === "ashby" ? "jobs.ashbyhq.com" : eu ? "jobs.eu.lever.co" : "jobs.lever.co";
  const site = "synthetic-paired";
  const sourceUrl = `https://${host}/${site}/${postingId}`;
  const sourceId = `${provider}-synthetic-paired`;
  const firstPlain =
    variant === "long"
      ? "Build reliable systems in 12 regions. ".repeat(450).trim()
      : variant === "repeated-heading"
        ? "About Example\nAbout Example Build reliable systems."
        : "About Example\nBuild reliable systems.";
  const firstHtml =
    variant === "long"
      ? `<p>${firstPlain}</p>`
      : variant === "repeated-heading"
        ? "<h2>About Example</h2><p>About Example Build reliable systems.</p>"
        : "<h2>About Example</h2><p>Build <strong>reliable</strong> systems.</p>";
  const listHtml = "<ul><li>Support 12 regions.</li><li>Measure results.</li></ul>";
  const salaryPlain = "Salary $120,000—$150,000 USD.";
  const closingPlain = "Equal opportunity for all.";
  const salaryHtml = `<p>${salaryPlain}</p>`;
  const closingHtml = `<p>${closingPlain}</p>`;
  const descriptionHtml = `${firstHtml}<h3>Requirements</h3>${listHtml}${salaryHtml}${closingHtml}`;
  const fullDescription = [
    firstPlain,
    "Requirements\nSupport 12 regions.\nMeasure results.",
    salaryPlain,
    closingPlain,
  ].join("\n\n");
  const primaryAddress = {
    addressLocality: "New York",
    addressRegion: "NY",
    addressCountry: "USA",
  };
  const secondaryAddress = {
    addressLocality: "London",
    addressRegion: "England",
    addressCountry: "GBR",
  };
  const location = "New York, NY, USA";
  const workplaceType =
    provider === "ashby"
      ? { remote: "Remote", hybrid: "Hybrid", on_site: "OnSite" }[mode]
      : { remote: "remote", hybrid: "hybrid", on_site: "on-site" }[mode];
  const payload =
    provider === "lever"
      ? {
          id: postingId,
          text: "Platform Engineer",
          hostedUrl: sourceUrl,
          categories: { location, allLocations: [location, "London, England, GBR"] },
          workplaceType,
          descriptionPlain: firstPlain,
          description: firstHtml,
          // These are already included in descriptionPlain, not additional catalog text.
          openingPlain: firstPlain,
          bodyPlain: firstPlain,
          lists: [{ text: "Requirements", content: listHtml }],
          salaryDescriptionPlain: salaryPlain,
          salaryDescription: salaryHtml,
          additionalPlain: closingPlain,
          additional: closingHtml,
        }
      : {
          apiVersion: "1",
          jobs: [
            {
              title: "Platform Engineer",
              // Deliberately differs from the grounded postal display the inspector selects.
              location: "New York office",
              secondaryLocations: [{ location: "London office", address: secondaryAddress }],
              address: { postalAddress: primaryAddress },
              isListed: true,
              workplaceType,
              publishedAt: "2026-09-07T12:00:00.000Z",
              descriptionPlain: fullDescription,
              descriptionHtml,
              employmentType: "FullTime",
              jobUrl: sourceUrl,
              applyUrl: `${sourceUrl}/application`,
            },
          ],
        };
  const structuredPosting = {
    "@type": "JobPosting",
    title: "Platform Engineer",
    description: descriptionHtml,
    hiringOrganization: { name: "Example" },
    identifier: { "@type": "PropertyValue", value: "REQ-42" },
    jobLocationType: mode === "remote" ? "TELECOMMUTE" : mode,
    jobLocation: [
      { "@type": "Place", address: primaryAddress },
      { "@type": "Place", address: secondaryAddress },
    ],
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="canonical" href="https://wrong.example/ignored">${
    structured
      ? `<script type="application/ld+json">${JSON.stringify({ "@graph": [structuredPosting] }).replaceAll("<", "\\u003c")}</script>`
      : ""
  }</head><body><h1>Platform Engineer</h1><div data-company-name>Example</div><div data-job-location>${location}</div><div data-job-work-mode>${mode}</div><div data-requisition-id>REQ-42</div><div data-job-description>${descriptionHtml}</div><form><input value="SYNTHETIC_PRIVATE_FORM_VALUE"></form></body></html>`;
  return {
    provider,
    kind,
    eu,
    sourceId,
    site,
    sourceUrl,
    html,
    payload,
    descriptionHtml,
    fullDescription,
    structured,
    apiUrl:
      provider === "lever"
        ? `https://${eu ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${site}/${postingId}`
        : `https://api.ashbyhq.com/posting-api/job-board/${site}?includeCompensation=false`,
  };
}

const stats = {
  profile: "d2_generated_page_provider_verification_v1",
  providerVariants: 3,
  pagesInspected: 0,
  payloadsPrepared: 0,
  verified: 0,
  rejected: 0,
  syntheticApiRequests: 0,
  externalNetworkRequests: 0,
};
let browser;
let context;
const originalFetch = globalThis.fetch;
try {
  stats.intake = await verifyContributionIntake();
  const browserBundle = await build({
    stdin: {
      contents: `export { captureCurrentPublicJobPage } from "./frontend/extension/lib/page-inspection.ts";
export { detectPublicJob } from "./frontend/extension/lib/detectors.ts";`,
      resolveDir: root,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "D2GeneratedCapture",
    write: false,
    logLevel: "silent",
  });
  const nodeBundle = await build({
    stdin: {
      contents: `export { prepareContribution } from "./frontend/extension/lib/job-intent-api.ts";
export { createPendingIntent } from "./frontend/extension/lib/pending-queue.ts";
export { normalizeContributionForProcessing } from "./backend/services/jobs/src/contribution-processing-policy.ts";
export { RegisteredIndependentProviderVerifier } from "./backend/workers/ingestion/src/contribution-verification.ts";
export { SourceRegistry } from "./backend/workers/ingestion/src/registry.ts";
export { LeverPostingsAdapter } from "./backend/workers/ingestion/src/lever.ts";
export { AshbyJobBoardAdapter } from "./backend/workers/ingestion/src/ashby.ts";`,
      resolveDir: root,
    },
    alias: {
      "@ai-job-apply/jobs-service": join(root, "backend/services/jobs/src/index.ts"),
      "@ai-job-apply/api-contracts/job-contribution-canonical": join(
        root,
        "packages/api-contracts/src/job-contribution-canonical.ts",
      ),
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    write: false,
    logLevel: "silent",
  });
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(nodeBundle.outputFiles[0].contents).toString("base64")}`
  );
  globalThis.fetch = async () => {
    stats.externalNetworkRequests += 1;
    throw new Error("Unexpected real network fetch in generated-only provider verification");
  };
  browser = await chromium.launch({
    executablePath: testingBrowser(),
    headless: true,
    // Route fulfillment supplies every document. Even accidental unhandled traffic cannot
    // reach a public origin through this deliberately closed loopback proxy.
    proxy: { server: "http://127.0.0.1:9" },
  });
  context = await browser.newContext({ serviceWorkers: "block" });
  let currentDocument;
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (
      currentDocument &&
      request.resourceType() === "document" &&
      request.method() === "GET" &&
      request.url() === currentDocument.url
    ) {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "no-store" },
        body: currentDocument.html,
      });
      return;
    }
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(10_000);

  async function capture(fixture, html = fixture.html, url = fixture.sourceUrl) {
    currentDocument = { url, html };
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: browserBundle.outputFiles[0].text });
    const result = await page.evaluate((capturedAt) => {
      const snapshot = globalThis.D2GeneratedCapture.captureCurrentPublicJobPage();
      return {
        rawId: snapshot.externalJobId,
        capture: globalThis.D2GeneratedCapture.detectPublicJob(snapshot, capturedAt),
      };
    }, timestamp);
    stats.pagesInspected += 1;
    assert.equal(result.rawId, "REQ-42", "The actual inspector must see the requisition fixture");
    return result.capture;
  }

  async function prepare(captured, fields = optionalFields) {
    assert.ok(captured, "Expected exact-provider detection of the generated page");
    const intent = api.createPendingIntent({
      capture: captured,
      approvedFields: fields,
      identityFence: "synthetic-owner-fence",
      intent: "contribute",
      now: new Date(timestamp),
      randomId: () => contributionId,
      retentionMilliseconds: 24 * 60 * 60 * 1_000,
    });
    const { body } = await api.prepareContribution(intent, "synthetic-paired-policy-v1", "0.2.0");
    for (const field of optionalFields) {
      const present =
        field === "externalJobId"
          ? Object.hasOwn(body.source, field)
          : Object.hasOwn(
              body.posting,
              field === "company" ? "companyName" : field === "location" ? "locations" : field,
            );
      assert.equal(present, fields.includes(field), "Optional selection must reach the real body");
    }
    assert.ok(!JSON.stringify(body).includes("SYNTHETIC_PRIVATE_FORM_VALUE"));
    assert.ok(!JSON.stringify(body).includes("REQ-42"));
    stats.payloadsPrepared += 1;
    return api.normalizeContributionForProcessing(body);
  }

  function verifier(fixture, payload = fixture.payload, responseStatus = 200) {
    const requests = [];
    const requestGuardErrors = [];
    const fetch = async (url, init) => {
      requests.push(String(url));
      stats.syntheticApiRequests += 1;
      try {
        assert.equal(
          String(url),
          fixture.apiUrl,
          "Provider acquisition must use its exact API path",
        );
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "error");
        assert.ok(init?.credentials === undefined || init.credentials === "omit");
      } catch (error) {
        requestGuardErrors.push(error.message);
        throw error;
      }
      return new Response(JSON.stringify(payload), {
        status: responseStatus,
        headers: { "content-type": "application/json" },
      });
    };
    const common = {
      sourceId: fixture.sourceId,
      companyName: "Example",
      verifiedCompanyDomain: "synthetic.example.test",
      fetch,
    };
    const adapter =
      fixture.provider === "lever"
        ? new api.LeverPostingsAdapter({
            ...common,
            site: fixture.site,
            region: fixture.eu ? "eu" : "global",
          })
        : new api.AshbyJobBoardAdapter({ ...common, jobBoardName: fixture.site });
    const registry = new api.SourceRegistry(
      [
        {
          sourceId: fixture.sourceId,
          provider: fixture.provider,
          provenance: "permitted_api",
          adapter,
          enabled: true,
        },
      ],
      () => true,
      { providerActivationAllowed: true },
    );
    const instance = new api.RegisteredIndependentProviderVerifier(
      registry,
      { findExact: async () => [] },
      [
        {
          sourceId: fixture.sourceId,
          provider: fixture.provider,
          pageVariant: fixture.provider === "lever" ? "lever-posting-v1" : "ashby-job-board-v1",
          atsTenant: fixture.site,
          sourcePolicyVersion: "synthetic-paired-policy-v1",
        },
      ],
      { clock: () => new Date(timestamp), createId: () => verificationId },
    );
    return { instance, requests, requestGuardErrors };
  }

  async function verify(fixture, proposal, expected, payload, responseStatus) {
    const harness = verifier(fixture, payload, responseStatus);
    const result = await harness.instance.verify({ contributionId, normalizationId, proposal });
    // Verifier failure isolation must not hide a broken transport assertion in a rejection case.
    assert.deepEqual(harness.requestGuardErrors, []);
    assert.equal(
      result.status,
      expected,
      `${fixture.kind}: expected ${expected}, got ${result.status}`,
    );
    if (expected === "verified") {
      assert.equal(harness.requests.length, 1);
      assert.equal(result.providerObservation.externalJobId, postingId);
      assert.equal(result.providerObservation.locations.length, 2);
      assert.equal(result.providerObservation.description, fixture.fullDescription);
      assert.ok(!JSON.stringify(result).includes("pagePreviewDescriptionDigests"));
      assert.ok(!JSON.stringify(result).includes("<h2>"));
      stats.verified += 1;
    } else {
      stats.rejected += 1;
    }
    return result;
  }

  for (const kind of ["lever-global", "lever-eu", "ashby"]) {
    const fixture = pair(kind);
    const captured = await capture(fixture);
    assert.equal(captured.externalJobId, postingId);
    assert.equal(captured.location, "New York, NY, USA");
    const trailingSlash = await capture(fixture, fixture.html, `${fixture.sourceUrl}/`);
    assert.equal(trailingSlash.sourceUrl, fixture.sourceUrl);
    await verify(fixture, await prepare(trailingSlash), "verified");
    // Every subset tests removal through the real preview -> queue -> request mapper.
    for (let mask = 0; mask < 2 ** optionalFields.length; mask += 1) {
      const fields = optionalFields.filter((_field, index) => (mask & (1 << index)) !== 0);
      await verify(fixture, await prepare(captured, fields), "verified");
    }
    for (const mode of ["hybrid", "on_site"]) {
      const changed = pair(kind, { mode });
      await verify(changed, await prepare(await capture(changed)), "verified");
    }
    for (const variant of ["repeated-heading", "long"]) {
      const changed = pair(kind, { variant });
      const nextCapture = await capture(changed);
      if (variant === "long") {
        assert.ok(nextCapture.description.length > 12_000);
        assert.ok(nextCapture.description.length <= 50_000);
        assert.ok(nextCapture.description.endsWith("Equal opportunity for all."));
      }
      await verify(changed, await prepare(nextCapture), "verified");
      if (variant === "long") {
        const encodeScriptText = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
        const shortenedText = nextCapture.description.slice(0, 11_999).trim();
        const shortenedHtml = changed.html.replace(
          encodeScriptText(changed.descriptionHtml),
          encodeScriptText(`<p>${shortenedText}</p>`),
        );
        assert.notEqual(shortenedHtml, changed.html);
        const shortenedCapture = await capture(changed, shortenedHtml);
        assert.equal(shortenedCapture.description, shortenedText);
        await verify(changed, await prepare(shortenedCapture), "mismatch");
        const tailChangedHtml = changed.html.replace(
          "Equal opportunity for all.",
          "Equal opportunity for none.",
        );
        assert.notEqual(tailChangedHtml, changed.html);
        const tailChangedCapture = await capture(changed, tailChangedHtml);
        assert.ok(tailChangedCapture.description.endsWith("Equal opportunity for none."));
        assert.equal(
          tailChangedCapture.description.slice(0, 12_000),
          nextCapture.description.slice(0, 12_000),
        );
        await verify(changed, await prepare(tailChangedCapture), "mismatch");
      }
    }
    const visible = pair(kind, { structured: false });
    await verify(visible, await prepare(await capture(visible)), "verified");

    for (const [before, after] of [
      ["reliable", "unreliable"],
      ["Support 12", "Support 21"],
      ["$120,000", "$120,001"],
      ["Platform Engineer", "Platform Manager"],
      ["New York", "Wrong City"],
      ["Example", "Unrelated Organization"],
      ["TELECOMMUTE", "hybrid"],
    ]) {
      const mutated = await capture(fixture, fixture.html.replaceAll(before, after));
      await verify(fixture, await prepare(mutated), "mismatch");
    }

    const wrongSite = await capture(
      fixture,
      fixture.html,
      fixture.sourceUrl.replace(`/${fixture.site}/`, "/another-site/"),
    );
    await verify(fixture, await prepare(wrongSite), "unavailable");
    const baseProposal = await prepare(captured);
    const wrongPosting = structuredClone(fixture.payload);
    if (fixture.provider === "lever") {
      wrongPosting.id = "22345678-abcd-4abc-8abc-1234567890ab";
      wrongPosting.hostedUrl = fixture.sourceUrl.replace(postingId, wrongPosting.id);
    } else {
      wrongPosting.jobs[0].jobUrl = fixture.sourceUrl.replace(
        postingId,
        "22345678-abcd-4abc-8abc-1234567890ab",
      );
      wrongPosting.jobs[0].applyUrl = `${wrongPosting.jobs[0].jobUrl}/application`;
    }
    await verify(fixture, baseProposal, "unavailable", wrongPosting);
    if (fixture.provider === "ashby") {
      await verify(fixture, baseProposal, "unavailable", { apiVersion: "1", jobs: [] });
      await verify(fixture, baseProposal, "closed", {
        apiVersion: "1",
        jobs: [{ isListed: false, jobUrl: fixture.sourceUrl }],
      });
    } else {
      await verify(fixture, baseProposal, "unavailable", {}, 404);
    }
  }

  const fixture = pair("lever-global");
  for (const url of [
    "https://unsupported.example/synthetic-paired/job-12345",
    "https://jobs.lever.co.attacker.example/synthetic-paired/job-12345",
    "https://jobs.lever.co/synthetic-paired/job-12345/apply",
    "https://jobs.eu.lever.co/synthetic-paired",
    "https://jobs.ashbyhq.com/synthetic-paired/job-12345/application",
    "https://jobs.lever.co:8443/synthetic-paired/job-12345",
    "https://jobs.eu.lever.co:8443/synthetic-paired/job-12345",
    "https://jobs.ashbyhq.com:8443/synthetic-paired/job-12345",
    "https://jobs.lever.co/synthetic-paired//job-12345",
  ]) {
    assert.equal(await capture(fixture, fixture.html, url), undefined);
    stats.rejected += 1;
  }
  assert.equal(stats.externalNetworkRequests, 0);
} finally {
  globalThis.fetch = originalFetch;
  // Keep interception in place until every tab is closed, including on assertion failure.
  try {
    await context?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      stop();
    }
  }
}
process.stdout.write(`${JSON.stringify({ ...stats, passed: true })}\n`);
