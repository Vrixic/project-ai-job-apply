import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, stop } from "esbuild";

const root = resolve(import.meta.dirname, "../../..");
const timestamp = "2026-09-11T12:00:00.000Z";
const grantedAt = "2026-09-11T12:00:01.000Z";
const contributionId = "019d04cf-1f80-7000-8000-000000000061";
const consentId = "019d04cf-1f80-7000-8000-000000000062";
const sourceUrl = "https://jobs.lever.co/example/EXAMPLE-LEVER-001";
const policyVersion = "d2-development-synthetic-v1";
const fields = ["company", "location", "workMode", "description", "externalJobId"];

// This assurance seam bundles current source in memory only. It neither builds application
// artifacts nor depends on stale workspace dist output to validate the client/server boundary.
async function currentSource() {
  const bundle = await build({
    stdin: {
      contents: `export { captureCurrentPublicJobPage } from "./frontend/extension/lib/page-inspection.ts";
export { detectPublicJob } from "./frontend/extension/lib/detectors.ts";
export { prepareContribution, createContributionRequest, ContributionRequestTooLargeError, MAXIMUM_CONTRIBUTION_REQUEST_BYTES } from "./frontend/extension/lib/job-intent-api.ts";
export { MAXIMUM_GATEWAY_BODY_BYTES } from "./backend/gateway/src/gateway-boundary.ts";
export { createPendingIntent } from "./frontend/extension/lib/pending-queue.ts";
export { compileComponentValidator } from "./packages/api-contracts/src/index.ts";
export { JobContributionService } from "./backend/services/jobs/src/contribution.ts";
export { DevelopmentContributionCapabilitySource } from "./backend/services/jobs/src/contribution-capability-source.ts";`,
      resolveDir: root,
    },
    alias: {
      "@ai-job-apply/api-contracts": join(root, "packages/api-contracts/src/index.ts"),
      "@ai-job-apply/api-contracts/job-contribution-canonical": join(
        root,
        "packages/api-contracts/src/job-contribution-canonical.ts",
      ),
      "@ai-job-apply/config": join(root, "packages/config/src/index.ts"),
    },
    banner: {
      js: `import { createRequire as intakeCreateRequire } from "node:module"; const require = intakeCreateRequire(${JSON.stringify(pathToFileURL(join(root, "package.json")).href)});`,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
  );
}

export async function verifyContributionIntake() {
  const stats = {
    profile: "d2_extension_contribution_intake_v1",
    acceptedFixtureVariants: 0,
    acceptedRequests: 0,
    refusedFields: 0,
    refusedCaptures: 0,
    unchangedQueuedRejections: 0,
    tamperedPayloadRejections: 0,
    completeDescriptionsValidated: 0,
    oversizedWireRequestsRefused: 0,
    consentChecks: 0,
    storeCalls: 0,
    externalNetworkRequests: 0,
  };
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const previousGlobals = new Map(
    ["document", "DOMParser", "location"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  let dom;
  let stage = "source_composition";
  try {
    const api = await currentSource();
    assert.equal(api.MAXIMUM_CONTRIBUTION_REQUEST_BYTES, api.MAXIMUM_GATEWAY_BODY_BYTES);
    const validate = api.compileComponentValidator("CreateJobContributionRequest");
    const extensionRequire = createRequire(join(root, "frontend/extension/package.json"));
    const { JSDOM } = extensionRequire("jsdom");
    globalThis.fetch = async () => {
      stats.externalNetworkRequests += 1;
      throw new Error("Synthetic contribution intake forbids network requests");
    };
    const capability = new api.DevelopmentContributionCapabilitySource({
      D2_DEPLOYMENT_ENVIRONMENT: "development",
      D2_DEVELOPMENT_CONTRIBUTIONS_ENABLED: "true",
      D2_CONTRIBUTION_ROUTES_ENABLED: "true",
      D2_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON: '["greenhouse","lever"]',
      D2_DEVELOPMENT_CONTRIBUTION_DOMAINS_JSON:
        '["boards.greenhouse.io","job-boards.greenhouse.io","jobs.lever.co"]',
    });
    const service = new api.JobContributionService(
      {
        async ping() {},
        async get() {
          return null;
        },
        async create(command) {
          stats.storeCalls += 1;
          assert.equal(command.ownerUserId, contributionId);
          return {
            id: command.input.contributionId,
            state: "queued",
            submittedAt: grantedAt,
            updatedAt: grantedAt,
          };
        },
      },
      {
        async verify(binding) {
          stats.consentChecks += 1;
          assert.equal(binding.ownerUserId, contributionId);
          assert.equal(binding.consentId, consentId);
          assert.equal(binding.approvedAt, grantedAt);
          assert.equal(binding.policyVersion, policyVersion);
          assert.equal(binding.clientVersion, "0.2.0");
          return true;
        },
      },
      capability,
      () => new Date(grantedAt),
    );
    function pending(capture, approvedFields = fields) {
      assert.ok(capture);
      return api.createPendingIntent({
        capture,
        approvedFields,
        identityFence: "generated-owner-fence",
        intent: "contribute",
        now: new Date(timestamp),
        randomId: () => contributionId,
        retentionMilliseconds: 3_600_000,
      });
    }
    async function prepare(intent) {
      const before = JSON.stringify(intent);
      const prepared = await api.prepareContribution(intent, policyVersion, "0.2.0");
      const request = api.createContributionRequest(
        intent,
        prepared.body,
        {
          id: consentId,
          grantedAt,
          previewDigestSha256: prepared.previewDigestSha256,
        },
        "generated-unused-token",
        "https://api.example.test",
      );
      const body = JSON.parse(request.init.body);
      assert.ok(Buffer.byteLength(request.init.body, "utf8") <= api.MAXIMUM_GATEWAY_BODY_BYTES);
      assert.equal(body.approval.previewDigestSha256, prepared.previewDigestSha256);
      assert.equal(JSON.stringify(intent), before, "Preparation must not rewrite queued approvals");
      return body;
    }
    const command = (input) => ({
      ownerUserId: contributionId,
      idempotencyKey: `extension-job-intent-${contributionId}`,
      input,
    });
    async function accepted(capture, approvedFields = fields, assertBody = () => {}) {
      const body = await prepare(pending(capture, approvedFields));
      assertBody(body);
      assert.equal(
        validate(body),
        true,
        "The actual current OpenAPI contract must accept the body",
      );
      const before = JSON.stringify(body);
      const calls = stats.storeCalls;
      assert.equal((await service.contribute(command(body))).state, "queued");
      assert.equal(stats.storeCalls, calls + 1);
      assert.equal(JSON.stringify(body), before, "Intake must not silently repair selected fields");
      stats.acceptedRequests += 1;
    }
    const generated = {
      canonicalUrl: sourceUrl,
      company: "Generated Company",
      title: "Generated Engineer",
      location: "Generated City",
      workMode: "remote",
      description: "Generated public posting details.",
    };
    const capture = (changes = {}) => api.detectPublicJob({ ...generated, ...changes }, timestamp);

    stage = "optional_identity_brackets";
    for (const field of ["company", "location"]) {
      for (const bracket of ["<", ">"]) {
        const captured = capture({ [field]: `Generated threshold ${bracket} 10.` });
        assert.ok(captured);
        assert.equal(Object.hasOwn(captured, field), false);
        const mappedField =
          field === "company" ? "companyName" : field === "location" ? "locations" : field;
        await accepted(captured, fields, (body) => {
          assert.equal(Object.hasOwn(body.posting, mappedField), false);
          assert.equal(body.approval.approvedFields.includes(mappedField), false);
        });
        stats.refusedFields += 1;
      }
    }
    stage = "complete_description";
    for (const description of [
      "Generated threshold < 10 and throughput > 5.",
      "Generated threshold <= 10 and throughput >= 5.",
      ...[12_001, 18_185, 50_000].map((length) => {
        const tail = " COMPLETE DESCRIPTION END.";
        return `${"x".repeat(length - tail.length)}${tail}`;
      }),
    ]) {
      const captured = capture({ description });
      assert.equal(captured.description, description);
      await accepted(captured, fields, (body) => {
        assert.equal(body.posting.description, description);
        assert.equal(body.approval.approvedFields.includes("description"), true);
      });
      stats.completeDescriptionsValidated += 1;
    }
    stage = "complete_description_wire_budget";
    for (const description of ["字".repeat(50_000), `${"\u{10437}".repeat(24_999)}XY`]) {
      const captured = capture({ description });
      assert.equal(captured.description, description, "Preview must retain complete Unicode text");
      const intent = pending(captured);
      const before = JSON.stringify(intent);
      const calls = { consent: stats.consentChecks, store: stats.storeCalls };
      await assert.rejects(prepare(intent), api.ContributionRequestTooLargeError);
      assert.equal(JSON.stringify(intent), before);
      assert.deepEqual({ consent: stats.consentChecks, store: stats.storeCalls }, calls);
      stats.oversizedWireRequestsRefused += 1;
      await accepted(
        captured,
        fields.filter((field) => field !== "description"),
        (body) => {
          assert.equal(Object.hasOwn(body.posting, "description"), false);
          assert.equal(body.approval.approvedFields.includes("description"), false);
        },
      );
      assert.equal(captured.description, description, "Deselection must not rewrite the preview");
    }
    stage = "oversized_description_omission";
    for (const description of [
      `${"x".repeat(50_000)}x`,
      "Generated threshold < 10 then <script",
      "Generated threshold > 10 then \uFF1Cscript\uFF1E",
    ]) {
      const captured = capture({ description });
      assert.equal(Object.hasOwn(captured, "description"), false);
      await accepted(captured, fields, (body) => {
        assert.equal(Object.hasOwn(body.posting, "description"), false);
        assert.equal(body.approval.approvedFields.includes("description"), false);
        assert.equal(Object.hasOwn(body, "descriptionUnavailableReason"), false);
        assert.equal(Object.hasOwn(body.posting, "descriptionUnavailableReason"), false);
      });
      stats.refusedFields += 1;
    }
    for (const bracket of ["<", ">"]) {
      assert.equal(capture({ title: `Generated ${bracket} title` }), undefined);
      stats.refusedCaptures += 1;
    }

    stage = "fresh_bounded_fields";
    const longFields = capture({ company: "c".repeat(241), location: "l".repeat(501) });
    assert.equal(Object.hasOwn(longFields, "company"), false);
    assert.equal(Object.hasOwn(longFields, "location"), false);
    await accepted(longFields, fields, (body) => {
      assert.equal(Object.hasOwn(body.posting, "companyName"), false);
      assert.equal(Object.hasOwn(body.posting, "locations"), false);
      assert.equal(body.approval.approvedFields.includes("companyName"), false);
      assert.equal(body.approval.approvedFields.includes("locations"), false);
    });
    stats.refusedFields += 2;
    const exactLimits = capture({ company: "c".repeat(200), location: "l".repeat(240) });
    assert.equal(exactLimits.company, "c".repeat(200));
    assert.equal(exactLimits.location, "l".repeat(240));
    await accepted(exactLimits);
    for (const [field, maximum] of [["title", 240]]) {
      const captured = capture({ [field]: `${"x".repeat(maximum - 1)} remainder` });
      assert.equal(captured[field], "x".repeat(maximum - 1));
      await accepted(captured);
    }

    stage = "accepted_lever_fixtures";
    const fixtureDirectory = join(root, "packages/test-fixtures/ats/lever/job-page-posting-v1");
    async function fixture(name, expectedSha256) {
      const bytes = await readFile(join(fixtureDirectory, name));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedSha256);
      return bytes.toString("utf8");
    }
    // jsdom's default leaves both script execution and subresource loading disabled. These
    // hash-bound fixtures are supplied as strings; never use fromURL or opt into resources.
    dom = new JSDOM(
      await fixture(
        "lever-posting-v1.html",
        "7850364a3985f505e59db7fca9d21f3271a8e347db869e6bea15b7921bbc60eb",
      ),
      { url: sourceUrl },
    );
    assert.equal(dom.window.document.querySelector("script,iframe,link,object,embed"), null);
    assert.equal(
      dom.window.document.querySelector("[src],[srcset],[href],[action],[formaction]"),
      null,
    );
    Object.assign(globalThis, {
      document: dom.window.document,
      DOMParser: dom.window.DOMParser,
      location: dom.window.location,
    });
    for (const structured of [false, true]) {
      if (structured) {
        const script = document.createElement("script");
        script.type = "application/ld+json";
        script.textContent = await fixture(
          "lever-job-posting.json",
          "093f628c72f470eacd7d6651a49d8d01ebbf8f53de06951db7aa971a8e1a747f",
        );
        document.head.append(script);
      }
      const captured = api.detectPublicJob(api.captureCurrentPublicJobPage(), timestamp);
      assert.equal(captured.provider, "lever");
      assert.equal(captured.pageVariant, "lever-posting-v1");
      assert.equal(captured.externalJobId, "EXAMPLE-LEVER-001");
      assert.equal(captured.workMode, "remote");
      await accepted(captured);
      await accepted(captured, ["location", "workMode"]);
      stats.acceptedFixtureVariants += 1;
    }

    stage = "unchanged_queued_payload";
    // This is generated pre-fix local state, not a fresh capture. Reusing an old authorization
    // must never sanitize, remove fields, or recompute an approval for a different payload.
    const historicalDescription = `${"x".repeat(11_980)} historical excerpt.`;
    const historicalPending = pending({ ...capture(), description: historicalDescription });
    const historicalBefore = JSON.stringify(historicalPending);
    const historicalBody = await prepare(historicalPending);
    assert.equal(historicalBody.posting.description, historicalDescription);
    assert.equal(JSON.stringify(historicalPending), historicalBefore);
    assert.equal((await service.contribute(command(historicalBody))).state, "queued");
    stats.acceptedRequests += 1;

    const oldPending = pending({
      ...capture(),
      description: "Generated threshold > 10 then <script",
    });
    const oldBefore = JSON.stringify(oldPending);
    const oldBody = await prepare(oldPending);
    oldPending.consent = {
      id: consentId,
      grantedAt,
      previewDigestSha256: oldBody.approval.previewDigestSha256,
    };
    const approvedBefore = JSON.stringify(oldPending);
    assert.equal(JSON.stringify(await prepare(oldPending)), JSON.stringify(oldBody));
    assert.equal(validate(oldBody), true);
    const callsBeforeRefusal = { consent: stats.consentChecks, store: stats.storeCalls };
    await assert.rejects(service.contribute(command(oldBody)), TypeError);
    assert.equal(JSON.stringify(oldPending), approvedBefore);
    const { consent: _consent, ...withoutConsent } = oldPending;
    assert.equal(JSON.stringify(withoutConsent), oldBefore);
    stats.unchangedQueuedRejections += 1;

    stage = "changed_preview_refusal";
    const tampered = await prepare(pending(capture()));
    tampered.posting.title = "Different generated title after approval";
    assert.equal(validate(tampered), true);
    await assert.rejects(service.contribute(command(tampered)), TypeError);
    stats.tamperedPayloadRejections += 1;
    const fullTail = `${"x".repeat(18_000)} END 123.`;
    const changedTail = await prepare(pending(capture({ description: fullTail })));
    changedTail.posting.description = `${"x".repeat(18_000)} END 124.`;
    assert.equal(validate(changedTail), true);
    await assert.rejects(service.contribute(command(changedTail)), TypeError);
    stats.tamperedPayloadRejections += 1;
    assert.deepEqual(
      { consent: stats.consentChecks, store: stats.storeCalls },
      callsBeforeRefusal,
      "Rejected payloads must not reach consent verification or persistence",
    );
    assert.equal(stats.consentChecks, stats.acceptedRequests);
    assert.equal(stats.storeCalls, stats.acceptedRequests);
    assert.equal(stats.externalNetworkRequests, 0);
    return Object.freeze({ ...stats, passed: true });
  } catch {
    // The failure location is a fixed source enum. Never surface bundled source, fixture
    // contents, request bodies, headers, or an underlying exception through diagnostics.
    throw new Error(`D2 contribution intake assurance failed: ${stage}`);
  } finally {
    dom?.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (previousFetch) Object.defineProperty(globalThis, "fetch", previousFetch);
    else delete globalThis.fetch;
    stop();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(await verifyContributionIntake())}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
