import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createNativeResumeSessionOperator,
  NATIVE_DEVELOPMENT_API,
  NATIVE_HELD_SESSION_MS,
  parseNativeResumeCommand,
} from "../lib/native-resume-session-operator.mjs";
import { validateNativeDevelopmentBinding } from "../start-development-native-resume-session.mjs";

process.env.NODE_ENV = "test";
const jobId = "00000000-0000-7000-8000-000000000001";
const applicationId = "00000000-0000-7000-8000-000000000002";
const material = {
  schemaVersion: 1,
  kind: "tailored_resume",
  generationId: jobId,
  version: 1,
  contentSha256: "c".repeat(64),
  completedAtMs: Date.now(),
  expiresAtMs: Date.now() + 1_800_000,
};
material.expiresAtMs = material.completedAtMs + 1_800_000;
const origin = `https://${jobId}.materials.dev.applydash.ai:8443`;
const location = () => ({
  schemaVersion: 1,
  packetId: applicationId,
  packetHash: "a".repeat(64),
  temporaryMaterial: material,
  origin,
});
const identity = () => ({
  purpose: "native_resume_workload",
  profile: "native_resume_disposable_workload_v1",
  accessToken: "SYNTHETIC_NEVER_REAL_TOKEN",
  authorizedOwner: "Synthetic Native Test",
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
});
const application = (prepared = false) => ({
  id: applicationId,
  canonicalJobId: jobId,
  status: "preparing",
  revision: prepared ? 2 : 1,
  currentAction: "prepare_packet",
  attempts: [],
  createdAt: "2026-10-09T00:00:00Z",
  updatedAt: "2026-10-09T00:00:00Z",
  ...(prepared
    ? {
        currentPacket: {
          id: applicationId,
          version: 1,
          packetHash: "a".repeat(64),
          jobRevision: "b".repeat(64),
          fields: [],
          artifactHashes: { resume: material.contentSha256 },
          temporaryMaterials: [material],
          createdAt: "2026-10-09T00:00:00Z",
        },
      }
    : {}),
});
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

test("closed command grammar refuses arbitrary transport, submission, and extra arguments", () => {
  for (const command of [
    { action: "submit" },
    { action: "inspect", url: "https://evil.test" },
    { action: "prepare", jobId: "../other" },
    { action: "withdraw", requestId: jobId },
    [],
    null,
  ]) {
    assert.throws(() => parseNativeResumeCommand(JSON.stringify(command)));
  }
  assert.throws(() => parseNativeResumeCommand(" ".repeat(513)));
  assert.deepEqual(parseNativeResumeCommand(JSON.stringify({ action: "prepare", jobId })), {
    action: "prepare",
    jobId,
  });
});

test("read-only inspection exposes counts and public IDs, not source or posting data", async () => {
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async (url) => response(url.endsWith("/resumes") ? { documents: [] } : { items: [] }),
  });
  assert.deepEqual(await operator.execute({ action: "inspect" }), {
    outcome: "native-prerequisites-read",
    resumeCount: 0,
    jobIds: [],
  });
  assert.equal(operator.close().recoveryRequired, false);
});

test("production cannot replace the credential transport", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() =>
      createNativeResumeSessionOperator({
        identity: identity(),
        fetch: async () => response({}),
      }),
    );
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("a valid response for another application cannot advance preparation", async () => {
  let calls = 0;
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async () => {
      calls++;
      return response({ ...application(), canonicalJobId: applicationId }, 201);
    },
  });
  await assert.rejects(operator.execute({ action: "prepare", jobId }));
  assert.equal(calls, 1);
  assert.equal(operator.close().recoveryRequired, true);
});

test("a valid response for another withdrawal cannot clear recovery", async () => {
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async () =>
      response(
        {
          requestId: jobId,
          requestedAt: "2026-10-09T00:00:00Z",
          state: "native_tasks_settled",
        },
        202,
      ),
  });
  await assert.rejects(operator.execute({ action: "withdraw" }));
  assert.equal(operator.close().recoveryRequired, true);
});

