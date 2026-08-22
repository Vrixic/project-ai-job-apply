import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const ADMIN_ASSURANCE_HOST = "127.0.0.1";
export const ADMIN_ASSURANCE_MODE = "generated-synthetic";
export const DEFAULT_ADMIN_ASSURANCE_PORT = 4177;

const harnessRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(harnessRoot, "../../..");
const galleryRoot = resolve(harnessRoot, "gallery");
const outputRoot = resolve(repositoryRoot, ".tmp", "d1-admin-browser-assurance");

function assertContainedOutput() {
  const output = relative(repositoryRoot, outputRoot);
  if (!output.startsWith(`.tmp${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Admin browser assurance output must remain under .tmp");
  }
}

export function resolveAdminAssuranceConfiguration(environment = process.env) {
  if (environment.NODE_ENV !== "test")
    throw new Error("NODE_ENV must equal test; refusing to start");
  if (environment.D1_ADMIN_ASSURANCE_MODE !== ADMIN_ASSURANCE_MODE) {
    throw new Error("D1_ADMIN_ASSURANCE_MODE must equal generated-synthetic; refusing to start");
  }
  const requestedPort = environment.D1_ADMIN_ASSURANCE_PORT ?? String(DEFAULT_ADMIN_ASSURANCE_PORT);
  if (!/^\d{4,5}$/.test(requestedPort)) throw new Error("Invalid admin assurance port");
  const port = Number(requestedPort);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid admin assurance port");
  }
  return Object.freeze({ host: ADMIN_ASSURANCE_HOST, outputRoot, port });
}

export function isAllowedAdminAssuranceRequest(method, pathname) {
  return (
    (method === "GET" || method === "HEAD") &&
    ["/", "/index.html", "/bundle.js", "/bundle.css"].includes(pathname)
  );
}

export async function cleanupAdminAssuranceOutput() {
  assertContainedOutput();
  await rm(outputRoot, { force: true, recursive: true });
}

async function bundleGallery() {
  assertContainedOutput();
  await cleanupAdminAssuranceOutput();
  await mkdir(outputRoot, { recursive: true });
  await build({
    bundle: true,
    define: { "process.env.NODE_ENV": '"test"' },
    entryPoints: [resolve(galleryRoot, "main.tsx")],
    format: "esm",
    jsx: "automatic",
    legalComments: "none",
    nodePaths: [resolve(repositoryRoot, "frontend/admin/node_modules")],
    outfile: resolve(outputRoot, "bundle.js"),
    platform: "browser",
    sourcemap: false,
    target: ["chrome120"],
  });
}

export async function startAdminAssuranceServer(environment = process.env) {
  const configuration = resolveAdminAssuranceConfiguration(environment);
  try {
    await bundleGallery();
    const assets = new Map([
      [
        "/",
        {
          body: await readFile(resolve(galleryRoot, "index.html")),
          type: "text/html; charset=utf-8",
        },
      ],
      [
        "/index.html",
        {
          body: await readFile(resolve(galleryRoot, "index.html")),
          type: "text/html; charset=utf-8",
        },
      ],
      [
        "/bundle.js",
        {
          body: await readFile(resolve(outputRoot, "bundle.js")),
          type: "text/javascript; charset=utf-8",
        },
      ],
      [
        "/bundle.css",
        {
          body: await readFile(resolve(outputRoot, "bundle.css")),
          type: "text/css; charset=utf-8",
        },
      ],
    ]);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/invalid", `http://${ADMIN_ASSURANCE_HOST}`);
      if (!isAllowedAdminAssuranceRequest(request.method, url.pathname) || url.search) {
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
    return Object.freeze({
      close: async () => {
        try {
          await new Promise((resolveClose) => server.close(resolveClose));
        } finally {
          await cleanupAdminAssuranceOutput();
        }
      },
      origin: `http://${configuration.host}:${configuration.port}`,
    });
  } catch (error) {
    await cleanupAdminAssuranceOutput();
    throw error;
  }
}
