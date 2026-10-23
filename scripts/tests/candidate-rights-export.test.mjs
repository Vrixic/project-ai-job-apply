import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkCandidateRightsExportReady,
  EXPORT_INPUT_TIMEOUT_MILLISECONDS,
  MAXIMUM_EXPORT_BYTES,
  MAXIMUM_EXPORT_ENVELOPE_BYTES,
  MAXIMUM_RESTRICTED_EXPORT_ENVELOPE_BYTES,
  readCandidateRightsExportEnvelope,
  readRestrictedAnswerExportEnvelope,
  validateCandidateRightsExport,
  validateCandidateRightsExportEnvelope,
  validateRestrictedAnswerExport,
  validateRestrictedAnswerExportEnvelope,
} from "../lib/candidate-rights-export.mjs";

// Generated values follow packages/domain/src/schemas.test.ts; no real artifact or identity.
const exportId = "019d04cf-1f80-7000-8000-000000000040";
const consentId = "019d04cf-1f80-7000-8000-000000000061";
const contributionId = "019d04cf-1f80-7000-8000-000000000060";
const caseId = "019d04cf-1f80-7000-8000-000000000050";
const at = "2026-09-11T12:00:00.000Z";
const policyVersion = "d2-development-synthetic-v1";
const sentinel = "PRIVATE_SENTINEL_DO_NOT_REFLECT";
const expected = { expectedExportId: exportId, expectedPolicyVersion: policyVersion };
const rejected = { valid: false, error: "CandidateRightsExportRejected" };
const emptyCounts = {
  valid: true,
  consentCount: 0,
  contributionApprovalCount: 0,
  contributionCount: 0,
  privateCaptureCount: 0,
  trustCaseCount: 0,
  trustCaseEventCount: 0,
};
const script = fileURLToPath(new URL("../lib/candidate-rights-export.mjs", import.meta.url));

function fixture(nonempty = false) {
  const result = {
    schemaVersion: 1,
    format: "candidate-data-export-v1",
    exportId,
    policyVersion,
    generatedAt: at,
    candidate: { email: "candidate@example.test", createdAt: at, connectedAccounts: [] },
    profile: { preferences: null, facts: [], contributionConsents: [] },
    documents: { resumes: [] },
    jobs: { reports: [], contributions: [] },
    matching: { savedJobs: [], privateSavedPageCaptures: [] },
    billing: { entitlement: { plan: "free", version: 0, effectiveAt: at } },
    trust: { schemaVersion: 1, cases: [], caseEvents: [], contributorReputationEvidence: [] },
    audit: { events: [] },
  };
  if (!nonempty) return result;
  result.profile.contributionConsents.push({
    consentId,
    purpose: "ugc_contribution",
    client: "extension",
    documentVersion: "ugc-contribution-preview.v1",
    policyVersion: "synthetic-v1",
    state: "granted",
    grantedAt: at,
    recordedAt: at,
  });
  result.jobs.contributions.push({
    id: contributionId,
    state: "published",
    source: {
      provider: "greenhouse",
      pageVariant: "greenhouse-board-v1",
      sourceUrl: "https://job-boards.greenhouse.io/synthetic/jobs/123",
      adapterVersion: "d2-job-page-v1",
    },
    posting: { title: "Synthetic engineer", description: sentinel },
    observation: { observedAt: at },
    approval: {
      consentId,
      consentVersion: "ugc-contribution-preview.v1",
      policyVersion: "synthetic-v1",
      approvedAt: at,
    },
    processingHistory: [
      {
        state: "published",
        reasonCode: "publication_complete",
        policyVersion: "synthetic-v1",
        occurredAt: at,
      },
    ],
    trustHistory: [{ status: "accepted", policyVersion: "synthetic-v1", decidedAt: at }],
    createdAt: at,
    updatedAt: at,
  });
  result.matching.privateSavedPageCaptures.push({
    id: contributionId,
    provider: "lever",
    pageVariant: "lever-posting-v1",
    sourceUrl: "https://jobs.eu.lever.co/synthetic/123",
    adapterVersion: "d2-job-page-v1",
    title: "Synthetic engineer",
    company: null,
    location: null,
    description: sentinel,
    externalJobId: null,
    capturedAt: at,
    savedAt: at,
    resolution: null,
  });
  result.trust.cases.push({
    id: caseId,
    contributionId,
    policyVersion: "synthetic-trust-v1",
    appealWindowMilliseconds: 1_000,
    state: "accepted",
    version: 2,
    appealCount: 0,
    adverseState: null,
    adverseDecisionAt: null,
    appealDeadlineAt: null,
    pendingAppealEvidenceDigestSha256: null,
    lastAction: "review_accepted",
    lastActorKind: "reviewer",
    lastReasonCode: "independently_verified",
    lastEvidenceDigestSha256: "a".repeat(64),
    createdAt: at,
    updatedAt: at,
  });
  result.trust.caseEvents.push({
    eventId: "019d04cf-1f80-8000-8000-000000000052",
    caseId,
    caseVersion: 2,
    contributionId,
    policyVersion: "synthetic-trust-v1",
    priorState: "needs_review",
    resultingState: "accepted",
    action: "review_accepted",
    actorKind: "reviewer",
    reasonCode: "independently_verified",
    evidenceDigestSha256: "a".repeat(64),
    occurredAt: at,
  });
  return result;
}

