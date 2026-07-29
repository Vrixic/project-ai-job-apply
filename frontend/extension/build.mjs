import { readFile, rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(extensionRoot, "dist");

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
  name: "ApplyDash Identity Conformance",
  version: "0.1.0",
  description: "Development-only Auth0 public-client conformance shell.",
  permissions: ["identity", "storage"],
  ...(configured ? { host_permissions: [`https://${domain}/*`] } : {}),
  background: {
    service_worker: "background.js",
    type: "module",
  },
  action: {
    default_popup: "popup.html",
    default_title: "ApplyDash identity conformance",
  },
};

await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await copyFile(join(extensionRoot, "static", "popup.html"), join(outputDirectory, "popup.html"));
await copyFile(join(extensionRoot, "static", "popup.css"), join(outputDirectory, "popup.css"));

if (process.argv.includes("--watch")) {
  const buildContext = await context(buildOptions);
  await buildContext.watch();
  console.log("Watching the extension authentication shell.");
} else {
  await build(buildOptions);
  console.log(
    configured
      ? "Built the configured extension authentication shell."
      : "Built a fail-closed shell; add public Auth0 settings to .env.local for conformance.",
  );
}
