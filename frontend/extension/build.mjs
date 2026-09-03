import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(extensionRoot, "dist");
const packageMetadata = JSON.parse(await readFile(join(extensionRoot, "package.json"), "utf8"));

async function localEnvironment() {
  let source = "";
  try {
    source = await readFile(join(extensionRoot, ".env.local"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
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

const fileEnvironment = await localEnvironment();
const domain = (
  process.env.EXTENSION_AUTH0_DOMAIN ??
  fileEnvironment.EXTENSION_AUTH0_DOMAIN ??
  ""
).trim();
const clientId = (
  process.env.EXTENSION_AUTH0_CLIENT_ID ??
  fileEnvironment.EXTENSION_AUTH0_CLIENT_ID ??
  ""
).trim();
const audience = (
  process.env.EXTENSION_AUTH0_AUDIENCE ??
  fileEnvironment.EXTENSION_AUTH0_AUDIENCE ??
  "ai-job-apply-api"
).trim();
const apiOriginValue = (
  process.env.EXTENSION_API_ORIGIN ??
  fileEnvironment.EXTENSION_API_ORIGIN ??
  ""
).trim();
const pendingRetentionHoursValue = (
  process.env.EXTENSION_PENDING_RETENTION_HOURS ??
  fileEnvironment.EXTENSION_PENDING_RETENTION_HOURS ??
  ""
).trim();
const ugcContributionPolicyVersion = (
  process.env.EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION ??
  fileEnvironment.EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION ??
  ""
).trim();
const capabilityPolicyPublicKeysValue = (
  process.env.EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON ??
  fileEnvironment.EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON ??
  ""
).trim();
const detectorActivationPolicyValue = (
  process.env.EXTENSION_DETECTOR_ACTIVATION_JSON ??
  fileEnvironment.EXTENSION_DETECTOR_ACTIVATION_JSON ??
  ""
).trim();
let detectorActivationPolicy = {};
try {
  if (detectorActivationPolicyValue.length <= 8_192) {
    const parsed = JSON.parse(detectorActivationPolicyValue);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      detectorActivationPolicy = parsed;
    }
  }
} catch {
  detectorActivationPolicy = {};
}
const detectorActivationSupplied = Object.keys(detectorActivationPolicy).length > 0;
let capabilityPolicyPublicKeys = {};
try {
  const parsed = JSON.parse(capabilityPolicyPublicKeysValue);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    capabilityPolicyPublicKeys = Object.fromEntries(
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
  capabilityPolicyPublicKeys = {};
}
const safeUgcContributionPolicyVersion = /^[a-z0-9][a-z0-9._-]{2,99}$/u.test(
  ugcContributionPolicyVersion,
)
  ? ugcContributionPolicyVersion
  : "";
const pendingRetentionHours = Number(pendingRetentionHoursValue);
const pendingRetentionMilliseconds =
  Number.isInteger(pendingRetentionHours) &&
  pendingRetentionHours >= 1 &&
  pendingRetentionHours <= 720
    ? pendingRetentionHours * 60 * 60 * 1_000
    : 0;
let apiOrigin = "";
try {
  const parsed = new URL(apiOriginValue);
  if (
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    parsed.pathname === "/" &&
    !parsed.search &&
    !parsed.hash
  ) {
    apiOrigin = parsed.origin;
  }
} catch {
  apiOrigin = "";
}
const configured =
  domain.length > 0 &&
  !domain.includes("://") &&
  !domain.includes("/") &&
  !/\s/u.test(domain) &&
  clientId.length > 0 &&
  audience === "ai-job-apply-api";

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const buildOptions = {
  bundle: true,
  define: {
    __AUTH0_AUDIENCE__: JSON.stringify(configured ? audience : ""),
    __AUTH0_CLIENT_ID__: JSON.stringify(configured ? clientId : ""),
    __AUTH0_DOMAIN__: JSON.stringify(configured ? domain : ""),
    __CAPABILITY_POLICY_PUBLIC_KEYS__: JSON.stringify(capabilityPolicyPublicKeys),
    __DETECTOR_ACTIVATION_POLICY__: JSON.stringify(detectorActivationPolicy),
    __EXTENSION_API_ORIGIN__: JSON.stringify(apiOrigin),
    __PENDING_RETENTION_MILLISECONDS__: JSON.stringify(pendingRetentionMilliseconds),
    __UGC_CONTRIBUTION_POLICY_VERSION__: JSON.stringify(safeUgcContributionPolicyVersion),
  },
  entryPoints: {
    background: join(extensionRoot, "entrypoints", "background.ts"),
    popup: join(extensionRoot, "entrypoints", "popup.ts"),
  },
  format: "esm",
  logLevel: "info",
  outdir: outputDirectory,
  platform: "browser",
  sourcemap: false,
  target: "chrome120",
};

const manifest = {
  manifest_version: 3,
  name: "ApplyDash Job Capture (Default Dark)",
  version: packageMetadata.version,
  description: "Synthetic-only current-tab job capture and explicit contribution preview.",
  permissions: ["activeTab", "alarms", "identity", "scripting", "sidePanel", "storage"],
  ...(configured || apiOrigin
    ? {
        host_permissions: [
          ...(configured ? [`https://${domain}/*`] : []),
          ...(apiOrigin ? [`${apiOrigin}/*`] : []),
        ],
      }
    : {}),
  background: {
    service_worker: "background.js",
    type: "module",
  },
  action: {
    default_popup: "popup.html",
    default_title: "Save or contribute this job",
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
  side_panel: { default_path: "sidepanel.html" },
};

await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(join(extensionRoot, "static", "popup.html"), join(outputDirectory, "popup.html"));
await copyFile(join(extensionRoot, "static", "popup.css"), join(outputDirectory, "popup.css"));
await copyFile(
  join(extensionRoot, "static", "popup.html"),
  join(outputDirectory, "sidepanel.html"),
);

if (process.argv.includes("--watch")) {
  const buildContext = await context(buildOptions);
  await buildContext.watch();
  console.log("Watching the default-dark extension product shell.");
} else {
  await build(buildOptions);
  const inspectionStatus = detectorActivationSupplied
    ? "Built with machine-local current-page detector activation."
    : "Current-page inspection remains default-dark.";
  const deliveryStatus =
    configured && apiOrigin
      ? "Authenticated API delivery is configured."
      : configured
        ? "Identity is configured, but API delivery remains disabled."
        : "Adding a job remains disabled until public Auth0 and API settings are configured.";
  console.log(`${inspectionStatus} ${deliveryStatus}`);
}
