import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function parseDevelopmentContributions(value) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("EXTENSION_DEVELOPMENT_CONTRIBUTIONS must be exactly true or false");
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
