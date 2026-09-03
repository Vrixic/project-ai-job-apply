import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const privateRoot = path.join(
  repositoryRoot,
  "infrastructure",
  "terraform",
  "environments",
  "development",
  ".terraform",
  "development-d2-contribution-policy",
);
const policyModulePath = path.join(
  repositoryRoot,
  "backend",
  "services",
  "jobs",
  "dist",
  "src",
  "contribution-capability-policy.js",
);

const TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,99}$/u;
const VERSION_PATTERN =
  /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,15})?$/u;
const PROVIDERS = ["ashby", "greenhouse", "lever"];
const VARIANTS = ["ashby-job-board-v1", "greenhouse-board-v1", "lever-posting-v1"];
const DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.ashbyhq.com",
  "jobs.eu.lever.co",
  "jobs.lever.co",
];
const PROVIDER_VARIANT = {
  ashby: "ashby-job-board-v1",
  greenhouse: "greenhouse-board-v1",
  lever: "lever-posting-v1",
};
const PROVIDER_DOMAINS = {
  ashby: ["jobs.ashbyhq.com"],
  greenhouse: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
  lever: ["jobs.eu.lever.co", "jobs.lever.co"],
};
const ACTIVATION_AUTHORITY = "CONFIRM-D2-DEVELOPMENT-POLICY-ACTIVATION";

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (!name.startsWith("--") || result.has(name)) {
      throw new Error("Arguments must be unique named options.");
    }
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      result.set(name, true);
    } else {
      result.set(name, next);
      index += 1;
    }
  }
  return result;
}

function option(argumentsMap, name, { required = false } = {}) {
  const value = argumentsMap.get(`--${name}`);
  if (required && (typeof value !== "string" || value.length === 0)) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function flag(argumentsMap, name) {
  const value = argumentsMap.get(`--${name}`);
  if (value === undefined) return false;
  if (value !== true) throw new Error(`--${name} does not accept a value.`);
  return true;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactIso(value, name) {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    throw new Error(`${name} must be an exact ISO timestamp.`);
  }
  return instant;
}

async function resolvePrivateDirectory(value) {
  await mkdir(privateRoot, { recursive: true });
  const canonicalRoot = await realpath(privateRoot);
  const resolved = path.resolve(value ?? privateRoot);
  if (resolved !== canonicalRoot && !resolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("D2 policy material must remain below the ignored private operator directory.");
  }
  await mkdir(resolved, { recursive: true });
  const canonical = await realpath(resolved);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("D2 policy material resolved outside the ignored private operator directory.");
  }
  return canonical;
}

