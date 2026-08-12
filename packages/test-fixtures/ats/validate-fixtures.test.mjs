import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateTree } from "./validate-fixtures.mjs";

const atsDirectory = path.dirname(fileURLToPath(import.meta.url));
const temporaryDirectories = [];

function copySyntheticFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ats-fixture-test-"));
  temporaryDirectories.push(root);
  cpSync(path.join(atsDirectory, "synthetic"), path.join(root, "synthetic"), { recursive: true });
  return root;
}

function loadMetadata(root) {
  const metadataPath = path.join(root, "synthetic", "metadata.json");
  return { metadataPath, metadata: JSON.parse(readFileSync(metadataPath, "utf8")) };
}

function writeMetadata(metadataPath, metadata) {
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function setPayload(root, content) {
  const payloadPath = path.join(root, "synthetic", "application-form.html");
  writeFileSync(payloadPath, content, "utf8");
  const { metadataPath, metadata } = loadMetadata(root);
  const bytes = Buffer.byteLength(content);
  metadata.integrity.files[0].bytes = bytes;
  metadata.integrity.files[0].digest = createHash("sha256").update(content).digest("hex");
  writeMetadata(metadataPath, metadata);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts the repository synthetic fixture without a representative claim", () => {
  assert.deepEqual(validateTree(atsDirectory), ["synthetic-foundation-v1"]);
});

test("rejects a payload whose declared checksum does not match", () => {
  const root = copySyntheticFixture();
  const { metadataPath, metadata } = loadMetadata(root);
  metadata.integrity.files[0].digest = "0".repeat(64);
  writeMetadata(metadataPath, metadata);
  assert.throws(() => validateTree(root), /SHA-256 digest does not match/);
});

test("rejects synthetic material presented as representative provider evidence", () => {
  const root = copySyntheticFixture();
  const { metadataPath, metadata } = loadMetadata(root);
  metadata.representativeness = {
    claim: true,
    state: "accepted",
    reviewerId: "reviewer-example",
    reviewedOn: "2026-08-11",
    evidenceId: "representative-example",
  };
  writeMetadata(metadataPath, metadata);
  assert.throws(() => validateTree(root), /cannot claim representative provider evidence/);
});

test("rejects active HTML even when its integrity record is current", () => {
  const root = copySyntheticFixture();
  setPayload(root, "<!doctype html><form><script>alert('unsafe')</script></form>\n"); // nosemgrep: semgrep-rules.javascript.lang.security.audit.unknown-value-with-script-tag -- deliberate inert attack string proving rejection
  assert.throws(() => validateTree(root), /contains active, hidden, authentication, or network/);
});

test("rejects an unmanifested payload", () => {
  const root = copySyntheticFixture();
  writeFileSync(path.join(root, "synthetic", "unreviewed.html"), "<p>Example</p>\n", "utf8");
  assert.throws(() => validateTree(root), /every fixture payload must be listed exactly once/);
});

test("rejects a payload outside a manifested fixture", () => {
  const root = copySyntheticFixture();
  mkdirSync(path.join(root, "orphan"));
  writeFileSync(path.join(root, "orphan", "page.html"), "<p>Example</p>\n", "utf8");
  assert.throws(() => validateTree(root), /is not inside a manifested fixture/);
});

test("requires provider fixtures to record secret and PII scanner evidence", () => {
  const root = copySyntheticFixture();
  const { metadataPath, metadata } = loadMetadata(root);
  metadata.evidenceClass = "sanitized_authorized_provider";
  metadata.provider = { family: "example-provider", variant: "controlled-test" };
  metadata.source = {
    kind: "controlled_test_tenant",
    capturedOn: "2026-08-01",
    authorizationEvidenceId: "authorization-example",
    authorizationExpiresOn: null,
    authorizationRevalidateOn: "2027-08-01",
  };
  metadata.sanitization.status = "complete";
  metadata.sanitization.humanReview = {
    state: "approved_sanitized",
    reviewerId: "reviewer-sanitization-example",
    reviewedOn: "2026-08-11",
    evidenceId: "sanitization-review-example",
  };
  metadata.retention = {
    rawCaptureCreated: true,
    rawCaptureDisposition: "destroyed",
    rawCaptureEvidenceId: "destruction-example",
    rawDeletionDueOn: null,
    sanitizedFixturePolicy: "retain_until_authorization_expires",
  };
  metadata.representativeness = {
    claim: true,
    state: "accepted",
    reviewerId: "reviewer-example",
    reviewedOn: "2026-08-11",
    evidenceId: "representative-example",
  };
  metadata.reviewState = "approved_sanitized_provider";
  writeMetadata(metadataPath, metadata);
  assert.throws(() => validateTree(root), /missing secret checks/);
});