function bytes(value) {
  return Buffer.from(JSON.stringify(value));
}

function restrictedFixture() {
  const artifact = fixture();
  const entry = {
    id: "019d04cf-1f80-7000-8000-000000000071",
    fieldKey: "authorization.us_authorized",
    version: 2,
    valueType: "boolean",
    sensitivity: "restricted",
    state: "active",
    confirmedAt: "2026-09-10T12:00:00.000Z",
    createdAt: "2026-09-10T12:00:00.000Z",
    value: "true",
  };
  artifact.profile.restrictedAnswers = [
    entry,
    {
      ...entry,
      id: "019d04cf-1f80-7000-8000-000000000072",
      fieldKey: "authorization.sponsorship_required",
      version: 1,
      expiresAt: "2026-09-11T11:00:00.000Z",
      value: "false",
    },
    {
      ...entry,
      id: "019d04cf-1f80-7000-8000-000000000073",
      fieldKey: "disclosure.non_compete",
      state: "deleted",
    },
  ];
  delete artifact.profile.restrictedAnswers[2].value;
  return {
    artifact,
    binding: {
      ...expected,
      expectedRestrictedAnswers: structuredClone(artifact.profile.restrictedAnswers),
    },
  };
}

const restrictedCounts = {
  valid: true,
  activeValueCount: 1,
  expiredValueCount: 1,
  deletedTombstoneCount: 1,
  revisedValueCount: 1,
};

test("restricted acceptance permits confirmation before database insertion", () => {
  const { artifact, binding } = restrictedFixture();
  // The candidate confirms first; KMS encryption precedes the SQL insert and its created_at.
  // This also covers a saved historical answer already expired when it was inserted.
  for (const entry of artifact.profile.restrictedAnswers) {
    entry.createdAt = "2026-09-11T11:30:00.123Z";
  }
  binding.expectedRestrictedAnswers = structuredClone(artifact.profile.restrictedAnswers);
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), restrictedCounts);
});

test("restricted acceptance matches PostgreSQL JSON and owner-list timestamp spellings", () => {
  const { artifact, binding } = restrictedFixture();
  for (const entry of artifact.profile.restrictedAnswers) {
    entry.confirmedAt = "2026-09-10T12:00:00+00:00";
    entry.createdAt = "2026-09-10T17:30:00.000000+05:30";
    if (entry.expiresAt) entry.expiresAt = "2026-09-11T11:00:00+00:00";
  }
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), restrictedCounts);
});

test("restricted acceptance rejects sub-millisecond creation after export", () => {
  const { artifact, binding } = restrictedFixture();
  artifact.profile.restrictedAnswers[0].createdAt = "2026-09-11T12:00:00.000001Z";
  binding.expectedRestrictedAnswers = structuredClone(artifact.profile.restrictedAnswers);
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
});

test("restricted acceptance distinguishes adjacent microseconds despite equivalent date spellings", () => {
  const { artifact, binding } = restrictedFixture();
  binding.expectedRestrictedAnswers[0].createdAt = "2026-09-10T12:00:00.123456Z";
  artifact.profile.restrictedAnswers[0].createdAt = "2026-09-10T12:00:00.123457+00:00";
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
  artifact.profile.restrictedAnswers[0].createdAt = "2026-09-10T12:00:00.123456+00:00";
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), restrictedCounts);
});

for (const [name, change] of [
  [
    "confirmation after export by one nanosecond",
    (entries) => {
      entries[0].confirmedAt = "2026-09-11T12:00:00.000000001Z";
    },
  ],
  [
    "equivalent expiry and confirmation instants",
    (entries) => {
      entries[1].expiresAt = "2026-09-10T17:30:00.000000+05:30";
    },
  ],
  [
    "more than nine fractional digits",
    (entries) => {
      entries[0].createdAt = "2026-09-10T12:00:00.1234567890Z";
    },
  ],
]) {
  test(`restricted acceptance refuses ${name} without timestamp rounding`, () => {
    const { artifact, binding } = restrictedFixture();
    change(artifact.profile.restrictedAnswers);
    binding.expectedRestrictedAnswers = structuredClone(artifact.profile.restrictedAnswers);
    assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
  });
}