async function resolvePrivateFile(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required.`);
  const resolved = path.resolve(value);
  const canonicalRoot = await realpath(privateRoot);
  if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("D2 policy material must remain below the ignored private operator directory.");
  }
  const canonical = await realpath(resolved);
  if (!canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("D2 policy material resolved outside the ignored private operator directory.");
  }
  return canonical;
}

async function writeExclusive(filePath, value, mode = 0o600) {
  await writeFile(filePath, value, { encoding: "utf8", flag: "wx", mode });
}

async function loadPolicyModule() {
  try {
    return await import(
      `${new URL(`file:///${policyModulePath.replaceAll("\\", "/")}`).href}?v=${Date.now()}`
    );
  } catch {
    throw new Error("Build @ai-job-apply/jobs-service before operating a D2 contribution policy.");
  }
}

function result(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function generateKey(argumentsMap) {
  const keyId = option(argumentsMap, "key-id", { required: true });
  if (!TOKEN_PATTERN.test(keyId)) throw new Error("--key-id is invalid.");
  const outputDirectory = await resolvePrivateDirectory(
    option(argumentsMap, "output-directory") ?? path.join(privateRoot, keyId),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" });
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  const publicDer = publicKey.export({ format: "der", type: "spki" });
  const serverKeys = JSON.stringify({ [keyId]: publicPem }, null, 2);
  const extensionKeys = JSON.stringify({ [keyId]: publicDer.toString("base64url") }, null, 2);
  await writeExclusive(path.join(outputDirectory, "private-key.pem"), privatePem);
  await writeExclusive(path.join(outputDirectory, "server-public-keys.json"), `${serverKeys}\n`);
  await writeExclusive(
    path.join(outputDirectory, "extension-public-keys.json"),
    `${extensionKeys}\n`,
  );
  const metadata = {
    schemaVersion: 1,
    kind: "development-d2-contribution-policy-key",
    keyId,
    publicKeySha256: sha256(publicDer),
    createdAt: new Date().toISOString(),
  };
  await writeExclusive(
    path.join(outputDirectory, "key-metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  result({
    action: "GenerateKey",
    keyId,
    outputDirectory,
    publicKeySha256: metadata.publicKeySha256,
    privateKeyPrinted: false,
    existingMaterialReplaced: false,
  });
}

function enabledProviders(argumentsMap) {
  const raw = option(argumentsMap, "enabled-providers") ?? "";
  if (raw === "") return [];
  const values = raw.split(",");
  if (
    new Set(values).size !== values.length ||
    values.some((value) => !PROVIDERS.includes(value))
  ) {
    throw new Error(
      "--enabled-providers must be a unique comma-separated subset of ashby,greenhouse,lever.",
    );
  }
  return values;
}

async function signPolicy(argumentsMap) {
  const keyId = option(argumentsMap, "key-id", { required: true });
  const revision = option(argumentsMap, "revision", { required: true });
  const clientVersion = option(argumentsMap, "client-version", { required: true });
  if (!TOKEN_PATTERN.test(keyId)) throw new Error("--key-id is invalid.");
  if (!TOKEN_PATTERN.test(revision)) throw new Error("--revision is invalid.");
  if (!VERSION_PATTERN.test(clientVersion)) throw new Error("--client-version is invalid.");
  const keyDirectory = await resolvePrivateDirectory(option(argumentsMap, "key-directory"));
  const privateKeyPath = await resolvePrivateFile(
    path.join(keyDirectory, "private-key.pem"),
    "key-directory",
  );
  const serverKeysPath = await resolvePrivateFile(
    path.join(keyDirectory, "server-public-keys.json"),
    "key-directory",
  );
  const lifetimeMinutes = Number(option(argumentsMap, "lifetime-minutes") ?? "60");
  if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes < 5 || lifetimeMinutes > 1440) {
    throw new Error("--lifetime-minutes must be a whole number from 5 through 1440.");
  }
  const issuedAtValue = option(argumentsMap, "issued-at") ?? new Date().toISOString();
  const issuedAt = exactIso(issuedAtValue, "--issued-at");
  const expiresAt = new Date(issuedAt + lifetimeMinutes * 60 * 1000).toISOString();
  const intakeEnabled = flag(argumentsMap, "enable-intake");
  const processingEnabled = flag(argumentsMap, "enable-processing");
  const providerList = enabledProviders(argumentsMap);
  if (
    (intakeEnabled || processingEnabled || providerList.length > 0) &&
    option(argumentsMap, "activation-authority") !== ACTIVATION_AUTHORITY
  ) {
    throw new Error(
      "Enabling any policy dimension requires the exact development activation authority.",
    );
  }
  const providerSet = new Set(providerList);
  const payload = {
    schemaVersion: 1,
    revision,
    issuedAt: issuedAtValue,
    expiresAt,
    intakeEnabled,
    processingEnabled,
    clients: { [clientVersion]: intakeEnabled || processingEnabled },
    providers: Object.fromEntries(
      PROVIDERS.map((provider) => [provider, providerSet.has(provider)]),
    ),
    variants: Object.fromEntries(
      VARIANTS.map((variant) => [
        variant,
        providerList.some((provider) => PROVIDER_VARIANT[provider] === variant),
      ]),
    ),
    domains: Object.fromEntries(
      DOMAINS.map((domain) => [
        domain,
        providerList.some((provider) => PROVIDER_DOMAINS[provider].includes(domain)),
      ]),
    ),
  };
  const policyModule = await loadPolicyModule();
  const digestInput = policyModule.contributionCapabilityPolicyDigestInput(payload);
  const privatePem = await readFile(privateKeyPath, "utf8");
  const privateKey = createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("The private key is not Ed25519.");
  const publicKey = createPublicKey(privateKey);
  const configuredKeys = JSON.parse(await readFile(serverKeysPath, "utf8"));
  const expectedPem = publicKey.export({ format: "pem", type: "spki" });
  if (configuredKeys[keyId] !== expectedPem)
    throw new Error("The key ID does not match the private key.");
  const envelope = {
    keyId,
    payload,
    signature: sign(null, Buffer.from(digestInput, "utf8"), privateKey).toString("base64url"),
  };
  policyModule.verifySignedContributionCapabilityPolicy(envelope, configuredKeys);
  const envelopeJson = JSON.stringify(envelope);
  const policyPath = path.join(keyDirectory, `signed-policy-${revision}.json`);
  const receiptPath = path.join(keyDirectory, `signed-policy-${revision}.receipt.json`);
  await writeExclusive(policyPath, `${envelopeJson}\n`);
  const receipt = {
    schemaVersion: 1,
    kind: "development-d2-contribution-policy-signing",
    keyId,
    revision,
    issuedAt: issuedAtValue,
    expiresAt,
    envelopeSha256: sha256(envelopeJson),
    digestInputSha256: sha256(digestInput),
    intakeEnabled,
    processingEnabled,
    enabledProviderCount: providerList.length,
    enabledVariantCount: Object.values(payload.variants).filter(Boolean).length,
    enabledDomainCount: Object.values(payload.domains).filter(Boolean).length,
    privateKeyPrinted: false,
  };
  await writeExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  result({
    action: "Sign",
    policyPath,
    receiptPath,
    ...receipt,
    existingMaterialReplaced: false,
  });
}

async function verifyPolicy(argumentsMap) {
  const policyPath = await resolvePrivateFile(
    option(argumentsMap, "policy-path", { required: true }),
    "policy-path",
  );
  const serverKeysPath = await resolvePrivateFile(
    option(argumentsMap, "server-public-keys-path", { required: true }),
    "server-public-keys-path",
  );
  const envelope = JSON.parse(await readFile(policyPath, "utf8"));
  const keys = JSON.parse(await readFile(serverKeysPath, "utf8"));
  const policyModule = await loadPolicyModule();
  const payload = policyModule.verifySignedContributionCapabilityPolicy(envelope, keys);
  const now = Date.now();
  if (now < Date.parse(payload.issuedAt) || now >= Date.parse(payload.expiresAt)) {
    throw new Error("The signed policy is not current.");
  }
  result({
    action: "Verify",
    keyId: envelope.keyId,
    revision: payload.revision,
    envelopeSha256: sha256(JSON.stringify(envelope)),
    intakeEnabled: payload.intakeEnabled,
    processingEnabled: payload.processingEnabled,
    enabledProviderCount: Object.values(payload.providers).filter(Boolean).length,
    enabledVariantCount: Object.values(payload.variants).filter(Boolean).length,
    enabledDomainCount: Object.values(payload.domains).filter(Boolean).length,
    current: true,
    privateKeyRead: false,
  });
}

function printHelp() {
  process.stdout.write(
    `Usage:\n  node scripts/operate-development-d2-contribution-policy.mjs --action GenerateKey --key-id ID [--output-directory PATH]\n  node scripts/operate-development-d2-contribution-policy.mjs --action Sign --key-directory PATH --key-id ID --revision REVISION --client-version VERSION [--lifetime-minutes 60]\n  node scripts/operate-development-d2-contribution-policy.mjs --action Verify --policy-path PATH --server-public-keys-path PATH\n\nAll key and policy files must remain below:\n  ${privateRoot}\n\nSign is default-dark. Enabling any dimension additionally requires --activation-authority ${ACTIVATION_AUTHORITY}.\n`,
  );
}

try {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const action = option(argumentsMap, "action") ?? "Help";
  if (action === "Help") printHelp();
  else if (action === "GenerateKey") await generateKey(argumentsMap);
  else if (action === "Sign") await signPolicy(argumentsMap);
  else if (action === "Verify") await verifyPolicy(argumentsMap);
  else throw new Error("--action must be GenerateKey, Sign, Verify, or Help.");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "D2 policy operation failed."}\n`,
  );
  process.exitCode = 1;
}