test("accepts a fully evidenced provider-derived fixture contract", () => {
  const root = copySyntheticFixture();
  const { metadataPath, metadata } = loadMetadata(root);
  metadata.fixtureId = "example-provider-controlled-form-v1";
  metadata.evidenceClass = "sanitized_authorized_provider";
  metadata.provider = { family: "example-provider", variant: "controlled-test" };
  metadata.source = {
    kind: "controlled_test_tenant",
    capturedOn: "2026-08-01",
    authorizationEvidenceId: "authorization-example",
    authorizationExpiresOn: null,
    authorizationRevalidateOn: "2027-08-01",
  };
  metadata.sanitization.status = "complete";
  metadata.sanitization.automatedChecks.push(
    {
      category: "secret",
      tool: "approved-secret-scanner",
      toolVersion: "1",
      runOn: "2026-08-11",
      result: "passed",
      evidenceId: "secret-scan-example",
    },
    {
      category: "pii",
      tool: "approved-pii-scanner",
      toolVersion: "1",
      runOn: "2026-08-11",
      result: "passed",
      evidenceId: "pii-scan-example",
    },
  );
  metadata.sanitization.humanReview = {
    state: "approved_sanitized",
    reviewerId: "reviewer-sanitization-example",
    reviewedOn: "2026-08-11",
    evidenceId: "sanitization-review-example",
  };
  metadata.retention = {
    rawCaptureCreated: true,
    rawCaptureDisposition: "destroyed",
    rawCaptureEvidenceId: "destruction-example",
    rawDeletionDueOn: null,
    sanitizedFixturePolicy: "retain_until_authorization_expires",
  };
  metadata.representativeness = {
    claim: true,
    state: "accepted",
    reviewerId: "reviewer-representative-example",
    reviewedOn: "2026-08-11",
    evidenceId: "representative-review-example",
  };
  metadata.reviewState = "approved_sanitized_provider";
  writeMetadata(metadataPath, metadata);
  assert.deepEqual(validateTree(root, { today: new Date("2026-08-11T00:00:00.000Z") }), [
    "example-provider-controlled-form-v1",
  ]);
});

test("rejects provider evidence after authorization revalidation becomes overdue", () => {
  const root = copySyntheticFixture();
  const { metadataPath, metadata } = loadMetadata(root);
  metadata.evidenceClass = "sanitized_authorized_provider";
  metadata.provider = { family: "example-provider", variant: "controlled-test" };
  metadata.source = {
    kind: "controlled_test_tenant",
    capturedOn: "2026-08-01",
    authorizationEvidenceId: "authorization-example",
    authorizationExpiresOn: null,
    authorizationRevalidateOn: "2026-08-10",
  };
  writeMetadata(metadataPath, metadata);
  assert.throws(
    () => validateTree(root, { today: new Date("2026-08-11T00:00:00.000Z") }),
    /source authorization revalidation is overdue/,
  );
});

test("rejects provider evidence after its source authorization expires", () => {
  const root = copySyntheticFixture();
  const { metadataPath, metadata } = loadMetadata(root);
  metadata.evidenceClass = "sanitized_authorized_provider";
  metadata.provider = { family: "example-provider", variant: "controlled-test" };
  metadata.source = {
    kind: "controlled_test_tenant",
    capturedOn: "2026-08-01",
    authorizationEvidenceId: "authorization-example",
    authorizationExpiresOn: "2026-08-10",
    authorizationRevalidateOn: "2027-08-01",
  };
  writeMetadata(metadataPath, metadata);
  assert.throws(
    () => validateTree(root, { today: new Date("2026-08-11T00:00:00.000Z") }),
    /source authorization has expired/,
  );
});

test("rejects malformed fixture and provider slugs without regex backtracking", () => {
  const fixtureRoot = copySyntheticFixture();
  const fixtureManifest = loadMetadata(fixtureRoot);
  fixtureManifest.metadata.fixtureId = `fixture-${"segment-".repeat(5000)}v0`;
  writeMetadata(fixtureManifest.metadataPath, fixtureManifest.metadata);
  assert.throws(() => validateTree(fixtureRoot), /fixtureId must be a versioned lowercase slug/);

  const providerRoot = copySyntheticFixture();
  const providerManifest = loadMetadata(providerRoot);
  providerManifest.metadata.provider.variant = "synthetic--variant";
  writeMetadata(providerManifest.metadataPath, providerManifest.metadata);
  assert.throws(
    () => validateTree(providerRoot),
    /provider family and variant must be lowercase slugs/,
  );
});
