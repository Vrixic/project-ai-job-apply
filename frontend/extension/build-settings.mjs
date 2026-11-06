import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function parseDevelopmentContributions(value) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("EXTENSION_DEVELOPMENT_CONTRIBUTIONS must be exactly true or false");
}

export function applicationHandoffOriginForBuild(environment, fileEnvironment) {
  const enabled =
    environment.EXTENSION_APPLICATION_HANDOFF_ENABLED ??
    fileEnvironment.EXTENSION_APPLICATION_HANDOFF_ENABLED;
  if (enabled === undefined || enabled === "false") return "";
  if (enabled !== "true")
    throw new Error("EXTENSION_APPLICATION_HANDOFF_ENABLED must be exactly true or false");
  const value =
    environment.EXTENSION_APPLICATION_HANDOFF_WEB_ORIGIN ??
    fileEnvironment.EXTENSION_APPLICATION_HANDOFF_WEB_ORIGIN ??
    "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Application handoff requires one exact HTTPS website origin");
  }
  return url.origin;
}

export function applicationExecutionForBuild(environment, fileEnvironment, handoffOrigin) {
  const enabled =
    environment.EXTENSION_APPLICATION_EXECUTION_ENABLED ??
    fileEnvironment.EXTENSION_APPLICATION_EXECUTION_ENABLED;
  if (enabled === undefined || enabled === "false") return false;
  if (enabled !== "true")
    throw new Error("EXTENSION_APPLICATION_EXECUTION_ENABLED must be exactly true or false");
  if (!handoffOrigin)
    throw new Error("Application execution requires the exact handoff website origin");
  return true;
}

const executionProviderNames = ["greenhouse", "ashby"];

/**
 * The exact sites each switched-on provider fills (ADR-045, amendment 2026-11-06). Only an
 * unpacked execution build holds them as host permissions, so the extension can see and fill the
 * employer page the candidate was just sent to without an icon click. No wildcard, no other site;
 * the default-dark and store builds never get them (the release archive refuses any host
 * permission).
 */
const executionProviderHosts = Object.freeze({
  greenhouse: Object.freeze(["boards.greenhouse.io", "job-boards.greenhouse.io"]),
  ashby: Object.freeze(["jobs.ashbyhq.com"]),
});

export function applicationExecutionHostPermissions(providers) {
  return Object.freeze(
    providers.flatMap((provider) =>
      (executionProviderHosts[provider] ?? []).map((host) => `https://${host}/*`),
    ),
  );
}

/**
 * Which providers a build switches on (ADR-053). Absent means none: the execution entry is built
 * but every kill switch stays off. Naming one requires the execution build and is exact.
 */
export function applicationExecutionProvidersForBuild(environment, fileEnvironment, execution) {
  const value =
    environment.EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON ??
    fileEnvironment.EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON;
  if (value === undefined) return Object.freeze([]);
  if (execution !== true)
    throw new Error("Execution providers require EXTENSION_APPLICATION_EXECUTION_ENABLED=true");
  let parsed;
  try {
    if (typeof value === "string" && value.length <= 64) parsed = JSON.parse(value);
  } catch {
    // An invalid selection must fail the build, not broaden what it may do.
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > executionProviderNames.length ||
    new Set(parsed).size !== parsed.length ||
    parsed.some((provider) => !executionProviderNames.includes(provider))
  )
    throw new Error(
      "EXTENSION_APPLICATION_EXECUTION_PROVIDERS_JSON must be a JSON array of unique names from greenhouse and ashby",
    );
  return Object.freeze([...parsed]);
}

/**
 * Binds the registry evidence to the exact provider code a build contains: the executor, the
 * provider modules and the built ats-sdk pieces they rely on. A source change changes the hash.
 */