test("restricted acceptance matches exact independent latest metadata and values, order independently", () => {
  const { artifact, binding } = restrictedFixture();
  artifact.profile.restrictedAnswers.reverse();
  artifact.profile.restrictedAnswers[0] = Object.fromEntries(
    Object.entries(artifact.profile.restrictedAnswers[0]).reverse(),
  );
  const result = validateRestrictedAnswerExport(bytes(artifact), binding);
  assert.deepEqual(result, restrictedCounts);
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(
    cli(
      bytes({ schemaVersion: 1, ...binding, artifactBase64: bytes(artifact).toString("base64") }),
      ["--restricted-answer-acceptance"],
    ),
    { status: 0, output: restrictedCounts },
  );
});

for (const [name, mutate] of [
  [
    "omitted restricted metadata",
    (a) => {
      delete a.profile.restrictedAnswers;
    },
  ],
  [
    "missing active value",
    (a) => {
      delete a.profile.restrictedAnswers[0].value;
    },
  ],
  [
    "wrong value",
    (a) => {
      a.profile.restrictedAnswers[0].value = sentinel;
    },
  ],
  [
    "superseded version",
    (a) => {
      a.profile.restrictedAnswers[0].version = 1;
    },
  ],
  [
    "additional old version",
    (a) => {
      a.profile.restrictedAnswers.push({ ...a.profile.restrictedAnswers[0], version: 1 });
    },
  ],
  [
    "duplicate instead of expired entry",
    (a) => {
      a.profile.restrictedAnswers[1] = a.profile.restrictedAnswers[0];
    },
  ],
  [
    "deleted value",
    (a) => {
      a.profile.restrictedAnswers[2].value = sentinel;
    },
  ],
  [
    "context mismatch",
    (a) => {
      a.profile.restrictedAnswers[0].context = "another-context";
    },
  ],
  [
    "field mismatch",
    (a) => {
      a.profile.restrictedAnswers[0].fieldKey = "demographic.gender";
    },
  ],
  [
    "identity mismatch",
    (a) => {
      a.profile.restrictedAnswers[0].id = contributionId;
    },
  ],
  [
    "expiry mismatch",
    (a) => {
      a.profile.restrictedAnswers[1].expiresAt = at;
    },
  ],
  [
    "metadata mismatch",
    (a) => {
      a.profile.restrictedAnswers[0].confirmedAt = at;
    },
  ],
  [
    "another export",
    (a) => {
      a.exportId = contributionId;
    },
  ],
]) {
  test(`restricted acceptance refuses ${name} without reflecting values`, () => {
    const { artifact, binding } = restrictedFixture();
    mutate(artifact);
    assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
  });
}

for (const [name, mutate] of [
  [
    "no expired case",
    (e) => {
      delete e[1].expiresAt;
    },
  ],
  [
    "no active case",
    (e) => {
      e[0].expiresAt = at;
    },
  ],
  [
    "no revised case",
    (e) => {
      e[0].version = 1;
    },
  ],
  [
    "no deleted case",
    (e) => {
      e[2].state = "active";
      e[2].value = "false";
    },
  ],
  [
    "duplicate ids",
    (e) => {
      e[1].id = e[0].id;
    },
  ],
  [
    "duplicate logical references",
    (e) => {
      e[1].fieldKey = e[0].fieldKey;
    },
  ],
  [
    "unknown metadata-only field",
    (e) => {
      e[2].fieldKey = "credential.secret";
    },
  ],
  [
    "missing value",
    (e) => {
      delete e[0].value;
    },
  ],
  [
    "invalid sensitivity",
    (e) => {
      e[0].sensitivity = "public";
    },
  ],
  [
    "confirmation after export",
    (e) => {
      e[0].confirmedAt = "2026-09-12T12:00:00.000Z";
    },
  ],
  [
    "expiry before confirmation",
    (e) => {
      e[1].expiresAt = e[1].confirmedAt;
    },
  ],
  [
    "creation after export",
    (e) => {
      e[0].createdAt = "2026-09-12T12:00:00.000Z";
    },
  ],
]) {
  test(`restricted acceptance requires a complete independent fixture: ${name}`, () => {
    const { artifact, binding } = restrictedFixture();
    mutate(binding.expectedRestrictedAnswers);
    artifact.profile.restrictedAnswers = structuredClone(binding.expectedRestrictedAnswers);
    assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
  });
}

