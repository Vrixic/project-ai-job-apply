export interface PublicWebSettings {
  origin: URL;
  indexingEnabled: boolean;
}

function exactBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`${name} must be exactly true or false`);
}

export function loadPublicWebSettings(
  environment: Record<string, string | undefined> = process.env,
): PublicWebSettings {
  const origin = new URL(environment.APP_BASE_URL ?? "http://localhost:3000");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && local)) ||
    origin.username ||
    origin.password ||
    origin.hostname.endsWith(".") ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("APP_BASE_URL must be an origin-only HTTPS URL except on localhost");
  }
  const indexingEnabled = exactBoolean(
    environment.PUBLIC_JOB_INDEXING_ENABLED,
    "PUBLIC_JOB_INDEXING_ENABLED",
  );
  const reservedHostnames = ["test", "example", "invalid", "localhost", "local"];
  const documentationDomains = ["example.com", "example.net", "example.org"];
  const reservedIndexingHost = [...reservedHostnames, ...documentationDomains].some(
    (name) => origin.hostname === name || origin.hostname.endsWith(`.${name}`),
  );
  const addressLiteral =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(origin.hostname) ||
    (origin.hostname.startsWith("[") && origin.hostname.endsWith("]"));
  if (
    indexingEnabled &&
    (origin.protocol !== "https:" ||
      local ||
      reservedIndexingHost ||
      addressLiteral ||
      !origin.hostname.includes("."))
  ) {
    throw new Error("Public job indexing requires an approved non-test HTTPS origin");
  }
  return Object.freeze({ origin, indexingEnabled });
}