export async function applicationImplementationHash(extensionRoot) {
  // Labels are fixed names so the same source hashes the same wherever it is built.
  const entries = [
    ["lib/application-run.ts", join(extensionRoot, "lib", "application-run.ts")],
    ["lib/command-fields.ts", join(extensionRoot, "lib", "command-fields.ts")],
  ];
  for (const directory of ["providers", "greenhouse", "ashby"]) {
    const path = join(extensionRoot, "lib", directory);
    for (const name of (await readdir(path)).sort()) {
      if (name.endsWith(".ts")) entries.push([`lib/${directory}/${name}`, join(path, name)]);
    }
  }
  const sdk = dirname(
    createRequire(join(extensionRoot, "package.json")).resolve("@ai-job-apply/ats-sdk/registry"),
  );
  for (const name of ["extract", "form-model", "mapping", "observed-form", "plan", "registry"])
    entries.push([`ats-sdk/${name}.js`, join(sdk, `${name}.js`)]);
  const hash = createHash("sha256");
  for (const [label, path] of entries) {
    hash.update(`${label}\u0000`);
    hash.update((await readFile(path, "utf8")).replaceAll("\r\n", "\n"));
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

export function developmentContributionProvidersForBuild(
  environment,
  fileEnvironment,
  development,
) {
  const processValue = environment.EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON;
  const fileValue = fileEnvironment.EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON;
  if (development !== true) {
    if (processValue !== undefined || fileValue !== undefined) {
      throw new Error(
        "Development contribution providers require explicit unpacked development mode",
      );
    }
    return Object.freeze([]);
  }
  const value = processValue ?? fileValue;
  if (value === undefined) return Object.freeze(["greenhouse"]);
  let parsed;
  try {
    if (typeof value === "string" && value.length <= 128) parsed = JSON.parse(value);
  } catch {
    // Invalid explicit selection must fail the build, not broaden its provider scope.
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 3 ||
    new Set(parsed).size !== parsed.length ||
    parsed.some(
      (provider) =>
        typeof provider !== "string" || !["greenhouse", "lever", "ashby"].includes(provider),
    )
  ) {
    throw new Error(
      "EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON must be a JSON array of at most three unique known provider names",
    );
  }
  return Object.freeze([...parsed].sort());
}

export function capabilityPolicyPublicKeysForBuild(environment, fileEnvironment, development) {
  // Retired key configuration is irrelevant in unpacked development; do not even read it.
  if (development === true) return {};
  try {
    const value =
      environment.EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON ??
      fileEnvironment.EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON ??
      "";
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed)
          .filter(
            ([keyId, publicKey]) =>
              /^[a-z0-9][a-z0-9._-]{2,99}$/u.test(keyId) &&
              typeof publicKey === "string" &&
              /^[A-Za-z0-9_-]{40,256}$/u.test(publicKey),
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, 5),
      );
    }
  } catch {
    // The signed path still fails closed without usable public keys.
  }
  return {};
}

export function assertStoreContributionMode(environment, fileEnvironment) {
  for (const values of [environment, fileEnvironment]) {
    if (applicationExecutionForBuild(values, {}, applicationHandoffOriginForBuild(values, {})))
      throw new Error("Application execution is unpacked-only until its release is accepted");
  }
  if (
    applicationHandoffOriginForBuild(environment, {}) ||
    applicationHandoffOriginForBuild({}, fileEnvironment)
  ) {
    throw new Error("Application handoff is unpacked-only until its release is accepted");
  }
  // Never silently convert an explicitly configured development build into a store artifact.
  if (
    parseDevelopmentContributions(environment.EXTENSION_DEVELOPMENT_CONTRIBUTIONS) ||
    parseDevelopmentContributions(fileEnvironment.EXTENSION_DEVELOPMENT_CONTRIBUTIONS)
  ) {
    throw new Error("Development contributions are unpacked-only and cannot be store-packaged");
  }
  developmentContributionProvidersForBuild(environment, fileEnvironment, false);
}

export async function localExtensionEnvironment(extensionRoot) {
  let source = "";
  try {
    source = await readFile(join(extensionRoot, ".env.local"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}