test("only exact development account, API, issuer and audience may start the CLI", () => {
  const configuration = {
    issuer: "https://dev-chikw7y3dqdi6dyi21.us.auth0.com/",
    audience: "ai-job-apply-api",
  };
  const caller = { Account: "362544434697" };
  const api = {
    ApiId: "lemwm7dvi4",
    Name: "ai-job-apply-development-gateway",
    ApiEndpoint: NATIVE_DEVELOPMENT_API,
    ProtocolType: "HTTP",
  };
  assert.doesNotThrow(() => validateNativeDevelopmentBinding(configuration, caller, api));
  for (const key of Object.keys(api))
    assert.throws(() =>
      validateNativeDevelopmentBinding(configuration, caller, { ...api, [key]: "wrong" }),
    );
  assert.throws(() => validateNativeDevelopmentBinding(configuration, { Account: "other" }, api));
  for (const key of Object.keys(configuration))
    assert.throws(() =>
      validateNativeDevelopmentBinding({ ...configuration, [key]: "wrong" }, caller, api),
    );
});

test("rejects other session purposes, refresh credentials and expired identities", () => {
  for (const update of [
    { purpose: "d2_workload" },
    { profile: "candidate_rights" },
    { refreshToken: "SYNTHETIC" },
    { expiresAt: new Date(0).toISOString() },
    { authorizedOwner: "" },
  ]) {
    assert.throws(() =>
      createNativeResumeSessionOperator({ identity: { ...identity(), ...update } }),
    );
  }
});

test("one preparation uses fixed development transport, redacts preview, withdraws and closes", async () => {
  const calls = [];
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.ok(url.startsWith(`${NATIVE_DEVELOPMENT_API}/v1/`) || url.startsWith(`${origin}/v1/`));
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers.Authorization, `Bearer ${identity().accessToken}`);
      if (url.endsWith("/packets")) return response(application(true), 201);
      if (url.endsWith("/applications")) return response(application(), 201);
      if (url.endsWith(`/applications/${applicationId}`)) return response(application(true));
      if (url.includes("/location?")) return response(location());
      if (url.endsWith("/resume"))
        return response({
          status: "ready",
          matchesPacket: true,
          baseDocument: { id: jobId, fileName: "SENSITIVE_SOURCE.pdf" },
          temporaryMaterial: material,
          contentSha256: material.contentSha256,
        });
      if (url.includes("/material-withdrawals/"))
        return response(
          {
            requestId: url.split("/").at(-1),
            requestedAt: "2026-10-09T00:00:00Z",
            state: options.method === "PUT" ? "pending" : "native_tasks_settled",
          },
          options.method === "PUT" ? 202 : 200,
        );
      throw new Error("unexpected route");
    },
  });
  await assert.rejects(operator.execute({ action: "preview" }));
  assert.equal((await operator.execute({ action: "prepare", jobId })).revision, 2);
  await operator.execute({ action: "prepare", jobId });
  assert.equal(calls.length, 2, "successful preparation is not repeated");
  const preview = await operator.execute({ action: "preview" });
  assert.equal(JSON.stringify(preview).includes("SENSITIVE"), false);
  await assert.rejects(operator.execute({ action: "prepare", jobId: applicationId }));
  assert.equal((await operator.execute({ action: "withdraw" })).state, "pending");
  await assert.rejects(operator.execute({ action: "preview" }));
  assert.equal((await operator.execute({ action: "withdrawal" })).state, "native_tasks_settled");
  assert.equal(operator.close().recoveryRequired, false);
  await assert.rejects(operator.execute({ action: "inspect" }));
});

