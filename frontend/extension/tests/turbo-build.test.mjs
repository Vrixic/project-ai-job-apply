import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const extensionRoot = new URL("../", import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../../", extensionRoot));
const publicBuildSettings = [
  "EXTENSION_API_ORIGIN",
  "EXTENSION_AUTH0_AUDIENCE",
  "EXTENSION_AUTH0_CLIENT_ID",
  "EXTENSION_AUTH0_DOMAIN",
  "EXTENSION_CAPABILITY_POLICY_PUBLIC_KEYS_JSON",
  "EXTENSION_DETECTOR_ACTIVATION_JSON",
  "EXTENSION_DEVELOPMENT_CONTRIBUTIONS",
  "EXTENSION_PENDING_RETENTION_HOURS",
  "EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION",
];

describe("workstation-configured extension build isolation", () => {
  it("disables only extension build caching and passes an exact public-settings allowlist", () => {
    const configuration = JSON.parse(readFileSync(new URL("turbo.json", extensionRoot), "utf8"));
    expect(configuration.extends).toEqual(["//"]);
    expect(Object.keys(configuration.tasks)).toEqual(["build"]);
    expect(configuration.tasks.build).toEqual({
      cache: false,
      passThroughEnv: publicBuildSettings,
    });
    const source = ["build.mjs", "build-settings.mjs"]
      .map((path) => readFileSync(new URL(path, extensionRoot), "utf8"))
      .join("\n");
    const consumedSettings = [...new Set(source.match(/\bEXTENSION_[A-Z0-9_]+\b/gu))].sort();
    expect(publicBuildSettings).toEqual(consumedSettings);
    expect(publicBuildSettings.every((name) => !/SECRET|TOKEN|PRIVATE|\*/u.test(name))).toBe(true);
  });

  it("resolves uncached strict-mode builds with all public settings and without private settings", () => {
    const environment = { ...process.env, TURBO_TELEMETRY_DISABLED: "1" };
    for (const name of Object.keys(environment)) {
      if (name.startsWith("EXTENSION_")) delete environment[name];
    }
    for (const name of publicBuildSettings) environment[name] = "synthetic-public-build-setting";
    environment.EXTENSION_DEVELOPMENT_CONTRIBUTIONS = "true";
    environment.EXTENSION_AUTH0_CLIENT_SECRET = "synthetic-excluded-secret";
    environment.EXTENSION_ACCESS_TOKEN = "synthetic-excluded-token";
    environment.EXTENSION_CAPABILITY_POLICY_PRIVATE_KEY = "synthetic-excluded-private-key";

    // A dry run resolves the installed Turbo configuration without building, reading .env.local,
    // contacting an API, changing dist, or logging environment values.
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          require.resolve("turbo"),
          "run",
          "build",
          "--filter=@ai-job-apply/extension",
          "--dry=json",
          "--env-mode=strict",
        ],
        {
          cwd: repositoryRoot,
          env: environment,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      ),
    );
    const extension = result.tasks.find((task) => task.taskId === "@ai-job-apply/extension#build");
    expect(extension.envMode).toBe("strict");
    expect(extension.resolvedTaskDefinition.cache).toBe(false);
    expect(extension.resolvedTaskDefinition.passThroughEnv).toEqual(publicBuildSettings);
    expect(extension.resolvedTaskDefinition.dependsOn).toEqual(["^build"]);
    const passedNames = extension.environmentVariables.passthrough.map(
      (value) => value.split("=")[0],
    );
    expect(passedNames.sort()).toEqual(publicBuildSettings);
    expect(passedNames).not.toContain("EXTENSION_AUTH0_CLIENT_SECRET");
    expect(passedNames).not.toContain("EXTENSION_ACCESS_TOKEN");
    expect(passedNames).not.toContain("EXTENSION_CAPABILITY_POLICY_PRIVATE_KEY");
    const dependency = result.tasks.find(
      (task) => task.taskId === "@ai-job-apply/api-contracts#build",
    );
    expect(dependency.resolvedTaskDefinition.cache).toBe(true);
    expect(dependency.environmentVariables.passthrough ?? []).toEqual([]);
  }, 35_000);
});
