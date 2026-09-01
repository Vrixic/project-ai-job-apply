import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const BROWSER_ASSURANCE_HOST = "127.0.0.1";
export const BROWSER_ASSURANCE_MODE = "generated-synthetic";
export const DEFAULT_BROWSER_ASSURANCE_PORT = 4175;

const browserRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(browserRoot, "../../..");
const galleryRoot = resolve(browserRoot, "gallery");
const outputRoot = resolve(repositoryRoot, ".tmp", "d1-browser-assurance");

function assertContainedOutput() {
  const relativeOutput = relative(repositoryRoot, outputRoot);
  if (!relativeOutput.startsWith(`.tmp${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Browser assurance output must remain under the repository .tmp directory");
  }
}

export function resolveBrowserAssuranceConfiguration(environment = process.env) {
  if (environment.NODE_ENV !== "test") {
    throw new Error("NODE_ENV must equal test; refusing to start");
  }
  if (environment.D1_BROWSER_ASSURANCE_MODE !== BROWSER_ASSURANCE_MODE) {
    throw new Error(
      `D1_BROWSER_ASSURANCE_MODE must equal ${BROWSER_ASSURANCE_MODE}; refusing to start`,
    );
  }
  const requestedPort =
    environment.D1_BROWSER_ASSURANCE_PORT ?? String(DEFAULT_BROWSER_ASSURANCE_PORT);
  if (!/^\d{4,5}$/.test(requestedPort)) throw new Error("Invalid browser assurance port");
  const port = Number(requestedPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid browser assurance port");
  }
  return Object.freeze({ host: BROWSER_ASSURANCE_HOST, port, outputRoot });
}

export function isAllowedBrowserAssuranceRequest(method, pathname) {
  return (
    (method === "GET" || method === "HEAD") &&
    ["/", "/index.html", "/bundle.js", "/bundle.css"].includes(pathname)
  );
}

export async function cleanupBrowserAssuranceOutput() {
  assertContainedOutput();
  await rm(outputRoot, { recursive: true, force: true });
}

async function bundleGallery() {
  assertContainedOutput();
  await cleanupBrowserAssuranceOutput();
  await mkdir(outputRoot, { recursive: true });
  await build({
    entryPoints: [resolve(galleryRoot, "main.tsx")],
    outfile: resolve(outputRoot, "bundle.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["chrome120"],
    jsx: "automatic",
    nodePaths: [resolve(repositoryRoot, "frontend/web/node_modules")],
    sourcemap: false,
    legalComments: "none",
    define: { "process.env": '{"NODE_ENV":"test"}' },
  });
}

export async function startBrowserAssuranceServer(environment = process.env) {
  const configuration = resolveBrowserAssuranceConfiguration(environment);
  try {
    await bundleGallery();
    const index = await readFile(resolve(galleryRoot, "index.html"));
    const bundle = await readFile(resolve(outputRoot, "bundle.js"));
    const styles = await readFile(resolve(outputRoot, "bundle.css"));
    const assets = new Map([
      ["/", { body: index, type: "text/html; charset=utf-8" }],
      ["/index.html", { body: index, type: "text/html; charset=utf-8" }],
      ["/bundle.js", { body: bundle, type: "text/javascript; charset=utf-8" }],
      ["/bundle.css", { body: styles, type: "text/css; charset=utf-8" }],
    ]);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/invalid", `http://${BROWSER_ASSURANCE_HOST}`);
      if (!isAllowedBrowserAssuranceRequest(request.method, url.pathname) || url.search) {
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
        return;
      }
      const asset = assets.get(url.pathname);
      if (!asset) {
        response.writeHead(404, { "cache-control": "no-store" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": asset.type,
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : asset.body);
    });

    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(configuration.port, configuration.host, resolveListen);
    });
    const close = async () => {
      try {
        await new Promise((resolveClose) => server.close(resolveClose));
      } finally {
        await cleanupBrowserAssuranceOutput();
      }
    };
    return Object.freeze({
      close,
      origin: `http://${configuration.host}:${configuration.port}`,
    });
  } catch (error) {
    await cleanupBrowserAssuranceOutput();
    throw error;
  }
}