test("ambiguous preparation retries retain original key and revision; close reports recovery", async () => {
  const packets = [];
  let creates = 0;
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async (url, options) => {
      if (url.endsWith("/applications")) {
        creates++;
        return response(application(), 201);
      }
      packets.push(options);
      if (packets.length === 1) throw new Error("SENSITIVE_UPSTREAM_FAILURE");
      return response(application(true), 201);
    },
  });
  await assert.rejects(operator.execute({ action: "prepare", jobId }));
  await operator.execute({ action: "prepare", jobId });
  assert.equal(creates, 1);
  assert.equal(packets[0].headers["Idempotency-Key"], packets[1].headers["Idempotency-Key"]);
  assert.equal(packets[0].body, packets[1].body);
  assert.equal(operator.close().recoveryRequired, true);
});

test("ambiguous creation retries retain key and cannot switch jobs", async () => {
  const creates = [];
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async (url, options) => {
      if (url.endsWith("/packets")) return response(application(true), 201);
      creates.push(options);
      if (creates.length === 1) throw new Error("ambiguous");
      return response(application(), 201);
    },
  });
  await assert.rejects(operator.execute({ action: "prepare", jobId }));
  await assert.rejects(operator.execute({ action: "prepare", jobId: applicationId }));
  await operator.execute({ action: "prepare", jobId });
  assert.equal(creates[0].headers["Idempotency-Key"], creates[1].headers["Idempotency-Key"]);
  assert.equal(creates[0].body, creates[1].body);
});

test("parallel commands and close cannot interrupt an in-flight mutation", async () => {
  let release;
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = operator.execute({ action: "withdraw" });
  assert.equal(operator.close().outcome, "native-session-busy");
  await assert.rejects(operator.execute({ action: "inspect" }));
  release(response({}, 503));
  await assert.rejects(pending);
  assert.equal(operator.close().recoveryRequired, true);
});

for (const [name, fake] of [
  [
    "redirect",
    () => new Response(null, { status: 302, headers: { location: "https://evil.test" } }),
  ],
  ["oversize", () => response({ value: "x".repeat(1024 * 1024) })],
  ["invalid schema", () => response({ documents: [], unexpected: "SENSITIVE" })],
  ["wrong media type", () => new Response("{}")],
])
  test(`refuses ${name} without accepting response data`, async () => {
    const operator = createNativeResumeSessionOperator({
      identity: identity(),
      fetch: async () => fake(),
    });
    await assert.rejects(operator.execute({ action: "inspect" }));
    assert.equal(operator.close().recoveryRequired, false);
  });

function fileResponse(format) {
  const bytes =
    format === "pdf"
      ? Buffer.from("%PDF-SYNTHETIC_TRANSPORT_FIXTURE")
      : Buffer.from([80, 75, 3, 4, 1, 2, 3]);
  return {
    format,
    mediaType:
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "SENSITIVE_NAME",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    contentSha256: material.contentSha256,
    contentBase64: bytes.toString("base64"),
    temporaryMaterial: material,
  };
}

function nativeFixture({
  changeLocation = (value) => value,
  changeFile = (value) => value,
  generationReady = true,
  nativeNoStore = true,
} = {}) {
  let nativeCalls = 0;
  const operator = createNativeResumeSessionOperator({
    identity: identity(),
    fetch: async (url) => {
      if (url.endsWith("/applications")) return response(application(), 201);
      if (url.endsWith("/packets")) return response(application(true), 201);
      if (url.endsWith(`/applications/${applicationId}`)) {
        const value = application(true);
        value.currentPacket.id = jobId;
        value.currentPacket.version = 2;
        value.revision = 3;
        if (!generationReady) delete value.currentPacket.temporaryMaterials;
        return response(value);
      }
      if (url.includes("/location?"))
        return response(changeLocation({ ...location(), packetId: jobId }));
      assert.ok(
        url.startsWith(`${origin}/v1/`),
        "credential only reaches exact approved native base host",
      );
      nativeCalls++;
      const result = response(
        changeFile(fileResponse(url.endsWith("format=pdf") ? "pdf" : "docx")),
      );
      if (!nativeNoStore) result.headers.delete("cache-control");
      return result;
    },
  });
  return { operator, calls: () => nativeCalls };
}

