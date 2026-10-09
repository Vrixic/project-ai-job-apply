import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const turboRequire = createRequire(require.resolve("turbo/package.json"));
const platform = process.platform === "win32" ? "windows" : process.platform;
const architecture = process.arch === "x64" ? "64" : process.arch;
// Resolve the installed native binary directly: the wrapper may install a missing binary.
const turboBinary = turboRequire.resolve(
  `@turbo/${platform}-${architecture}/bin/turbo${process.platform === "win32" ? ".exe" : ""}`,
);
const indexingVariable = "PUBLIC_JOB_INDEXING_ENABLED";
const brandingVariable = "NEXT_PUBLIC_PRODUCT_BRAND_NAME";
const runtimeVariables = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "AUTH0_AUDIENCE",
  "APP_BASE_URL",
  "PLATFORM_API_BASE_URL",
  "NATIVE_MATERIAL_LOGOUT_ENABLED",
] as const;

interface EnvironmentReport {
  configured: string[] | null;
  inferred: string[] | null;
  passthrough: string[] | null;
}

interface TaskReport {
  taskId: string;
  hash: string;
  command: string;
  framework: string;
  envMode: string;
  dependencies: string[];
  resolvedTaskDefinition: {
    cache: boolean;
    dependsOn: string[];
    env: string[];
    outputs: string[];
    passThroughEnv: string[] | null;
  };
  environmentVariables: EnvironmentReport;
}

interface DryRunReport {
  envMode: string;
  frameworkInference: boolean;
  globalCacheInputs: { environmentVariables: EnvironmentReport };
  tasks: TaskReport[];
}

function environmentNames(report: EnvironmentReport): string[] {
  return [report.configured, report.inferred, report.passthrough]
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.split("=", 1)[0] as string)
    .sort();
}

function inspectBuild(
  indexing: "false" | "true" | undefined,
  options: { branding?: string; runtimeGeneration?: number } = {},
) {
  // Only OS process prerequisites are inherited. No workstation credentials, .env values,
  // remote-cache configuration or user-profile path enters this synthetic dry run.
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    CI: "1",
    DO_NOT_TRACK: "1",
    TURBO_TELEMETRY_DISABLED: "1",
    [brandingVariable]: options.branding ?? "Synthetic Build Fixture",
  };
  for (const name of [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "ComSpec",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  if (indexing !== undefined) environment[indexingVariable] = indexing;
  for (const name of runtimeVariables) {
    environment[name] = `synthetic-unused-${options.runtimeGeneration ?? 0}`;
  }

  let report: DryRunReport;
  try {
    const output = execFileSync(
      turboBinary,
      [
        "run",
        "build",
        "--filter=@ai-job-apply/web",
        "--dry-run=json",
        "--env-mode=strict",
        "--cache=local:r",
        "--no-daemon",
      ],
      {
        cwd: repositoryRoot,
        env: environment,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        windowsHide: true,
      },
    );
    report = JSON.parse(output) as DryRunReport;
  } catch {
    // Never attach the subprocess error, stdout or stderr to test output.
    throw new Error("Synthetic web Turbo dry run failed");
  }
  return {
    envMode: report.envMode,
    frameworkInference: report.frameworkInference,
    globalEnvironmentNames: environmentNames(report.globalCacheInputs.environmentVariables),
    tasks: report.tasks.map((task) => ({
      taskId: task.taskId,
      hash: task.hash,
      command: task.command,
      framework: task.framework,
      envMode: task.envMode,
      dependencies: task.dependencies,
      resolvedTaskDefinition: task.resolvedTaskDefinition,
      environmentNames: environmentNames(task.environmentVariables),
    })),
  };
}

type BuildInspection = ReturnType<typeof inspectBuild>;

function webTask(report: BuildInspection) {
  const task = report.tasks.find(({ taskId }) => taskId === "@ai-job-apply/web#build");
  if (!task) throw new Error("Synthetic web Turbo dry run omitted the web build");
  return task;
}

describe("candidate web Turbo build inputs", () => {
  let unset: BuildInspection;
  let disabled: BuildInspection;
  let enabled: BuildInspection;
  let changedRuntime: BuildInspection;
  let changedBranding: BuildInspection;

  beforeAll(() => {
    unset = inspectBuild(undefined);
    disabled = inspectBuild("false");
    enabled = inspectBuild("true");
    changedRuntime = inspectBuild("false", { runtimeGeneration: 1 });
    changedBranding = inspectBuild("false", { branding: "Other Synthetic Build Fixture" });
  }, 120_000);

  it("hashes the web-only crawler setting for unset, false and true", () => {
    expect(new Set([unset, disabled, enabled].map((report) => webTask(report).hash)).size).toBe(3);
    for (const report of [unset, disabled, enabled]) {
      expect(report.envMode).toBe("strict");
      expect(webTask(report).resolvedTaskDefinition.env).toEqual([indexingVariable]);
      expect(webTask(report).resolvedTaskDefinition.passThroughEnv ?? []).toEqual([]);
      expect(report.globalEnvironmentNames).not.toContain(indexingVariable);
      for (const task of report.tasks.filter(({ taskId }) => taskId !== webTask(report).taskId)) {
        expect(task.environmentNames).not.toContain(indexingVariable);
        expect(task.hash).toBe(unset.tasks.find(({ taskId }) => taskId === task.taskId)?.hash);
      }
    }
    expect(webTask(unset).environmentNames).not.toContain(indexingVariable);
    expect(webTask(disabled).environmentNames).toContain(indexingVariable);
    expect(webTask(enabled).environmentNames).toContain(indexingVariable);
  });

  it("inherits the existing build command, dependency graph and outputs", () => {
    const root = JSON.parse(readFileSync(new URL("../../turbo.json", import.meta.url), "utf8")) as {
      tasks: { build: { dependsOn: string[]; outputs: string[] } };
    };
    const task = webTask(disabled);
    expect(task.command).toBe("next build");
    expect(task.resolvedTaskDefinition.cache).toBe(true);
    expect(task.resolvedTaskDefinition.dependsOn).toEqual(root.tasks.build.dependsOn);
    expect(task.resolvedTaskDefinition.outputs).toEqual([...root.tasks.build.outputs].sort());
    expect(task.dependencies).toEqual([
      "@ai-job-apply/api-contracts#build",
      "@ai-job-apply/ats-sdk#build",
      "@ai-job-apply/config#build",
    ]);
  });

  it("does not forward or hash runtime Auth0, session and API settings", () => {
    for (const report of [disabled, changedRuntime]) {
      for (const name of runtimeVariables) {
        expect(report.globalEnvironmentNames).not.toContain(name);
        for (const task of report.tasks) expect(task.environmentNames).not.toContain(name);
      }
      expect(report.tasks.map(({ taskId, hash }) => ({ taskId, hash }))).toEqual(
        disabled.tasks.map(({ taskId, hash }) => ({ taskId, hash })),
      );
    }
  });

  it("preserves Next.js public-variable framework inference", () => {
    expect(disabled.frameworkInference).toBe(true);
    expect(webTask(disabled).framework).toBe("nextjs");
    expect(webTask(disabled).environmentNames).toContain(brandingVariable);
    expect(webTask(changedBranding).hash).not.toBe(webTask(disabled).hash);
  });
});
