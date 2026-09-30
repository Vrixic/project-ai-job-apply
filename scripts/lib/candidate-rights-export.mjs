#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const MAXIMUM_EXPORT_BYTES = 1_048_576;
export const MAXIMUM_EXPORT_ENVELOPE_BYTES = 4 * Math.ceil(MAXIMUM_EXPORT_BYTES / 3) + 1_024;
export const EXPORT_INPUT_TIMEOUT_MILLISECONDS = 10_000;
export const MAXIMUM_RESTRICTED_EXPECTATION_BYTES = 65_536;
export const MAXIMUM_RESTRICTED_EXPORT_ENVELOPE_BYTES =
  MAXIMUM_EXPORT_ENVELOPE_BYTES + MAXIMUM_RESTRICTED_EXPECTATION_BYTES;

const REJECTED = Object.freeze({ valid: false, error: "CandidateRightsExportRejected" });
const READY = Object.freeze({ ready: true });
const D2_POLICY_VERSION = "d2-development-synthetic-v1";
const MAXIMUM_JSON_DEPTH = 32;
let validateExport;

function reject() {
  throw new Error("CandidateRightsExportRejected");
}

function currentValidator() {
  if (!validateExport) {
    // Use the same source schema, domain-owned dependencies and strict format configuration as
    // packages/domain/src/candidate-data-export.ts. Never accept a stale dist validator or a
    // caller-supplied schema, and never expose Ajv's input-bearing error details.
    const domainRequire = createRequire(
      new URL("../../packages/domain/package.json", import.meta.url),
    );
    const { Ajv2020 } = domainRequire("ajv/dist/2020.js");
    const addFormats = domainRequire("ajv-formats");
    const schema = JSON.parse(
      readFileSync(
        new URL(
          "../../packages/domain/schemas/v1/candidate-data-export.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    validateExport = ajv.compile(schema);
  }
  return validateExport;
}

/** Call before an acceptance operator creates anything; this performs no network or artifact I/O. */
export function checkCandidateRightsExportReady() {
  try {
    currentValidator();
    return READY;
  } catch {
    return REJECTED;
  }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function parseStrictJson(bytes, maximumBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    reject();
  }
  // Preserve a BOM so JSON.parse rejects it; fatal decoding rejects invalid/truncated UTF-8.
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const parsed = JSON.parse(source);
  // JSON.parse checks syntax, but silently accepts duplicate keys. Walk the already-valid text
  // separately, comparing decoded property names at every depth, including escaped aliases.
  let offset = 0;
  function whitespace() {
    while (/[\t\n\r ]/u.test(source[offset] ?? "")) offset += 1;
  }
  function string(key = false) {
    const start = offset++;
    while (source[offset] !== '"') {
      offset += source[offset] === "\\" ? 2 : 1;
    }
    offset += 1;
    return key ? JSON.parse(source.slice(start, offset)) : undefined;
  }
  function value(depth) {
    if (depth > MAXIMUM_JSON_DEPTH) reject();
    whitespace();
    const token = source[offset];
    if (token === "{") {
      offset += 1;
      whitespace();
      const keys = new Set();
      if (source[offset] !== "}") {
        while (true) {
          const key = string(true);
          if (keys.has(key)) reject();
          keys.add(key);
          whitespace();
          offset += 1; // Colon; syntax was already checked by JSON.parse.
          value(depth + 1);
          whitespace();
          if (source[offset] !== ",") break;
          offset += 1;
          whitespace();
        }
      }
      offset += 1;
    } else if (token === "[") {
      offset += 1;
      whitespace();
      if (source[offset] !== "]") {
        while (true) {
          value(depth + 1);
          whitespace();
          if (source[offset] !== ",") break;
          offset += 1;
        }
      }
      offset += 1;
    } else if (token === '"') {
      string();
    } else {
      while (offset < source.length && !/[\t\n\r ,}\]]/u.test(source[offset])) offset += 1;
    }
  }
  value(0);
  whitespace();
  if (offset !== source.length) reject();
  return parsed;
}

/** Pure artifact acceptance. Returned values contain counters only, never exported data or IDs. */
export function validateCandidateRightsExport(artifactBytes, expected) {
  try {
    if (
      !exactKeys(expected, ["expectedExportId", "expectedPolicyVersion"]) ||
      typeof expected.expectedExportId !== "string" ||
      typeof expected.expectedPolicyVersion !== "string"
    ) {
      reject();
    }
    const artifact = parseStrictJson(artifactBytes, MAXIMUM_EXPORT_BYTES);
    if (
      !currentValidator()(artifact) ||
      artifact.exportId !== expected.expectedExportId ||
      artifact.policyVersion !== expected.expectedPolicyVersion
    ) {
      reject();
    }
    if (
      expected.expectedPolicyVersion === D2_POLICY_VERSION &&
      (!Object.hasOwn(artifact.profile, "contributionConsents") ||
        !Object.hasOwn(artifact.jobs, "contributions") ||
        !Object.hasOwn(artifact.matching, "privateSavedPageCaptures") ||
        !Object.hasOwn(artifact, "trust"))
    ) {
      reject();
    }
    const contributions = artifact.jobs.contributions ?? [];
    return Object.freeze({
      valid: true,
      consentCount: artifact.profile.contributionConsents?.length ?? 0,
      // Every schema-valid contribution has one approval. This is not a separate permission grant.
      contributionApprovalCount: contributions.length,
      contributionCount: contributions.length,
      privateCaptureCount: artifact.matching.privateSavedPageCaptures?.length ?? 0,
      trustCaseCount: artifact.trust?.cases.length ?? 0,
      trustCaseEventCount: artifact.trust?.caseEvents.length ?? 0,
    });
  } catch {
    return REJECTED;
  }
}

/** Closed stdin transport; base64 must be canonical, padded and bounded before decoding. */
export function validateCandidateRightsExportEnvelope(bytes) {
  try {
    const envelope = parseStrictJson(bytes, MAXIMUM_EXPORT_ENVELOPE_BYTES);
    if (
      !exactKeys(envelope, [
        "schemaVersion",
        "expectedExportId",
        "expectedPolicyVersion",
        "artifactBase64",
      ]) ||
      envelope.schemaVersion !== 1 ||
      typeof envelope.artifactBase64 !== "string" ||
      envelope.artifactBase64.length === 0 ||
      envelope.artifactBase64.length > 4 * Math.ceil(MAXIMUM_EXPORT_BYTES / 3) ||
      envelope.artifactBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(envelope.artifactBase64)
    ) {
      reject();
    }
    const artifact = Buffer.from(envelope.artifactBase64, "base64");
    if (artifact.toString("base64") !== envelope.artifactBase64) reject();
    return validateCandidateRightsExport(artifact, {
      expectedExportId: envelope.expectedExportId,
      expectedPolicyVersion: envelope.expectedPolicyVersion,
    });
  } catch {
    return REJECTED;
  }
}

/** Complete bounded stdin bytes only; early close/error/timeout never validates a partial body. */
async function readBoundedExportEnvelope(input, maximumBytes, validator) {
  if (!(input instanceof Readable)) return REJECTED;
  let timer;
  try {
    const read = async () => {
      const chunks = [];
      let total = 0;
      for await (const chunk of input) {
        if (!(chunk instanceof Uint8Array)) reject();
        total += chunk.byteLength;
        if (total > maximumBytes) reject();
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, total);
    };
    const timeout = new Promise((_resolve, rejectTimeout) => {
      timer = setTimeout(
        () => rejectTimeout(new Error("CandidateRightsExportRejected")),
        EXPORT_INPUT_TIMEOUT_MILLISECONDS,
      );
    });
    return validator(await Promise.race([read(), timeout]));
  } catch {
    return REJECTED;
  } finally {
    clearTimeout(timer);
    // Stream teardown must not reflect a private exception or hide the fixed validation result.
    try {
      input.destroy();
    } catch {}
  }
}

export function readCandidateRightsExportEnvelope(input) {
  return readBoundedExportEnvelope(
    input,
    MAXIMUM_EXPORT_ENVELOPE_BYTES,
    validateCandidateRightsExportEnvelope,
  );
}

/** Read-only synthetic acceptance against an independently prepared latest-version snapshot.
 * This does not prove live identity isolation, KMS access, deletion, or policy approval.
 */
export function validateRestrictedAnswerExport(artifactBytes, expected) {
  try {
    if (
      !exactKeys(expected, [
        "expectedExportId",
        "expectedPolicyVersion",
        "expectedRestrictedAnswers",
      ]) ||
      expected.expectedPolicyVersion !== D2_POLICY_VERSION ||
      !Array.isArray(expected.expectedRestrictedAnswers) ||
      expected.expectedRestrictedAnswers.length < 3 ||
      expected.expectedRestrictedAnswers.length > 100 ||
      Buffer.byteLength(JSON.stringify(expected.expectedRestrictedAnswers), "utf8") >
        MAXIMUM_RESTRICTED_EXPECTATION_BYTES ||
      !validateCandidateRightsExport(artifactBytes, {
        expectedExportId: expected.expectedExportId,
        expectedPolicyVersion: expected.expectedPolicyVersion,
      }).valid
    )
      reject();
    const artifact = parseStrictJson(artifactBytes, MAXIMUM_EXPORT_BYTES);
    const entries = artifact.profile.restrictedAnswers;
    const snapshot = expected.expectedRestrictedAnswers;
    if (
      !Array.isArray(entries) ||
      entries.length !== snapshot.length ||
      !currentValidator()({
        ...artifact,
        profile: { ...artifact.profile, restrictedAnswers: snapshot },
      })
    )
      reject();
    // Reuse the source schema's closed value-field inventory; metadata-only legacy fields are
    // compatible ordinary exports but cannot supply this deliberately narrower acceptance proof.
    const fields =
      currentValidator().schema.$defs.restrictedAnswerMetadata.allOf[1].then.properties.fieldKey
        .enum;
    const ids = new Set();
    const references = new Set();
    let activeValueCount = 0;
    let expiredValueCount = 0;
    let deletedTombstoneCount = 0;
    let revisedValueCount = 0;
    for (const entry of snapshot) {
      const reference = JSON.stringify([entry.fieldKey, entry.context ?? null]);
      if (!fields.includes(entry.fieldKey) || ids.has(entry.id) || references.has(reference))
        reject();
      if (
        Date.parse(entry.createdAt) > Date.parse(entry.confirmedAt) ||
        Date.parse(entry.confirmedAt) > Date.parse(artifact.generatedAt) ||
        (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.parse(entry.confirmedAt))
      )
        reject();
      ids.add(entry.id);
      references.add(reference);
      if (entry.state === "deleted") {
        deletedTombstoneCount += 1;
      } else {
        if (!Object.hasOwn(entry, "value")) reject();
        if (entry.version > 1) revisedValueCount += 1;
        if (entry.expiresAt && Date.parse(entry.expiresAt) <= Date.parse(artifact.generatedAt)) {
          expiredValueCount += 1;
        } else activeValueCount += 1;
      }
    }
    if (!activeValueCount || !expiredValueCount || !deletedTombstoneCount || !revisedValueCount)
      reject();
    const actualIds = new Set();
    for (const entry of entries) {
      if (
        actualIds.has(entry.id) ||
        !isDeepStrictEqual(
          entry,
          snapshot.find((item) => item.id === entry.id),
        )
      )
        reject();
      actualIds.add(entry.id);
    }
    return Object.freeze({
      valid: true,
      activeValueCount,
      expiredValueCount,
      deletedTombstoneCount,
      revisedValueCount,
    });
  } catch {
    return REJECTED;
  }
}

export function validateRestrictedAnswerExportEnvelope(bytes) {
  let artifact;
  try {
    const envelope = parseStrictJson(bytes, MAXIMUM_RESTRICTED_EXPORT_ENVELOPE_BYTES);
    if (
      !exactKeys(envelope, [
        "schemaVersion",
        "expectedExportId",
        "expectedPolicyVersion",
        "expectedRestrictedAnswers",
        "artifactBase64",
      ]) ||
      envelope.schemaVersion !== 1 ||
      typeof envelope.artifactBase64 !== "string" ||
      envelope.artifactBase64.length === 0 ||
      envelope.artifactBase64.length > 4 * Math.ceil(MAXIMUM_EXPORT_BYTES / 3) ||
      envelope.artifactBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/u.test(envelope.artifactBase64)
    )
      reject();
    artifact = Buffer.from(envelope.artifactBase64, "base64");
    if (artifact.toString("base64") !== envelope.artifactBase64) reject();
    return validateRestrictedAnswerExport(artifact, {
      expectedExportId: envelope.expectedExportId,
      expectedPolicyVersion: envelope.expectedPolicyVersion,
      expectedRestrictedAnswers: envelope.expectedRestrictedAnswers,
    });
  } catch {
    return REJECTED;
  } finally {
    artifact?.fill(0);
  }
}

export function readRestrictedAnswerExportEnvelope(input) {
  return readBoundedExportEnvelope(
    input,
    MAXIMUM_RESTRICTED_EXPORT_ENVELOPE_BYTES,
    validateRestrictedAnswerExportEnvelope,
  );
}

async function main() {
  let result = REJECTED;
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--check-ready") {
      result = checkCandidateRightsExportReady();
    } else if (
      args.length === 1 &&
      args[0] === "--restricted-answer-acceptance" &&
      process.stdin.isTTY !== true
    ) {
      if (checkCandidateRightsExportReady() !== READY) reject();
      result = await readRestrictedAnswerExportEnvelope(process.stdin);
    } else if (args.length === 0 && process.stdin.isTTY !== true) {
      if (checkCandidateRightsExportReady() !== READY) reject();
      result = await readCandidateRightsExportEnvelope(process.stdin);
    }
  } catch {
    result = REJECTED;
  }
  process.exitCode = result === REJECTED ? 1 : 0;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on("error", () => {
    process.exitCode = 1;
    process.stdin.destroy();
  });
  await main();
}