test("downloads the native resume PDF into memory and returns only the verified size and digest", async () => {
  const { operator, calls } = nativeFixture();
  await operator.execute({ action: "prepare", jobId });
  const result = await operator.execute({ action: "download" });
  assert.equal(result.outcome, "native-resume-files-verified");
  assert.deepEqual(
    result.files.map((file) => file.format),
    ["pdf"],
  );
  assert.equal(result.filesSaved, false);
  assert.equal(calls(), 1);
  assert.equal(/SENSITIVE|contentBase64|SYNTHETIC/u.test(JSON.stringify(result)), false);
});

test("generation pending is reported without fallback to Gateway content or another preparation", async () => {
  const { operator, calls } = nativeFixture({ generationReady: false });
  await operator.execute({ action: "prepare", jobId });
  assert.equal(
    (await operator.execute({ action: "download" })).outcome,
    "native-generation-not-ready",
  );
  assert.equal(calls(), 0);
});

test("missing native no-store is rejected before content acceptance", async () => {
  const { operator, calls } = nativeFixture({ nativeNoStore: false });
  await operator.execute({ action: "prepare", jobId });
  await assert.rejects(operator.execute({ action: "download" }));
  assert.equal(calls(), 1);
});

test("later reads cannot silently switch to another allowed native origin", async () => {
  let changed = false;
  const { operator, calls } = nativeFixture({
    changeLocation: (value) =>
      changed
        ? { ...value, origin: `https://${applicationId}.materials.dev.applydash.ai:8443` }
        : value,
  });
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "download" });
  changed = true;
  await assert.rejects(operator.execute({ action: "download" }));
  assert.equal(calls(), 1);
});

for (const [name, update] of [
  ["foreign hostname", { origin: `https://${jobId}.evil.test:8443` }],
  ["suffix hostname", { origin: `https://${jobId}.materials.dev.applydash.ai.evil.test:8443` }],
  ["wrong packet", { packetHash: "d".repeat(64) }],
  ["renewed expiry", { temporaryMaterial: { ...material, expiresAtMs: material.expiresAtMs + 1 } }],
])
  test(`rejects ${name} before forwarding any native credential`, async () => {
    const { operator, calls } = nativeFixture({
      changeLocation: (value) => ({ ...value, ...update }),
    });
    await operator.execute({ action: "prepare", jobId });
    await assert.rejects(operator.execute({ action: "download" }));
    assert.equal(calls(), 0);
  });

for (const [name, update] of [
  ["wrong digest", { sha256: "d".repeat(64) }],
  ["wrong byte length", { sizeBytes: 1 }],
  ["wrong format", { format: "docx" }],
  ["wrong content binding", { contentSha256: "d".repeat(64) }],
  ["noncanonical bytes", { contentBase64: "====" }],
  ["changed generation", { temporaryMaterial: { ...material, version: 2 } }],
])
  test(`rejects downloaded ${name}`, async () => {
    const { operator, calls } = nativeFixture({ changeFile: (value) => ({ ...value, ...update }) });
    await operator.execute({ action: "prepare", jobId });
    await assert.rejects(operator.execute({ action: "download" }));
    assert.equal(calls(), 1);
  });