test("restricted transport is closed, bounded, canonical and fixed-policy only", async () => {
  const { artifact, binding } = restrictedFixture();
  const input = {
    schemaVersion: 1,
    ...binding,
    artifactBase64: bytes(artifact).toString("base64"),
  };
  assert.deepEqual(validateRestrictedAnswerExportEnvelope(bytes(input)), restrictedCounts);
  assert.deepEqual(
    await readRestrictedAnswerExportEnvelope(Readable.from([bytes(input)])),
    restrictedCounts,
  );
  for (const change of [
    { schemaVersion: 2 },
    { expectedPolicyVersion: "another-policy" },
    { extra: sentinel },
    { expectedRestrictedAnswers: null },
    { expectedRestrictedAnswers: [] },
    { expectedRestrictedAnswers: Array(101).fill(binding.expectedRestrictedAnswers[0]) },
    { artifactBase64: "Zh==" },
    { artifactBase64: "" },
    { artifactBase64: null },
  ])
    assert.deepEqual(
      validateRestrictedAnswerExportEnvelope(bytes({ ...input, ...change })),
      rejected,
    );
  assert.deepEqual(
    validateRestrictedAnswerExportEnvelope(
      Buffer.alloc(MAXIMUM_RESTRICTED_EXPORT_ENVELOPE_BYTES + 1),
    ),
    rejected,
  );
  const duplicate = JSON.stringify(input).replace(
    '"expectedRestrictedAnswers":',
    '"expectedRestrictedAnswers":[],"expectedRestrictedAnswers":',
  );
  assert.deepEqual(validateRestrictedAnswerExportEnvelope(Buffer.from(duplicate)), rejected);
  assert.deepEqual(validateRestrictedAnswerExportEnvelope(Buffer.from([0xff])), rejected);
  assert.deepEqual(validateRestrictedAnswerExportEnvelope(bytes(input).subarray(0, -1)), rejected);
  assert.deepEqual(cli(bytes({ ...input, extra: sentinel }), ["--restricted-answer-acceptance"]), {
    status: 1,
    output: rejected,
  });
  assert.deepEqual(cli(bytes(input), ["--restricted-answer-acceptance", sentinel]), {
    status: 1,
    output: rejected,
  });
  assert.deepEqual(cli(bytes(input)), { status: 1, output: rejected }); // Ordinary transport is unchanged.
});

test("restricted snapshot and streaming bounds refuse before reflecting input", async () => {
  const { artifact, binding } = restrictedFixture();
  for (let i = 0; i < 18; i += 1) {
    binding.expectedRestrictedAnswers.push({
      ...binding.expectedRestrictedAnswers[0],
      id: `019d04cf-1f80-7000-8000-${String(100 + i).padStart(12, "0")}`,
      context: `generated-context-${i}`,
      value: "x".repeat(3900),
    });
  }
  artifact.profile.restrictedAnswers = structuredClone(binding.expectedRestrictedAnswers);
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
  let emitted = 0;
  const oversized = new Readable({
    read() {
      emitted += 1;
      this.push(Buffer.alloc(65_536, 0x20));
    },
  });
  assert.deepEqual(await readRestrictedAnswerExportEnvelope(oversized), rejected);
  assert.equal(oversized.destroyed, true);
  assert.ok(emitted < 31);
  assert.deepEqual(await readRestrictedAnswerExportEnvelope(null), rejected);
  assert.deepEqual(await readRestrictedAnswerExportEnvelope(Readable.from([sentinel])), rejected);
});

test("restricted streaming failures retain the shared total deadline and never reflect data", async (context) => {
  const { artifact, binding } = restrictedFixture();
  const raw = bytes({
    schemaVersion: 1,
    ...binding,
    artifactBase64: bytes(artifact).toString("base64"),
  });
  const early = new PassThrough();
  const earlyResult = readRestrictedAnswerExportEnvelope(early);
  early.write(raw);
  early.destroy();
  assert.deepEqual(await earlyResult, rejected);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = new PassThrough();
  const stalledResult = readRestrictedAnswerExportEnvelope(stalled);
  stalled.write(Buffer.from("{"));
  context.mock.timers.tick(EXPORT_INPUT_TIMEOUT_MILLISECONDS);
  assert.deepEqual(await stalledResult, rejected);
  assert.equal(stalled.destroyed, true);
});

function envelope(artifactBytes = bytes(fixture()), changes = {}) {
  return {
    schemaVersion: 1,
    ...expected,
    artifactBase64: artifactBytes.toString("base64"),
    ...changes,
  };
}

function accept(value = fixture(), binding = expected) {
  return validateCandidateRightsExport(bytes(value), binding);
}

function cli(input, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    input,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 8_192,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, "");
  assert.equal(result.signal, null);
  return { status: result.status, output: JSON.parse(result.stdout) };
}

test("readiness compiles the current source schema without a dist import", () => {
  assert.deepEqual(checkCandidateRightsExportReady(), { ready: true });
  const source = readFileSync(script, "utf8");
  assert.ok(source.includes("packages/domain/schemas/v1/candidate-data-export.schema.json"));
  assert.equal(source.includes("/dist/"), true); // Only Ajv's own maintained package entrypoint.
  assert.equal(source.includes("packages/domain/dist"), false);
  assert.deepEqual(cli(undefined, ["--check-ready"]), { status: 0, output: { ready: true } });
});

