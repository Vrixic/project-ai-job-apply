import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const extensionRoot = dirname(fileURLToPath(import.meta.url));
const policyPath = join(extensionRoot, "store", "release-policy.v1.json");
const deterministicInstant = "1980-01-01T00:00:00.000Z";
const utf8Flag = 0x0800;
const storedMethod = 0;
const dosTime = 0;
const dosDate = 0x0021;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function exactStringSet(actual, expected, field) {
  if (!Array.isArray(actual) || actual.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a string array`);
  }
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((item, index) => item !== right[index])) {
    throw new Error(`${field} does not match the reviewed release policy`);
  }
}

function validateManifest(manifest, packageVersion, policy) {
  if (manifest.manifest_version !== 3) throw new Error("Only Manifest V3 can be packaged");
  if (manifest.name !== policy.manifest.name) throw new Error("Manifest name is not default-dark");
  if (manifest.version !== packageVersion) throw new Error("Manifest and package versions differ");
  if (
    typeof manifest.description !== "string" ||
    !manifest.description.includes("Synthetic-only")
  ) {
    throw new Error("Manifest description must disclose the synthetic-only boundary");
  }
  exactStringSet(manifest.permissions, policy.manifest.requiredPermissions, "Manifest permissions");
  for (const permission of manifest.permissions) {
    if (policy.manifest.forbiddenPermissions.includes(permission)) {
      throw new Error(`Forbidden permission in archive: ${permission}`);
    }
  }
  if ("host_permissions" in manifest || "optional_host_permissions" in manifest) {
    throw new Error("The default-dark store archive cannot contain host permissions");
  }
  for (const forbiddenField of [
    "content_scripts",
    "externally_connectable",
    "optional_permissions",
    "sandbox",
    "update_url",
    "web_accessible_resources",
  ]) {
    if (forbiddenField in manifest) throw new Error(`Forbidden manifest field: ${forbiddenField}`);
  }
  if (
    manifest.background?.service_worker !== "background.js" ||
    manifest.background?.type !== "module"
  ) {
    throw new Error("Unexpected background worker boundary");
  }
  if (manifest.side_panel?.default_path !== "sidepanel.html") {
    throw new Error("Unexpected side-panel boundary");
  }
  if (manifest.content_security_policy?.extension_pages !== policy.manifest.contentSecurityPolicy) {
    throw new Error("Manifest CSP does not match the reviewed policy");
  }
}

const forbiddenTelemetryMarkers = [
  "amplitude.com",
  "browser-intake-datadoghq.com",
  "google-analytics.com",
  "mixpanel.com",
  "segment.io",
  "sentry.io",
];

async function flatFiles(directory) {
  const names = await readdir(directory);
  const files = [];
  for (const name of names.sort()) {
    const path = join(directory, name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Release input must contain regular flat files only: ${name}`);
    }
    files.push(name);
  }
  return files;
}

export async function validateReleaseFiles({ distDirectory, packageVersion, policy }) {
  const names = await flatFiles(distDirectory);
  exactStringSet(names, policy.allowedFiles, "Archive file allowlist");
  const records = [];
  for (const name of names) {
    const data = await readFile(join(distDirectory, name));
    if (data.length === 0) throw new Error(`Release file is empty: ${name}`);
    if (data.includes(Buffer.from("sourceMappingURL="))) {
      throw new Error(`Source map reference is forbidden: ${name}`);
    }
    if (
      name.endsWith(".html") &&
      /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:|\/\/)/iu.test(data.toString("utf8"))
    ) {
      throw new Error(`Remote HTML script is forbidden: ${name}`);
    }
    if (name.endsWith(".js")) {
      const source = data.toString("utf8");
      if (
        /\b(?:import\s*\(|importScripts\s*\(|new\s+(?:Shared)?Worker\s*\()\s*["'](?:https?:|\/\/)/u.test(
          source,
        )
      ) {
        throw new Error(`Remote executable JavaScript is forbidden: ${name}`);
      }
      if (/\b(?:eval\s*\(|new\s+Function\s*\()/u.test(source)) {
        throw new Error(`Dynamic code construction is forbidden: ${name}`);
      }
      if (forbiddenTelemetryMarkers.some((marker) => source.includes(marker))) {
        throw new Error(`Telemetry endpoint is forbidden: ${name}`);
      }
    }
    records.push({ name, data, sha256: sha256(data), sizeBytes: data.length });
  }
  const manifestRecord = records.find((record) => record.name === "manifest.json");
  if (!manifestRecord) throw new Error("Manifest is missing from release input");
  let manifest;
  try {
    manifest = JSON.parse(manifestRecord.data.toString("utf8"));
  } catch {
    throw new Error("Manifest is not valid JSON");
  }
  validateManifest(manifest, packageVersion, policy);
  return records;
}

export function zipStoredFiles(records) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const record of records) {
    const name = Buffer.from(record.name, "utf8");
    const checksum = crc32(record.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(storedMethod, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(record.data.length, 18);
    local.writeUInt32LE(record.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, record.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(storedMethod, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(record.data.length, 20);
    central.writeUInt32LE(record.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + record.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export async function createReleaseArchive({
  distDirectory,
  outputDirectory,
  packageVersion,
  policy,
}) {
  const records = await validateReleaseFiles({ distDirectory, packageVersion, policy });
  const archive = zipStoredFiles(records);
  const archiveName = `${policy.archivePrefix}-${packageVersion}-${policy.releaseChannel}.zip`;
  const releaseManifest = {
    schemaVersion: 1,
    releaseChannel: policy.releaseChannel,
    packageVersion,
    deterministicInstant,
    archive: {
      name: archiveName,
      sha256: sha256(archive),
      sizeBytes: archive.length,
    },
    files: records.map(({ name, sha256: digest, sizeBytes }) => ({
      name,
      sha256: digest,
      sizeBytes,
    })),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, archiveName), archive);
  await writeFile(
    join(outputDirectory, "release-manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
  );
  return releaseManifest;
}

async function main() {
  const packageMetadata = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const distDirectory = join(extensionRoot, "dist");
  await execFileAsync(process.execPath, [join(extensionRoot, "build.mjs")], {
    cwd: extensionRoot,
    env: {
      ...process.env,
      EXTENSION_API_ORIGIN: "",
      EXTENSION_AUTH0_AUDIENCE: "",
      EXTENSION_AUTH0_CLIENT_ID: "",
      EXTENSION_AUTH0_DOMAIN: "",
      EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON: "",
      EXTENSION_DETECTOR_ACTIVATION_JSON: "",
      EXTENSION_PENDING_RETENTION_HOURS: "",
      EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION: "",
    },
  });
  const temporaryOutput = await mkdtemp(join(tmpdir(), "applydash-extension-release-"));
  try {
    const result = await createReleaseArchive({
      distDirectory,
      outputDirectory: temporaryOutput,
      packageVersion: packageMetadata.version,
      policy,
    });
    const finalOutput = join(distDirectory, "release");
    await rm(finalOutput, { recursive: true, force: true });
    await mkdir(finalOutput, { recursive: true });
    for (const name of await readdir(temporaryOutput)) {
      await writeFile(join(finalOutput, name), await readFile(join(temporaryOutput, name)));
    }
    process.stdout.write(
      `Created deterministic default-dark archive ${result.archive.name} (${result.archive.sha256}).\n`,
    );
  } finally {
    await rm(temporaryOutput, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