// ---------------------------------------------------------------------------------------------------------------------
// Cover letters (ADR-059 addendum 12 to 17): the same closed, redacting operator, plus a bounded hold for the expiry.
const preparationId = "00000000-0000-7000-8000-000000000003";
const letterGenerationId = "00000000-0000-7000-8000-000000000004";
const letterMaterial = () => ({
  schemaVersion: 1,
  kind: "cover_letter",
  generationId: letterGenerationId,
  version: 1,
  contentSha256: "e".repeat(64),
  completedAtMs: Date.now(),
  expiresAtMs: Date.now() + 1_800_000,
});
const letterModel = {
  provider: "bedrock",
  model: "us.anthropic.claude-sonnet-4-6",
  version: "us.anthropic.claude-sonnet-4-6",
};
const preparation = (state = "queued", extra = {}) => ({
  id: preparationId,
  applicationId,
  state,
  createdAt: "2026-10-09T00:00:00Z",
  updatedAt: "2026-10-09T00:00:00Z",
  ...extra,
});
const letterPreview = (letter, overrides = {}) => ({
  status: "ready",
  documentId: letterGenerationId,
  version: 1,
  contentSha256: letter.contentSha256,
  matchesPacket: true,
  reviewRequired: true,
  paragraphs: [{ text: "SENSITIVE_LETTER_TEXT", factIds: [applicationId] }],
  model: letterModel,
  promptVersion: "1.0.0",
  ...overrides,
});

// A fixture whose Gateway holds the resume and, once the letter is ready, a cover letter packet too.
function letterFixture({
  letterReady = true,
  nativeAvailable = true,
  gatewayLocationStatus = 200,
  maxSessionMs,
  tokenMinutes = 30,
  statusBody = () => preparation("running"),
  previewBody = (letter) => letterPreview(letter),
} = {}) {
  const calls = [];
  const letter = letterMaterial();
  // The Gateway and the native host can change after the first verified read, as they do at expiry.
  const state = { bodies: [], gatewayLocationStatus, nativeAvailable };
  const packet = () => {
    const value = application(true);
    value.revision = 3;
    value.currentPacket.id = jobId;
    value.currentPacket.version = 2;
    value.currentPacket.artifactHashes = {
      resume: material.contentSha256,
      coverLetter: letter.contentSha256,
    };
    value.currentPacket.temporaryMaterials = letterReady ? [material, letter] : [material];
    return value;
  };
  const operator = createNativeResumeSessionOperator({
    identity: {
      ...identity(),
      expiresAt: new Date(Date.now() + tokenMinutes * 60_000).toISOString(),
    },
    ...(maxSessionMs ? { maxSessionMs } : {}),
    fetch: async (url, options) => {
      calls.push({ url, method: options.method });
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, `Bearer ${identity().accessToken}`);
      if (url.endsWith("/applications")) return response(application(), 201);
      if (url.endsWith("/packets") && !options.body.includes("coverLetter"))
        return response(application(true), 201);
      if (url.endsWith("/packets")) {
        state.bodies.push(JSON.parse(options.body));
        assert.ok(options.headers["Idempotency-Key"]);
        return response(preparation(), 202);
      }
      if (url.endsWith(`/packet-preparations/${preparationId}`)) return response(statusBody());
      if (url.endsWith(`/applications/${applicationId}`)) return response(packet());
      if (url.includes("/cover-letter/location?")) {
        if (state.gatewayLocationStatus !== 200) return response({}, state.gatewayLocationStatus);
        return response({
          schemaVersion: 1,
          packetId: jobId,
          packetHash: "a".repeat(64),
          temporaryMaterial: letter,
          origin,
        });
      }
      assert.ok(
        url.startsWith(`${origin}/v1/`),
        "credential only reaches the approved native host",
      );
      if (!state.nativeAvailable) throw new TypeError("fetch failed");
      if (url.endsWith("/cover-letter")) return response(previewBody(letter));
      const file = fileResponse(url.endsWith("format=pdf") ? "pdf" : "docx");
      delete file.temporaryMaterial;
      return response({ ...file, contentSha256: letter.contentSha256 });
    },
  });
  return { operator, calls, state, letter };
}

test("the closed grammar admits the cover-letter commands and nothing with arguments", () => {
  for (const action of [
    "coverLetter",
    "coverLetterStatus",
    "coverLetterPreview",
    "coverLetterDownload",
    "coverLetterExpiry",
  ]) {
    assert.deepEqual(parseNativeResumeCommand(JSON.stringify({ action })), { action });
    assert.throws(() => parseNativeResumeCommand(JSON.stringify({ action, text: "write this" })));
  }
});

