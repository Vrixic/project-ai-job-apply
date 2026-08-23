import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ZipFile } from "yazl";

const fixedZipDate = new Date("1980-01-01T00:00:00.000Z");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitOutput(repositoryRoot, argumentsList) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "git";
  const executableArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `git ${argumentsList.join(" ")}`]
      : argumentsList;
  return execFileSync(executable, executableArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
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

function componentInventory(repositoryRoot, packageFilter, metafile) {
  const argumentsList = ["--filter", packageFilter, "licenses", "list", "--prod", "--json"];
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

async function verifyBundleExports(
  outputDirectory,
  artifactName,
  bundle,
  bundleSha256,
  handlers,
  verifyBundle,
) {
  const verificationPath = path.join(
    outputDirectory,
    `.${artifactName}.verify-${process.pid}-${bundleSha256}.mjs`,
  );
  await writeFile(verificationPath, bundle);
  try {
    const moduleUrl = pathToFileURL(verificationPath);
    moduleUrl.searchParams.set("sha256", bundleSha256);
    const bundleModule = await import(moduleUrl.href);
    for (const handler of handlers) {
      const exportName = handler.split(".").at(-1);
      const exportedHandler = exportName ? bundleModule[exportName] : undefined;
      if (!exportName || typeof exportedHandler !== "function") {
        throw new Error(`Lambda bundle does not export handler ${handler}`);
      }
      if (exportedHandler.length > 2) {
        throw new Error(
          `Lambda bundle handler ${handler} exposes a callback signature unsupported by Node.js 24`,
        );
      }
    }
    await verifyBundle?.(bundleModule);
  } finally {
    await rm(verificationPath, { force: true });
  }
}

export async function buildLambdaArtifact({
  repositoryRoot,
  entryPoint,
  outputDirectory,
  artifactName,
  applicationName,
  handlers,
  packageFilter,
  external = [],
  verifyBundle,
}) {
  const sourceSha = process.env.ARTIFACT_SOURCE_SHA ?? "local";
  if (!/^(?:local|[a-f0-9]{40})$/.test(sourceSha)) {
    throw new Error("ARTIFACT_SOURCE_SHA must be local or an exact lowercase Git commit SHA");
  }
  if (sourceSha !== "local") {
    const headSha = gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
    const checkoutStatus = gitOutput(repositoryRoot, ["status", "--porcelain"]);
    if (headSha !== sourceSha || checkoutStatus) {
      throw new Error(
        "Committed artifact provenance requires the exact clean ARTIFACT_SOURCE_SHA checkout",
      );
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: repositoryRoot,
    bundle: true,
    format: "esm",
    banner: {
      js: `/* applydash-artifact-source:${sourceSha} */\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);`,
    },
    platform: "node",
    target: "node24",
    write: false,
    metafile: true,
    minify: false,
    legalComments: "none",
    treeShaking: true,
    external,
  });
  if (result.outputFiles.length !== 1 || !result.outputFiles[0]) {
    throw new Error(`Expected exactly one bundled output for ${artifactName}`);
  }

  const bundle = Buffer.from(result.outputFiles[0].contents);
  const bundleSha256 = sha256(bundle);
  await verifyBundleExports(
    outputDirectory,
    artifactName,
    bundle,
    bundleSha256,
    handlers,
    verifyBundle,
  );
  const archive = await zipBundle(bundle);
  const artifactSha256 = sha256(archive);
  const components = componentInventory(repositoryRoot, packageFilter, result.metafile);
  const encodedName = encodeURIComponent(applicationName).replace("%2F", "/");
  const applicationPurl = `pkg:npm/${encodedName}@0.1.0`;
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${deterministicUuid(artifactSha256)}`,
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: applicationName,
        version: "0.1.0",
        hashes: [{ alg: "SHA-256", content: bundleSha256 }],
        purl: applicationPurl,
        "bom-ref": applicationPurl,
      },
    },
    components,
  };
  const sbomContent = `${JSON.stringify(sbom, null, 2)}\n`;
  const artifactFileName = `${artifactName}.zip`;
  const sbomFileName = `${artifactName}.cdx.json`;
  const manifest = {
    schemaVersion: 2,
    sourceSha,
    runtime: "nodejs24.x",
    architecture: "x86_64",
    handlers,
    artifact: artifactFileName,
    artifactBytes: archive.length,
    artifactSha256,
    artifactBase64Sha256: Buffer.from(artifactSha256, "hex").toString("base64"),
    bundleSha256,
    sbom: sbomFileName,
    sbomSha256: sha256(sbomContent),
    componentCount: components.length,
  };

  await Promise.all([
    writeFile(path.join(outputDirectory, `${artifactName}.mjs`), bundle),
    writeFile(path.join(outputDirectory, artifactFileName), archive),
    writeFile(path.join(outputDirectory, sbomFileName), sbomContent, "utf8"),
    writeFile(
      path.join(outputDirectory, `${artifactName}.manifest.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, `${artifactName}.sha256`),
      `${artifactSha256}  ${artifactFileName}\n`,
      "utf8",
    ),
  ]);

  return {
    artifact: artifactFileName,
    artifactSha256,
    artifactBytes: archive.length,
    componentCount: components.length,
  };
}
