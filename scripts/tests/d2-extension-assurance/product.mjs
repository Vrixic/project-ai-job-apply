import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createReleaseArchive } from "../../../frontend/extension/package-release.mjs";

// Build the real product artifact without reading ignored workstation settings or
// replacing the configured unpacked extension. Browser traffic is blocked by the matrix.
const root = resolve(import.meta.dirname, "../../..");
const extensionRoot = join(root, "frontend", "extension");
const scratchRoot = join(extensionRoot, ".tmp");
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(join(scratchRoot, "product-assurance-"));
async function removeScratch() {
  if (!resolve(scratch).startsWith(`${resolve(scratchRoot)}${sep}`)) {
    throw new Error("Refusing cleanup outside the product-assurance scratch directory");
  }
  await rm(scratch, { recursive: true, force: true });
}
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.startsWith("EXTENSION_")) delete environment[key];
}
try {
  for (const name of [
    "build.mjs",
    "build-settings.mjs",
    "package.json",
    "entrypoints",
    "lib",
    "static",
  ]) {
    await cp(join(extensionRoot, name), join(scratch, name), { recursive: true });
  }
  execFileSync(process.execPath, [join(scratch, "build.mjs")], {
    cwd: scratch,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
    timeout: 60_000,
  });
  const metadata = JSON.parse(await readFile(join(scratch, "package.json"), "utf8"));
  const policy = JSON.parse(
    await readFile(join(extensionRoot, "store", "release-policy.v1.json"), "utf8"),
  );
  const archives = [];
  for (const name of ["first", "second"]) {
    archives.push(
      await createReleaseArchive({
        distDirectory: join(scratch, "dist"),
        outputDirectory: join(scratch, name),
        packageVersion: metadata.version,
        policy,
      }),
    );
  }
  if (archives[0].archive.sha256 !== archives[1].archive.sha256) {
    throw new Error("Product archive packaging is not deterministic");
  }
  process.stdout.write(
    `${JSON.stringify({ profile: "d2_product_archive_v1", packages: 2, files: archives[0].files.length, sha256: archives[0].archive.sha256, passed: true })}\n`,
  );
  execFileSync(process.execPath, [join(import.meta.dirname, "browser-matrix.mjs")], {
    cwd: root,
    env: {
      ...environment,
      D2_EXTENSION_DIST: join(scratch, "dist"),
      D2_EXTENSION_UI_MODE: "product",
    },
    stdio: "inherit",
    windowsHide: true,
    timeout: 300_000,
  });
} finally {
  await removeScratch();
}