test("the cover-letter request sends the exact acknowledged notice once and keeps its key on retry", async () => {
  const { operator, state, calls } = letterFixture();
  await assert.rejects(operator.execute({ action: "coverLetter" }), /native_preparation_required/u);
  await operator.execute({ action: "prepare", jobId });
  assert.equal(
    (await operator.execute({ action: "coverLetter" })).outcome,
    "native-cover-letter-queued",
  );
  await operator.execute({ action: "coverLetter" });
  assert.equal(state.bodies.length, 1, "a queued request is not sent twice");
  assert.deepEqual(state.bodies[0], {
    expectedRevision: 2,
    coverLetter: { disclosure: { noticeVersion: "bedrock-cover-letter.v1", acknowledged: true } },
  });
  assert.equal(calls.filter((call) => call.url.endsWith("/packets")).length, 2);
});

test("status reports the preparation state and a definite refusal as a failed state", async () => {
  const { operator } = letterFixture({
    statusBody: () => preparation("failed", { errorCode: "generation_unavailable" }),
  });
  await assert.rejects(operator.execute({ action: "coverLetterStatus" }));
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  assert.deepEqual(await operator.execute({ action: "coverLetterStatus" }), {
    outcome: "native-cover-letter-status",
    state: "failed",
    errorCode: "generation_unavailable",
  });
});

test("a status for another preparation cannot stand in for this one", async () => {
  const { operator } = letterFixture({
    statusBody: () => ({ ...preparation(), id: "00000000-0000-7000-8000-000000000099" }),
  });
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  await assert.rejects(
    operator.execute({ action: "coverLetterStatus" }),
    /native_preparation_mismatch/u,
  );
});

test("preview returns only metadata: the model, paragraph count and time left, never the letter", async () => {
  const { operator } = letterFixture();
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  const result = await operator.execute({ action: "coverLetterPreview" });
  assert.equal(result.outcome, "native-cover-letter-preview-read");
  assert.deepEqual(result.model, { provider: "bedrock", model: "us.anthropic.claude-sonnet-4-6" });
  assert.equal(result.paragraphCount, 1);
  assert.equal(result.promptVersion, "1.0.0");
  assert.ok(result.msRemaining > 0 && result.msRemaining <= 1_800_000);
  assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
});

test("an unfinished cover letter is reported as not ready, without touching the native host", async () => {
  const { operator, calls } = letterFixture({ letterReady: false });
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  const before = calls.length;
  assert.equal(
    (await operator.execute({ action: "coverLetterPreview" })).outcome,
    "native-generation-not-ready",
  );
  assert.equal(
    calls.slice(before).some((call) => call.url.startsWith(origin)),
    false,
  );
});

test("cover-letter files are verified in memory, both formats, binding the content hash", async () => {
  const { operator } = letterFixture();
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  const result = await operator.execute({ action: "coverLetterDownload" });
  assert.equal(result.outcome, "native-cover-letter-files-verified");
  assert.deepEqual(
    result.files.map((file) => file.format),
    ["pdf", "docx"],
  );
  assert.equal(result.filesSaved, false);
  assert.equal(/SENSITIVE|contentBase64/u.test(JSON.stringify(result)), false);
});

test("a cover-letter read that answers for another letter is refused", async () => {
  for (const previewBody of [
    (letter) => letterPreview(letter, { contentSha256: "f".repeat(64) }),
    (letter) => letterPreview(letter, { documentId: jobId }),
    (letter) => letterPreview(letter, { version: 2 }),
    (letter) => letterPreview(letter, { matchesPacket: false }),
  ]) {
    const { operator } = letterFixture({ previewBody });
    await operator.execute({ action: "prepare", jobId });
    await operator.execute({ action: "coverLetter" });
    await assert.rejects(operator.execute({ action: "coverLetterPreview" }));
  }
});

