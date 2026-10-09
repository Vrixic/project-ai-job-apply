import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const gallery = resolve(dirname(fileURLToPath(import.meta.url)), "gallery");
const output = resolve(root, ".tmp", "d3-browser-assurance");

function assertOutputBoundary() {
  if (!relative(root, output).startsWith(`.tmp${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("Browser assurance output must stay under .tmp");
  }
}

export async function startD3BrowserAssuranceServer() {
  assertOutputBoundary();
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: [resolve(gallery, "main.tsx")],
    outfile: resolve(output, "bundle.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["chrome120"],
    jsx: "automatic",
    nodePaths: [resolve(root, "frontend/web/node_modules")],
    sourcemap: false,
    legalComments: "none",
    define: { "process.env": '{"NODE_ENV":"test","NEXT_PUBLIC_APPLICATIONS_UI":"enabled"}' },
  });
  const assets = new Map([
    ["/", [await readFile(resolve(gallery, "index.html")), "text/html; charset=utf-8"]],
    [
      "/bundle.js",
      [await readFile(resolve(output, "bundle.js")), "text/javascript; charset=utf-8"],
    ],
    ["/bundle.css", [await readFile(resolve(output, "bundle.css")), "text/css; charset=utf-8"]],
  ]);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/invalid", "http://127.0.0.1");
    const asset = request.method === "GET" && !url.search ? assets.get(url.pathname) : undefined;
    if (!asset) {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": asset[1],
      "x-content-type-options": "nosniff",
    });
    response.end(asset[0]);
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(4177, "127.0.0.1", resolveListen);
  });
  return {
    origin: "http://127.0.0.1:4177",
    async close() {
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(output, { recursive: true, force: true });
    },
  };
}
