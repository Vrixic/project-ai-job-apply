import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const ignoredDirectoryNames = new Set(["templates", "schema"]);
const allowedPayloadExtensions = new Set([".html", ".json", ".txt"]);
const safeOpaqueId = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function fail(fixture, message) {
  throw new Error(`${fixture}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLowercaseSlug(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("-") ||
    value.endsWith("-")
  ) {
    return false;
  }
  let previousWasSeparator = false;
  for (const character of value) {
    if (character === "-") {
      if (previousWasSeparator) return false;
      previousWasSeparator = true;
      continue;
    }
    const code = character.charCodeAt(0);
    if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57))) return false;
    previousWasSeparator = false;
  }
  return true;
}

function isPositiveIntegerText(value) {
  if (value.length === 0 || value[0] === "0") return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function isVersionedFixtureId(value) {
  if (typeof value !== "string") return false;
  const marker = value.lastIndexOf("-v");
  return (
    marker > 0 &&
    isLowercaseSlug(value.slice(0, marker)) &&
    isPositiveIntegerText(value.slice(marker + 2))
  );
}

function assertExactKeys(fixture, label, value, requiredKeys) {
  if (!isObject(value)) fail(fixture, `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...requiredKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(fixture, `${label} keys must be exactly: ${expected.join(", ")}`);
  }
}