test("expiry needs a verified read first and is reported as not yet expired until thirty minutes", async () => {
  const { operator } = letterFixture();
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  await assert.rejects(
    operator.execute({ action: "coverLetterExpiry" }),
    /native_cover_letter_read_required/u,
  );
  await operator.execute({ action: "coverLetterPreview" });
  const early = await operator.execute({ action: "coverLetterExpiry" });
  assert.equal(early.outcome, "native-cover-letter-not-yet-expired");
  assert.ok(early.msRemaining > 0);
});

// Moving the clock lets the same operator observe the expiry the way the held session will.
async function expiredResult({ gatewayLocationStatus, nativeAvailable }) {
  const { operator, letter, state } = letterFixture({
    maxSessionMs: 45 * 60_000,
    tokenMinutes: 120,
  });
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  await operator.execute({ action: "coverLetterPreview" });
  state.gatewayLocationStatus = gatewayLocationStatus;
  state.nativeAvailable = nativeAvailable;
  const realNow = Date.now;
  Date.now = () => letter.expiresAtMs + 5_000;
  try {
    return await operator.execute({ action: "coverLetterExpiry" });
  } finally {
    Date.now = realNow;
  }
}

test("past expiry, no location from the Gateway and an unreachable native host prove it is gone", async () => {
  assert.deepEqual(await expiredResult({ gatewayLocationStatus: 409, nativeAvailable: false }), {
    outcome: "native-cover-letter-expired-unavailable",
    msPastExpiry: 5_000,
    gatewayStatus: 409,
    directRead: "unreachable",
  });
});

test("past expiry, a native host that still answers is not proof of expiry", async () => {
  const result = await expiredResult({ gatewayLocationStatus: 409, nativeAvailable: true });
  assert.equal(result.outcome, "native-cover-letter-expiry-not-proven");
  assert.equal(result.directRead, 200);
});

test("past expiry, a Gateway fault or a still-issued location is not proof of expiry", async () => {
  assert.equal(
    (await expiredResult({ gatewayLocationStatus: 503, nativeAvailable: false })).outcome,
    "native-cover-letter-expiry-not-proven",
  );
  assert.equal(
    (await expiredResult({ gatewayLocationStatus: 200, nativeAvailable: false })).outcome,
    "native-cover-letter-expiry-not-proven",
  );
});

test("the default session ends at twenty minutes and only a bounded hold reaches past it", () => {
  const plain = createNativeResumeSessionOperator({ identity: identity() });
  assert.ok(plain.expiresAt - Date.now() <= 20 * 60_000);
  const long = { ...identity(), expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() };
  const held = createNativeResumeSessionOperator({
    identity: long,
    maxSessionMs: NATIVE_HELD_SESSION_MS,
  });
  const remaining = held.expiresAt - Date.now();
  assert.ok(remaining > 40 * 60_000 && remaining <= 45 * 60_000);
  // The access token's own expiry still binds a held session.
  const bound = createNativeResumeSessionOperator({
    identity: identity(),
    maxSessionMs: NATIVE_HELD_SESSION_MS,
  });
  assert.ok(bound.expiresAt - Date.now() <= 30 * 60_000);
  for (const bad of [0, 19 * 60_000, 46 * 60_000, 3_600_000.5, "2700000"]) {
    assert.throws(
      () => createNativeResumeSessionOperator({ identity: long, maxSessionMs: bad }),
      /native_session_window_invalid/u,
    );
  }
});

test("cover-letter reads are refused once withdrawal has started", async () => {
  const { operator } = letterFixture();
  await operator.execute({ action: "prepare", jobId });
  await operator.execute({ action: "coverLetter" });
  await operator.execute({ action: "withdraw" }).catch(() => undefined);
  await assert.rejects(operator.execute({ action: "coverLetterPreview" }));
  await assert.rejects(operator.execute({ action: "coverLetterExpiry" }));
});