test("generated empty and nonempty fixtures also pass the unmodified shared schema", () => {
  const domainRequire = createRequire(
    new URL("../../packages/domain/package.json", import.meta.url),
  );
  const { Ajv2020 } = domainRequire("ajv/dist/2020.js");
  const addFormats = domainRequire("ajv-formats");
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(
      readFileSync(
        new URL(
          "../../packages/domain/schemas/v1/candidate-data-export.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  assert.equal(validate(fixture()), true);
  assert.equal(validate(fixture(true)), true);
});

test("valid empty D2 sections report zero, never a nonempty-assurance claim", () => {
  assert.deepEqual(accept(), emptyCounts);
  assert.ok(Object.isFrozen(accept()));
  assert.deepEqual(validateCandidateRightsExportEnvelope(bytes(envelope())), emptyCounts);
});

test("valid nonempty D2 sections report only the exact independent counters", () => {
  const value = fixture(true);
  value.profile.contributionConsents.push({
    ...value.profile.contributionConsents[0],
    state: "revoked",
  });
  value.trust.caseEvents.push({
    ...value.trust.caseEvents[0],
    eventId: "019d04cf-1f80-8000-8000-000000000053",
  });
  const result = accept(value);
  assert.deepEqual(result, {
    valid: true,
    consentCount: 2,
    contributionApprovalCount: 1,
    contributionCount: 1,
    privateCaptureCount: 1,
    trustCaseCount: 1,
    trustCaseEventCount: 2,
  });
  for (const privateValue of [
    sentinel,
    exportId,
    contributionId,
    caseId,
    "https://",
    "candidate@example.test",
  ]) {
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test("valid Unicode and JSON string escapes are data, not parser syntax", () => {
  const value = fixture(true);
  value.jobs.contributions[0].posting.description =
    'Generated 日本語 café 😀 {"duplicate":1,"duplicate":2} \\ \n';
  assert.equal(accept(value).valid, true);
});

for (const [label, raw] of [
  ["empty", Buffer.alloc(0)],
  ["whitespace", Buffer.from(" \t\r\n")],
  ["malformed", Buffer.from(`{"${sentinel}":`)],
  ["truncated", bytes(fixture()).subarray(0, -1)],
  ["multiple documents", Buffer.from(`${JSON.stringify(fixture())}{}`)],
  ["null", Buffer.from("null")],
  ["array", Buffer.from("[]")],
  ["string", Buffer.from(JSON.stringify(sentinel))],
  ["invalid byte", Buffer.from([0xff])],
  ["overlong UTF8", Buffer.from([0xc0, 0xaf])],
  ["truncated UTF8", Buffer.concat([bytes(fixture()).subarray(0, -1), Buffer.from([0xe2, 0x82])])],
  ["surrogate UTF8", Buffer.from([0xed, 0xa0, 0x80])],
  ["BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes(fixture())])],
  ["over byte bound", Buffer.alloc(MAXIMUM_EXPORT_BYTES + 1, 0x20)],
]) {
  test(`rejects ${label} artifact with a fixed private-data-free error`, () => {
    assert.deepEqual(validateCandidateRightsExport(raw, expected), rejected);
  });
}

test("rejects malformed UTF8 inside an otherwise schema-valid string", () => {
  const value = fixture(true);
  const parts = JSON.stringify(value).split(sentinel);
  assert.deepEqual(
    validateCandidateRightsExport(
      Buffer.concat([
        Buffer.from(parts[0]),
        Buffer.from([0xc3, 0x28]),
        Buffer.from(parts.slice(1).join(sentinel)),
      ]),
      expected,
    ),
    rejected,
  );
});

test("byte bounds, not character counts, govern multibyte and maximum artifacts", () => {
  const valid = bytes(fixture());
  assert.deepEqual(
    validateCandidateRightsExport(
      Buffer.concat([valid, Buffer.alloc(MAXIMUM_EXPORT_BYTES - valid.length, 0x20)]),
      expected,
    ),
    emptyCounts,
  );
  assert.deepEqual(
    validateCandidateRightsExport(
      Buffer.from(`"${"é".repeat(MAXIMUM_EXPORT_BYTES / 2)}"`),
      expected,
    ),
    rejected,
  );
});

test("a maximum-sized valid artifact survives the complete base64 stdin path", () => {
  const raw = bytes(fixture());
  const maximum = Buffer.concat([raw, Buffer.alloc(MAXIMUM_EXPORT_BYTES - raw.length, 0x20)]);
  const transport = bytes(envelope(maximum));
  assert.ok(transport.length < MAXIMUM_EXPORT_ENVELOPE_BYTES);
  assert.deepEqual(cli(transport), { status: 0, output: emptyCounts });
});

for (const binding of [
  { ...expected, expectedExportId: contributionId },
  { ...expected, expectedExportId: 123 },
  { ...expected, expectedExportId: "" },
  { ...expected, expectedPolicyVersion: "another-policy" },
  { ...expected, expectedPolicyVersion: null },
  { ...expected, extra: sentinel },
  { expectedExportId: exportId },
  null,
]) {
  test("rejects a missing, mistyped, additional or nonmatching expected binding", () => {
    assert.deepEqual(accept(fixture(), binding), rejected);
  });
}

for (const [section, key] of [
  ["profile", "contributionConsents"],
  ["jobs", "contributions"],
  ["matching", "privateSavedPageCaptures"],
  [null, "trust"],
]) {
  test(`D2 requires the existing ${key} section, including when empty`, () => {
    const value = fixture();
    delete (section ? value[section] : value)[key];
    assert.deepEqual(accept(value), rejected);
    value.policyVersion = "d1-synthetic-v1";
    assert.deepEqual(
      accept(value, { ...expected, expectedPolicyVersion: value.policyVersion }),
      emptyCounts,
    );
  });
}

for (const mutate of [
  (value) => {
    value.accessToken = sentinel;
  },
  (value) => {
    value.candidate.subject = sentinel;
  },
  (value) => {
    value.profile.facts = [null];
  },
  (value) => {
    value.profile.contributionConsents[0].ownerUserId = contributionId;
  },
  (value) => {
    value.jobs.contributions[0].approval = null;
  },
  (value) => {
    delete value.jobs.contributions[0].processingHistory;
  },
  (value) => {
    delete value.jobs.contributions[0].trustHistory;
  },
  (value) => {
    value.jobs.contributions[0].processingHistory[0].reasonCode = sentinel;
  },
  (value) => {
    value.matching.privateSavedPageCaptures[0].sourceUrl += "?token=secret";
  },
  (value) => {
    value.trust.cases[0].reviewerId = contributionId;
  },
  (value) => {
    value.trust.caseEvents[0].caseVersion = "2";
  },
  (value) => {
    value.trust.contributorReputationEvidence = [{}];
  },
  (value) => {
    delete value.trust.contributorReputationEvidence;
  },
  (value) => {
    value.generatedAt = "not-a-date";
  },
  (value) => {
    value.schemaVersion = "1";
  },
  (value) => {
    value.format = "arbitrary-export";
  },
]) {
  test("retains strict schema checks across every owner and D2 nested record", () => {
    const value = fixture(true);
    mutate(value);
    assert.deepEqual(accept(value), rejected);
  });
}

for (const key of [
  "schemaVersion",
  "format",
  "exportId",
  "policyVersion",
  "candidate",
  "profile",
  "trust",
]) {
  test(`rejects duplicate required or optional artifact key ${key}`, () => {
    const value = fixture();
    const duplicate = `{${JSON.stringify(key)}:${JSON.stringify(value[key])},${JSON.stringify(value).slice(1)}`;
    assert.deepEqual(validateCandidateRightsExport(Buffer.from(duplicate), expected), rejected);
  });
}

test("rejects escaped duplicate names and duplicates inside nested arrays", () => {
  const raw = JSON.stringify(fixture(true));
  const duplicates = [
    raw.replace('"exportId":', `"export\\u0049d":"${exportId}","exportId":`),
    raw.replace('"createdAt":', `"createdAt":"${at}","createdAt":`),
    raw.replace('"consentId":', `"consentId":"${consentId}","consentId":`),
    raw.replace('"caseVersion":', '"caseVersion":1,"caseVersion":'),
  ];
  for (const candidate of duplicates)
    assert.deepEqual(validateCandidateRightsExport(Buffer.from(candidate), expected), rejected);
});

test("rejects deeply nested unexpected JSON without stack overflow or reflection", () => {
  const raw = `{"${sentinel}":${"[".repeat(5000)}0${"]".repeat(5000)}}`;
  assert.deepEqual(validateCandidateRightsExport(Buffer.from(raw), expected), rejected);
});

for (const change of [
  { schemaVersion: "1" },
  { schemaVersion: 2 },
  { extra: sentinel },
  { expectedExportId: undefined },
  { expectedPolicyVersion: undefined },
  { artifactBase64: undefined },
  { artifactBase64: "" },
  { artifactBase64: null },
  { artifactBase64: "%%%%" },
  { artifactBase64: "Zg==\n" },
  { artifactBase64: "Zh==" },
  { artifactBase64: "Zm9v====" },
  { artifactBase64: "a".repeat(4 * Math.ceil(MAXIMUM_EXPORT_BYTES / 3) + 4) },
]) {
  test("rejects noncanonical, incomplete, mistyped or oversized stdin envelopes", () => {
    assert.deepEqual(
      validateCandidateRightsExportEnvelope(bytes(envelope(undefined, change))),
      rejected,
    );
  });
}

for (const key of [
  "schemaVersion",
  "expectedExportId",
  "expectedPolicyVersion",
  "artifactBase64",
]) {
  test(`rejects duplicate stdin envelope key ${key}`, () => {
    const value = envelope();
    const raw = `{${JSON.stringify(key)}:${JSON.stringify(value[key])},${JSON.stringify(value).slice(1)}`;
    assert.deepEqual(validateCandidateRightsExportEnvelope(Buffer.from(raw)), rejected);
  });
}

test("stdin envelope UTF8, total bound and full-document checks are independent", () => {
  const value = bytes(envelope());
  for (const invalid of [
    Buffer.from([0xff]),
    value.subarray(0, -1),
    Buffer.concat([value, Buffer.from("{}")]),
    Buffer.alloc(MAXIMUM_EXPORT_ENVELOPE_BYTES + 1, 0x20),
  ]) {
    assert.deepEqual(validateCandidateRightsExportEnvelope(invalid), rejected);
  }
});

test("complete split byte streams preserve the exact envelope and aggregate", async () => {
  const input = new PassThrough();
  const result = readCandidateRightsExportEnvelope(input);
  const raw = bytes(envelope(bytes(fixture(true))));
  for (let offset = 0; offset < raw.length; offset += 73)
    input.write(raw.subarray(offset, offset + 73));
  input.end();
  assert.deepEqual(await result, {
    valid: true,
    consentCount: 1,
    contributionApprovalCount: 1,
    contributionCount: 1,
    privateCaptureCount: 1,
    trustCaseCount: 1,
    trustCaseEventCount: 1,
  });
  assert.equal(input.destroyed, true);
});

test("oversized streaming input stops consumption and destroys the stream", async () => {
  let emitted = 0;
  const input = new Readable({
    read() {
      emitted += 1;
      this.push(Buffer.alloc(65_536, 0x20));
    },
  });
  assert.deepEqual(await readCandidateRightsExportEnvelope(input), rejected);
  assert.equal(input.destroyed, true);
  assert.ok(emitted < 30);
});

test("premature stream closure cannot accept even a complete JSON prefix", async () => {
  const input = new PassThrough();
  const result = readCandidateRightsExportEnvelope(input);
  input.write(bytes(envelope()));
  input.destroy();
  assert.deepEqual(await result, rejected);
});

test("stream errors, strings and nonstreams return only fixed refusal", async () => {
  const input = new PassThrough();
  const result = readCandidateRightsExportEnvelope(input);
  input.destroy(new Error(sentinel));
  assert.deepEqual(await result, rejected);
  assert.deepEqual(await readCandidateRightsExportEnvelope(Readable.from([sentinel])), rejected);
  assert.deepEqual(await readCandidateRightsExportEnvelope(null), rejected);
});

test("stalled stdin has a fixed total deadline, not a per-chunk renewal", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const input = new PassThrough();
  const result = readCandidateRightsExportEnvelope(input);
  input.write(Buffer.from("{"));
  context.mock.timers.tick(EXPORT_INPUT_TIMEOUT_MILLISECONDS - 1);
  input.write(Buffer.from(" "));
  context.mock.timers.tick(1);
  assert.deepEqual(await result, rejected);
  assert.equal(input.destroyed, true);
});

test("normal CLI is stdin-only, private and bounded on both acceptance and refusal", () => {
  assert.deepEqual(cli(bytes(envelope())), { status: 0, output: emptyCounts });
  assert.deepEqual(cli(Buffer.from(`{"${sentinel}":`)), { status: 1, output: rejected });
  assert.deepEqual(cli(undefined), { status: 1, output: rejected });
  for (const args of [
    [sentinel],
    ["--check-ready", "--check-ready"],
    ["--check-ready", sentinel],
    ["--artifact", sentinel],
  ]) {
    assert.deepEqual(cli(undefined, args), { status: 1, output: rejected });
  }
});

function d3Fixture() {
  const artifact = fixture();
  artifact.policyVersion = "d3-development-synthetic-v1";
  artifact.applications = {
    schemaVersion: 1,
    applications: [],
    packets: [],
    approvals: [],
    attempts: [],
    history: [],
  };
  return artifact;
}

test("D3 export requires Applications and returns bounded technical counts", () => {
  const artifact = d3Fixture();
  artifact.applications.applications.push({
    id: exportId,
    canonicalJobId: contributionId,
    status: "cancelled",
    revision: 1,
    createdAt: at,
    updatedAt: at,
  });
  const binding = { expectedExportId: exportId, expectedPolicyVersion: artifact.policyVersion };
  assert.deepEqual(validateCandidateRightsExport(bytes(artifact), binding), {
    ...emptyCounts,
    applicationCount: 1,
    packetCount: 0,
    approvalCount: 0,
    attemptCount: 0,
    historyCount: 0,
  });
  delete artifact.applications;
  assert.deepEqual(validateCandidateRightsExport(bytes(artifact), binding), rejected);
});

for (const section of ["applications", "packets", "approvals", "attempts", "history"]) {
  test(`D3 export rejects omitted ${section} coverage`, () => {
    const artifact = d3Fixture();
    delete artifact.applications[section];
    assert.deepEqual(
      validateCandidateRightsExport(bytes(artifact), {
        expectedExportId: exportId,
        expectedPolicyVersion: artifact.policyVersion,
      }),
      rejected,
    );
  });
}

test("D3 export retains closed Applications schema and D2 owner coverage", () => {
  const artifact = d3Fixture();
  const binding = { expectedExportId: exportId, expectedPolicyVersion: artifact.policyVersion };
  artifact.applications.privateValue = sentinel;
  assert.deepEqual(validateCandidateRightsExport(bytes(artifact), binding), rejected);
  delete artifact.applications.privateValue;
  delete artifact.trust;
  assert.deepEqual(validateCandidateRightsExport(bytes(artifact), binding), rejected);
});

test("D3 restricted-answer validation preserves exact independent value checks", () => {
  const { artifact, binding } = restrictedFixture();
  artifact.policyVersion = binding.expectedPolicyVersion = "d3-development-synthetic-v1";
  artifact.applications = d3Fixture().applications;
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), restrictedCounts);
  artifact.profile.restrictedAnswers[0].value = sentinel;
  assert.deepEqual(validateRestrictedAnswerExport(bytes(artifact), binding), rejected);
});

function d4Fixture() {
  const artifact = d3Fixture();
  artifact.policyVersion = "d4-development-synthetic-v1";
  artifact.notifications = {
    preferences: null,
    inbox: [],
    emailDestination: null,
    pushSubscriptions: [],
    deliveries: [],
  };
  return artifact;
}

test("D4 export requires Notifications and returns bounded technical counts", () => {
  const artifact = d4Fixture();
  artifact.notifications.preferences = {
    version: 1,
    inAppEnabled: true,
    emailEnabled: false,
    pushEnabled: false,
    quietHours: { enabled: false, startMinute: 1320, endMinute: 420, timeZone: "UTC" },
    updatedAt: at,
  };
  artifact.notifications.pushSubscriptions.push({
    id: exportId,
    endpointHost: "fcm.googleapis.com",
    state: "active",
    createdAt: at,
    lastSuccessAt: null,
  });
  const binding = { expectedExportId: exportId, expectedPolicyVersion: artifact.policyVersion };
  assert.deepEqual(validateCandidateRightsExport(bytes(artifact), binding), {
    ...emptyCounts,
    applicationCount: 0,
    packetCount: 0,
    approvalCount: 0,
    attemptCount: 0,
    historyCount: 0,
    notificationsPreferencesCount: 1,
    notificationsEmailDestinationCount: 0,
    notificationsPushSubscriptionCount: 1,
    notificationsInboxCount: 0,
    notificationsDeliveryCount: 0,
  });
  delete artifact.notifications;
  assert.deepEqual(validateCandidateRightsExport(bytes(artifact), binding), rejected);
});

test("D4 export keeps the D3 Applications requirement and the closed Notifications schema", () => {
  const binding = {
    expectedExportId: exportId,
    expectedPolicyVersion: "d4-development-synthetic-v1",
  };
  const withoutApplications = d4Fixture();
  delete withoutApplications.applications;
  assert.deepEqual(validateCandidateRightsExport(bytes(withoutApplications), binding), rejected);
  const leaking = d4Fixture();
  leaking.notifications.pushSubscriptions.push({
    id: exportId,
    endpointHost: "fcm.googleapis.com",
    endpoint: `https://fcm.googleapis.com/fcm/send/${sentinel}`,
    state: "active",
    createdAt: at,
    lastSuccessAt: null,
  });
  assert.deepEqual(validateCandidateRightsExport(bytes(leaking), binding), rejected);
  const extra = d4Fixture();
  extra.notifications.ownerUserId = sentinel;
  assert.deepEqual(validateCandidateRightsExport(bytes(extra), binding), rejected);
});

test("a D3 export does not grow Notifications counts", () => {
  const artifact = d3Fixture();
  const result = validateCandidateRightsExport(bytes(artifact), {
    expectedExportId: exportId,
    expectedPolicyVersion: artifact.policyVersion,
  });
  assert.equal(Object.hasOwn(result, "notificationsPreferencesCount"), false);
});