function assertDate(fixture, label, value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(fixture, `${label} must be an ISO calendar date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(fixture, `${label} must be a valid ISO calendar date`);
  }
}

function assertOpaqueId(fixture, label, value) {
  if (typeof value !== "string" || !safeOpaqueId.test(value)) {
    fail(fixture, `${label} must be a lowercase opaque ID without a URL, path, email, or name`);
  }
}

function enumerateFiles(directory) {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path.relative(directory, entryPath).split(path.sep).join("/");
    if (entry.isSymbolicLink()) fail(relativePath, "symbolic links are prohibited");
    if (entry.isDirectory()) {
      for (const nested of enumerateFiles(entryPath)) {
        entries.push(`${entry.name}/${nested}`);
      }
    } else if (entry.isFile()) {
      entries.push(relativePath);
    }
  }
  return entries.sort();
}

function findMetadata(root, current = root) {
  const matches = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail(path.relative(root, current), "symbolic links are prohibited");
    if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) continue;
    const directory = path.join(current, entry.name);
    const files = readdirSync(directory, { withFileTypes: true });
    if (files.some((child) => child.isFile() && child.name === "metadata.json")) {
      matches.push(path.join(directory, "metadata.json"));
      if (findMetadata(root, directory).length > 0) {
        fail(path.relative(root, directory), "nested fixture manifests are prohibited");
      }
    } else {
      matches.push(...findMetadata(root, directory));
    }
  }
  return matches.sort();
}

function findRepositoryFiles(root, current = root) {
  const matches = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isSymbolicLink())
      fail(path.relative(root, entryPath), "symbolic links are prohibited");
    if (entry.isDirectory()) {
      matches.push(...findRepositoryFiles(root, entryPath));
    } else if (entry.isFile()) {
      matches.push(entryPath);
    }
  }
  return matches;
}

// Lexical preflight for an already-sanitized working copy. This grants no fixture approval:
// validateFixture/validateTree still require the complete manifest and independent reviews.
export function assertPayloadSafety(fixture, relativePath, content) {
  const lower = content.toLowerCase();
  const forbiddenSecrets = [
    /-----begin (?:rsa |ec |openssh )?private key-----/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /(?:client[_-]?secret|api[_-]?key|password)\s*[:=]\s*["']?[^\s"']{8,}/i,
  ];
  if (forbiddenSecrets.some((pattern) => pattern.test(content))) {
    fail(fixture, `${relativePath} contains credential- or token-shaped content`);
  }

  const emails = content.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi);
  for (const match of emails) {
    const domain = match[1].toLowerCase();
    if (
      !domain.endsWith(".example") &&
      !domain.endsWith(".invalid") &&
      !domain.endsWith(".test") &&
      domain !== "example.com"
    ) {
      fail(fixture, `${relativePath} contains a non-reserved email address`);
    }
  }

  if (path.extname(relativePath).toLowerCase() !== ".html") return;

  const forbiddenHtml = [
    /<\s*(?:script|iframe|object|embed|base)\b/i,
    /<\s*meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,
    /<\s*input\b[^>]*type\s*=\s*["']?(?:hidden|password)\b/i,
    /\son[a-z]+\s*=/i,
    /\b(?:src|href)\s*=\s*["']\s*(?:javascript:|data:text\/html)/i,
    /<\s*form\b[^>]*\baction\s*=/i,
    /<\s*(?:img|link|audio|video|source)\b[^>]*\b(?:src|href)\s*=\s*["']?https?:/i,
  ];
  if (forbiddenHtml.some((pattern) => pattern.test(lower))) {
    fail(fixture, `${relativePath} contains active, hidden, authentication, or network content`);
  }
}

function validateCommon(fixture, metadata) {
  assertExactKeys(fixture, "metadata", metadata, [
    "schemaVersion",
    "fixtureId",
    "evidenceClass",
    "provider",
    "source",
    "dataSafety",
    "sanitization",
    "retention",
    "representativeness",
    "behaviorTags",
    "integrity",
    "reviewState",
  ]);
  if (metadata.schemaVersion !== "ats-fixture-metadata.v1") {
    fail(fixture, "schemaVersion must be ats-fixture-metadata.v1");
  }
  if (!isVersionedFixtureId(metadata.fixtureId)) {
    fail(fixture, "fixtureId must be a versioned lowercase slug");
  }
  if (!["synthetic", "sanitized_authorized_provider"].includes(metadata.evidenceClass)) {
    fail(fixture, "evidenceClass is unsupported");
  }

  assertExactKeys(fixture, "provider", metadata.provider, ["family", "variant"]);
  if (!isLowercaseSlug(metadata.provider.family) || !isLowercaseSlug(metadata.provider.variant)) {
    fail(fixture, "provider family and variant must be lowercase slugs");
  }

  assertExactKeys(fixture, "source", metadata.source, [
    "kind",
    "capturedOn",
    "authorizationEvidenceId",
    "authorizationExpiresOn",
    "authorizationRevalidateOn",
  ]);
  const sourceKinds = [
    "created_for_testing",
    "public_permitted_example",
    "controlled_test_tenant",
    "user_provided_with_consent",
  ];
  if (!sourceKinds.includes(metadata.source.kind)) fail(fixture, "source.kind is unsupported");

  assertExactKeys(fixture, "dataSafety", metadata.dataSafety, [
    "containsProductionData",
    "containsCandidateData",
    "containsAuthenticationMaterial",
    "containsActiveContent",
  ]);
  if (Object.values(metadata.dataSafety).some((value) => value !== false)) {
    fail(fixture, "every dataSafety flag must be false");
  }

  assertExactKeys(fixture, "sanitization", metadata.sanitization, [
    "status",
    "policyVersion",
    "automatedChecks",
    "humanReview",
  ]);
  if (metadata.sanitization.policyVersion !== "ats-fixture-policy-2026-08-11") {
    fail(fixture, "the current fixture policy version is required");
  }
  if (!Array.isArray(metadata.sanitization.automatedChecks)) {
    fail(fixture, "sanitization.automatedChecks must be an array");
  }
  for (const [index, check] of metadata.sanitization.automatedChecks.entries()) {
    assertExactKeys(fixture, `automatedChecks[${index}]`, check, [
      "category",
      "tool",
      "toolVersion",
      "runOn",
      "result",
      "evidenceId",
    ]);
    if (!["repository", "secret", "pii"].includes(check.category) || check.result !== "passed") {
      fail(fixture, `automatedChecks[${index}] has an unsupported category or result`);
    }
    if (typeof check.tool !== "string" || check.tool.length === 0) {
      fail(fixture, `automatedChecks[${index}].tool is required`);
    }
    if (!isLowercaseSlug(check.tool)) {
      fail(fixture, `automatedChecks[${index}].tool must be a lowercase slug`);
    }
    if (
      typeof check.toolVersion !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(check.toolVersion)
    ) {
      fail(fixture, `automatedChecks[${index}].toolVersion is required`);
    }
    assertDate(fixture, `automatedChecks[${index}].runOn`, check.runOn);
    assertOpaqueId(fixture, `automatedChecks[${index}].evidenceId`, check.evidenceId);
  }
  assertExactKeys(fixture, "sanitization.humanReview", metadata.sanitization.humanReview, [
    "state",
    "reviewerId",
    "reviewedOn",
    "evidenceId",
  ]);

  assertExactKeys(fixture, "retention", metadata.retention, [
    "rawCaptureCreated",
    "rawCaptureDisposition",
    "rawCaptureEvidenceId",
    "rawDeletionDueOn",
    "sanitizedFixturePolicy",
  ]);
  assertExactKeys(fixture, "representativeness", metadata.representativeness, [
    "claim",
    "state",
    "reviewerId",
    "reviewedOn",
    "evidenceId",
  ]);

  if (
    !Array.isArray(metadata.behaviorTags) ||
    metadata.behaviorTags.length === 0 ||
    metadata.behaviorTags.some((tag) => !isLowercaseSlug(tag)) ||
    new Set(metadata.behaviorTags).size !== metadata.behaviorTags.length
  ) {
    fail(fixture, "behaviorTags must contain unique lowercase slugs");
  }

  assertExactKeys(fixture, "integrity", metadata.integrity, ["algorithm", "files"]);
  if (metadata.integrity.algorithm !== "sha256" || !Array.isArray(metadata.integrity.files)) {
    fail(fixture, "integrity must contain a SHA-256 file list");
  }
  if (metadata.integrity.files.length === 0) fail(fixture, "at least one payload is required");
}

function validateSynthetic(fixture, metadata) {
  if (
    metadata.provider.family !== "synthetic" ||
    metadata.source.kind !== "created_for_testing" ||
    metadata.source.capturedOn !== null ||
    metadata.source.authorizationEvidenceId !== null ||
    metadata.source.authorizationExpiresOn !== null ||
    metadata.source.authorizationRevalidateOn !== null
  ) {
    fail(fixture, "synthetic fixtures must use only synthetic source/provider metadata");
  }
  if (
    metadata.sanitization.status !== "not_applicable_synthetic" ||
    metadata.sanitization.humanReview.state !== "not_applicable_synthetic" ||
    metadata.sanitization.humanReview.reviewerId !== null ||
    metadata.sanitization.humanReview.reviewedOn !== null ||
    metadata.sanitization.humanReview.evidenceId !== null ||
    metadata.reviewState !== "approved_synthetic"
  ) {
    fail(fixture, "synthetic review states are inconsistent");
  }
  if (
    metadata.retention.rawCaptureCreated !== false ||
    metadata.retention.rawCaptureDisposition !== "not_applicable" ||
    metadata.retention.rawCaptureEvidenceId !== null ||
    metadata.retention.rawDeletionDueOn !== null
  ) {
    fail(fixture, "synthetic fixtures cannot claim a raw capture");
  }
  if (
    metadata.representativeness.claim !== false ||
    metadata.representativeness.state !== "not_applicable" ||
    metadata.representativeness.reviewerId !== null ||
    metadata.representativeness.reviewedOn !== null ||
    metadata.representativeness.evidenceId !== null
  ) {
    fail(fixture, "synthetic fixtures cannot claim representative provider evidence");
  }
}

function validateProvider(fixture, metadata, today) {
  const todayCalendarDate = new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (
    metadata.provider.family === "synthetic" ||
    metadata.source.kind === "created_for_testing" ||
    metadata.source.capturedOn === null
  ) {
    fail(fixture, "provider-derived fixtures require an exact non-synthetic source");
  }
  assertDate(fixture, "source.capturedOn", metadata.source.capturedOn);
  assertOpaqueId(
    fixture,
    "source.authorizationEvidenceId",
    metadata.source.authorizationEvidenceId,
  );
  if (metadata.source.authorizationExpiresOn !== null) {
    assertDate(fixture, "source.authorizationExpiresOn", metadata.source.authorizationExpiresOn);
    const expiresOn = new Date(`${metadata.source.authorizationExpiresOn}T00:00:00.000Z`);
    if (expiresOn < todayCalendarDate) fail(fixture, "source authorization has expired");
  }
  assertDate(
    fixture,
    "source.authorizationRevalidateOn",
    metadata.source.authorizationRevalidateOn,
  );
  const revalidateOn = new Date(`${metadata.source.authorizationRevalidateOn}T00:00:00.000Z`);
  if (revalidateOn < todayCalendarDate) {
    fail(fixture, "source authorization revalidation is overdue");
  }
  if (
    metadata.sanitization.status !== "complete" ||
    metadata.sanitization.humanReview.state !== "approved_sanitized" ||
    metadata.reviewState !== "approved_sanitized_provider"
  ) {
    fail(fixture, "provider-derived sanitization review is incomplete");
  }
  assertOpaqueId(fixture, "humanReview.reviewerId", metadata.sanitization.humanReview.reviewerId);
  assertDate(fixture, "humanReview.reviewedOn", metadata.sanitization.humanReview.reviewedOn);
  assertOpaqueId(fixture, "humanReview.evidenceId", metadata.sanitization.humanReview.evidenceId);
  const categories = new Set(metadata.sanitization.automatedChecks.map((check) => check.category));
  for (const category of ["repository", "secret", "pii"]) {
    if (!categories.has(category)) fail(fixture, `provider fixture is missing ${category} checks`);
  }
  if (metadata.retention.rawCaptureCreated !== true) {
    fail(fixture, "provider-derived fixtures must declare raw-capture handling");
  }
  if (!["destroyed", "quarantined"].includes(metadata.retention.rawCaptureDisposition)) {
    fail(fixture, "provider-derived raw capture must be destroyed or quarantined");
  }
  assertOpaqueId(
    fixture,
    "retention.rawCaptureEvidenceId",
    metadata.retention.rawCaptureEvidenceId,
  );
  if (metadata.retention.rawCaptureDisposition === "destroyed") {
    if (metadata.retention.rawDeletionDueOn !== null) {
      fail(fixture, "destroyed raw captures cannot retain a deletion due date");
    }
  } else {
    assertDate(fixture, "retention.rawDeletionDueOn", metadata.retention.rawDeletionDueOn);
    const captured = new Date(`${metadata.source.capturedOn}T00:00:00.000Z`);
    const due = new Date(`${metadata.retention.rawDeletionDueOn}T00:00:00.000Z`);
    if (due.valueOf() - captured.valueOf() > 30 * 24 * 60 * 60 * 1000) {
      fail(fixture, "raw quarantine retention exceeds 30 days");
    }
    if (due < todayCalendarDate) fail(fixture, "raw quarantine deletion deadline has elapsed");
  }
  if (
    metadata.representativeness.claim !== true ||
    metadata.representativeness.state !== "accepted"
  ) {
    fail(fixture, "provider-derived fixtures require representative-behavior acceptance");
  }
  assertOpaqueId(fixture, "representativeness.reviewerId", metadata.representativeness.reviewerId);
  assertDate(fixture, "representativeness.reviewedOn", metadata.representativeness.reviewedOn);
  assertOpaqueId(fixture, "representativeness.evidenceId", metadata.representativeness.evidenceId);
}

function validateIntegrity(fixtureDirectory, fixture, metadata) {
  const manifestPaths = new Set();
  for (const [index, item] of metadata.integrity.files.entries()) {
    assertExactKeys(fixture, `integrity.files[${index}]`, item, ["path", "bytes", "digest"]);
    if (
      typeof item.path !== "string" ||
      item.path.includes("\\") ||
      path.posix.normalize(item.path) !== item.path ||
      item.path.startsWith("/") ||
      item.path.split("/").includes("..") ||
      ["metadata.json", "README.md"].includes(item.path)
    ) {
      fail(fixture, `integrity.files[${index}].path is unsafe or reserved`);
    }
    if (manifestPaths.has(item.path)) fail(fixture, `${item.path} is listed more than once`);
    manifestPaths.add(item.path);
    if (!Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > 1_048_576) {
      fail(fixture, `${item.path} has an invalid byte count`);
    }
    if (typeof item.digest !== "string" || !sha256Pattern.test(item.digest)) {
      fail(fixture, `${item.path} has an invalid SHA-256 digest`);
    }
    const extension = path.extname(item.path).toLowerCase();
    if (!allowedPayloadExtensions.has(extension)) {
      fail(fixture, `${item.path} uses an unapproved payload extension`);
    }
    const fullPath = path.resolve(fixtureDirectory, ...item.path.split("/"));
    const fixtureRoot = `${realpathSync(fixtureDirectory)}${path.sep}`;
    if (
      !fullPath.startsWith(fixtureRoot) ||
      !existsSync(fullPath) ||
      !lstatSync(fullPath).isFile()
    ) {
      fail(fixture, `${item.path} is missing or is not a regular file`);
    }
    const content = readFileSync(fullPath);
    if (content.byteLength !== item.bytes) fail(fixture, `${item.path} byte count does not match`);
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== item.digest) fail(fixture, `${item.path} SHA-256 digest does not match`);
    assertPayloadSafety(fixture, item.path, content.toString("utf8"));
  }

  const actualPayloads = enumerateFiles(fixtureDirectory).filter(
    (file) => file !== "metadata.json" && file !== "README.md",
  );
  if (JSON.stringify([...manifestPaths].sort()) !== JSON.stringify(actualPayloads)) {
    fail(fixture, "every fixture payload must be listed exactly once in integrity.files");
  }
}

export function validateFixture(metadataPath, options = {}) {
  const fixtureDirectory = path.dirname(metadataPath);
  const fixture = path.basename(fixtureDirectory);
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    fail(fixture, `metadata.json is not valid JSON: ${error.message}`);
  }
  validateCommon(fixture, metadata);
  if (metadata.evidenceClass === "synthetic") {
    validateSynthetic(fixture, metadata);
  } else {
    validateProvider(fixture, metadata, options.today ?? new Date());
  }
  validateIntegrity(fixtureDirectory, fixture, metadata);
  return metadata.fixtureId;
}

export function validateTree(root = moduleDirectory, options = {}) {
  if (!statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);
  const manifests = findMetadata(root);
  if (manifests.length === 0) throw new Error("No ATS fixture manifests were found");
  const fixtureDirectories = manifests.map((manifest) => `${path.dirname(manifest)}${path.sep}`);
  const allowedRootFiles = new Set([
    path.join(root, "README.md"),
    path.join(root, "fixture-metadata.v1.schema.json"),
    path.join(root, "validate-fixtures.mjs"),
    path.join(root, "validate-fixtures.test.mjs"),
    path.join(root, "templates", "authorized-provider-intake.template.json"),
    path.join(root, "templates", "authorized-provider-metadata.template.json"),
  ]);
  for (const file of findRepositoryFiles(root)) {
    if (
      allowedRootFiles.has(file) ||
      fixtureDirectories.some((fixtureDirectory) => file.startsWith(fixtureDirectory))
    ) {
      if (file.includes(`${path.sep}templates${path.sep}`)) {
        assertPayloadSafety("template", path.relative(root, file), readFileSync(file, "utf8"));
      }
      continue;
    }
    throw new Error(`${path.relative(root, file)} is not inside a manifested fixture`);
  }
  const fixtureIds = manifests.map((manifest) => validateFixture(manifest, options));
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error("ATS fixture IDs must be unique");
  }
  return fixtureIds.sort();
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const schemaPath = path.join(moduleDirectory, "fixture-metadata.v1.schema.json");
  JSON.parse(readFileSync(schemaPath, "utf8"));
  const fixtureIds = validateTree();
  console.log(`ATS fixture validation passed: ${fixtureIds.join(", ")}`);
}
