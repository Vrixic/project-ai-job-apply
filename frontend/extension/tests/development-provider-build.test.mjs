import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const scratchRoot = fileURLToPath(new URL("../.tmp/", import.meta.url));
const roots = [];

async function fixture() {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, "extension-provider-build-"));
  roots.push(root);
  for (const name of [
    "build.mjs",
    "build-settings.mjs",
    "package.json",
    "entrypoints",
    "lib",
    "static",
  ]) {
    await cp(join(extensionRoot, name), join(root, name), { recursive: true });
  }
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("EXTENSION_")) delete environment[name];
  }
  Object.assign(environment, {
    EXTENSION_AUTH0_DOMAIN: "tenant.example.test",
    EXTENSION_AUTH0_CLIENT_ID: "synthetic-public-client",
    EXTENSION_AUTH0_AUDIENCE: "ai-job-apply-api",
    EXTENSION_API_ORIGIN: "https://api.example.test",
    EXTENSION_PENDING_RETENTION_HOURS: "24",
    EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION: "synthetic-authorization-v1",
    EXTENSION_DEVELOPMENT_CONTRIBUTIONS: "true",
  });
  return {
    root,
    environment,
    build() {
      return execFileSync(process.execPath, [join(root, "build.mjs")], {
        cwd: root,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 30_000,
      });
    },
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      !resolve(root).startsWith(`${resolve(scratchRoot)}\\`) &&
      !resolve(root).startsWith(`${resolve(scratchRoot)}/`)
    ) {
      throw new Error("Refusing cleanup outside the exact scratch root");
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("isolated real extension provider builds", () => {
  it.each([
    { name: "default Greenhouse", value: undefined, expected: ["greenhouse"] },
    { name: "Lever", value: '["lever"]', expected: ["lever"] },
    { name: "Ashby", value: '["ashby"]', expected: ["ashby"] },
    {
      name: "all fixed providers",
      value: '["greenhouse","lever","ashby"]',
      expected: ["ashby", "greenhouse", "lever"],
    },
    { name: "explicit deny all", value: "[]", expected: [] },
  ])(
    "builds $name without adding any provider host permission",
    async ({ value, expected }) => {
      const candidate = await fixture();
      if (value !== undefined)
        candidate.environment.EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON = value;
      candidate.build();
      const manifest = JSON.parse(
        await readFile(join(candidate.root, "dist/manifest.json"), "utf8"),
      );
      expect(manifest.version).toBe("0.2.0");
      expect(manifest.version_name).toBe("0.2.0-development-contributions");
      expect(manifest.host_permissions).toEqual([
        "https://tenant.example.test/*",
        "https://api.example.test/*",
      ]);
      expect(manifest.content_scripts).toBeUndefined();
      const background = await readFile(join(candidate.root, "dist/background.js"), "utf8");
      expect(background).toContain("UNPACKED_DEVELOPMENT_CONTRIBUTIONS_ONLY");
      expect(background.includes("typeof __DEVELOPMENT_CONTRIBUTION_PROVIDERS__")).toBe(false);
      // Esbuild emits the injected immutable-list input under this stable generated name.
      const selected = /var define_DEVELOPMENT_CONTRIBUTION_PROVIDERS_default = (\[[^;]*\]);/u.exec(
        background,
      );
      expect(selected).not.toBeNull();
      expect(JSON.parse(selected[1])).toEqual(expected);
    },
    35_000,
  );

  it("refuses signed builds with an explicit provider selection before touching generated artifacts", async () => {
    const candidate = await fixture();
    candidate.environment.EXTENSION_DEVELOPMENT_CONTRIBUTIONS = "false";
    candidate.environment.EXTENSION_DEVELOPMENT_CONTRIBUTION_PROVIDERS_JSON = "[]";
    await mkdir(join(candidate.root, "dist"));
    await writeFile(join(candidate.root, "dist/sentinel.txt"), "preserve existing build");
    expect(() => candidate.build()).toThrow("require explicit unpacked development mode");
    expect(await readFile(join(candidate.root, "dist/sentinel.txt"), "utf8")).toBe(
      "preserve existing build",
    );
  }, 35_000);
});
