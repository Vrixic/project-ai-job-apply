import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { ZipFile } from "yazl";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const entryPoint = path.join(
  repositoryRoot,
  "backend/workflows/dist/src/serverless-outbox-lambda.js",
);
const outputDirectory = path.join(repositoryRoot, "backend/workflows/dist/lambda");
const artifactPath = path.join(outputDirectory, "workflow-ingress-lambda.zip");
const bundlePath = path.join(outputDirectory, "index.mjs");
const sbomPath = path.join(outputDirectory, "workflow-ingress-lambda.cdx.json");
const manifestPath = path.join(outputDirectory, "workflow-ingress-lambda.manifest.json");
const checksumPath = path.join(outputDirectory, "workflow-ingress-lambda.sha256");
const fixedZipDate = new Date("1980-01-01T00:00:00.000Z");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(hexDigest) {
  const characters = hexDigest.slice(0, 32).split("");
  characters[12] = "5";
  characters[16] = ((Number.parseInt(characters[16], 16) & 0x3) | 0x8).toString(16);
  const value = characters.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function licenseObject(expression) {
  return /^[A-Za-z0-9-.+]+$/.test(expression)
    ? { license: { id: expression } }
    : { license: { name: expression } };
}

function componentInventory(metafile) {
  const argumentsList = [
    "--filter",
    "@ai-job-apply/workflows...",
    "licenses",
    "list",
    "--prod",
    "--json",
  ];
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const executableArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm ${argumentsList.join(" ")}`]
      : argumentsList;
  const licenses = JSON.parse(
    execFileSync(executable, executableArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const inputs = Object.keys(metafile.inputs).map((input) =>
    path.resolve(repositoryRoot, input).replaceAll("\\", "/"),
  );
  const components = new Map();
  for (const [license, packages] of Object.entries(licenses)) {
    for (const packageEntry of packages) {
      for (const version of packageEntry.versions) {
        const included = packageEntry.paths.some((packagePath) => {
          const normalized = path.resolve(packagePath).replaceAll("\\", "/");
          return inputs.some((input) => input.startsWith(`${normalized}/`));
        });
        if (!included) {
          continue;
        }
        const purl = `pkg:npm/${encodeURIComponent(packageEntry.name).replace("%2F", "/")}@${encodeURIComponent(version)}`;
        components.set(purl, {
          type: "library",
          name: packageEntry.name,
          version,
          licenses: [licenseObject(license)],
          purl,
          "bom-ref": purl,
        });
      }
    }
  }
  return [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl));
}

async function zipBundle(bundle) {
  const archive = new ZipFile();
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    archive.outputStream.on("data", (chunk) => chunks.push(chunk));
    archive.outputStream.once("error", reject);
    archive.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
  archive.addBuffer(bundle, "index.mjs", {
    mtime: fixedZipDate,
    mode: 0o100644,
    compress: true,
  });
  archive.end();
  return complete;
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [entryPoint],
  absWorkingDir: repositoryRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  write: false,
  metafile: true,
  minify: false,
  legalComments: "none",
  treeShaking: true,
});
if (result.outputFiles.length !== 1 || !result.outputFiles[0]) {
  throw new Error("Expected exactly one bundled workflow-ingress Lambda output file");
}

const bundle = Buffer.from(result.outputFiles[0].contents);
const bundleSha256 = sha256(bundle);
const archive = await zipBundle(bundle);
const artifactSha256 = sha256(archive);
const components = componentInventory(result.metafile);
const applicationPurl = "pkg:npm/%40ai-job-apply/workflow-ingress-lambda@0.1.0";
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${deterministicUuid(artifactSha256)}`,
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: "@ai-job-apply/workflow-ingress-lambda",
      version: "0.1.0",
      hashes: [{ alg: "SHA-256", content: bundleSha256 }],
      purl: applicationPurl,
      "bom-ref": applicationPurl,
    },
  },
  components,
};
const sbomContent = `${JSON.stringify(sbom, null, 2)}\n`;
const manifest = {
  schemaVersion: 1,
  runtime: "nodejs24.x",
  architecture: "x86_64",
  handlers: ["index.starter", "index.reconcile"],
  artifact: path.basename(artifactPath),
  artifactBytes: archive.length,
  artifactSha256,
  artifactBase64Sha256: Buffer.from(artifactSha256, "hex").toString("base64"),
  bundleSha256,
  sbom: path.basename(sbomPath),
  sbomSha256: sha256(sbomContent),
  componentCount: components.length,
};

await Promise.all([
  writeFile(bundlePath, bundle),
  writeFile(artifactPath, archive),
  writeFile(sbomPath, sbomContent, "utf8"),
  writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  writeFile(checksumPath, `${artifactSha256}  ${path.basename(artifactPath)}\n`, "utf8"),
]);

process.stdout.write(
  `${JSON.stringify({ artifactSha256, artifactBytes: archive.length, componentCount: components.length })}\n`,
);
