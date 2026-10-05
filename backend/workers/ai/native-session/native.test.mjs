import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import test from "node:test";

const root = "/native";
for (const mode of [
  "idle",
  "busy",
  "suspend",
  "settlement",
  "boot",
  "renew",
  "terminate",
  "cancel",
  "multiple",
  "future",
  "expired",
  "oversize",
  "invalid",
  "reload",
  "worker",
]) {
  test(`kernel retires the actual ${mode} content process`, { timeout: 10_000 }, async () => {
    const started = performance.now();
    const child = spawn(
      process.execPath,
      [`${root}/fixture.mjs`, mode, `${root}/kernel-deadline.node`],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let diagnostics = "";
    const exit = once(child, "exit");
    child.stdout.setEncoding("utf8").on("data", (data) => {
      output += data;
      if (mode === "suspend" && output.includes('"ready":true')) child.kill("SIGSTOP");
    });
    child.stderr.setEncoding("utf8").on("data", (data) => {
      diagnostics += data;
    });
    const fallback = setTimeout(() => child.kill("SIGKILL"), 8_000);
    try {
      const [code, signal] = await exit;
      const elapsed = performance.now() - started;
      assert.equal(code, null, diagnostics);
      assert.equal(signal, "SIGKILL", diagnostics);
      assert.ok(elapsed < 7_000, `Kernel did not retire ${mode} before parent fallback`);
      assert.equal(diagnostics, "", "No sensitive diagnostic output is allowed");
      assert.ok(!output.includes("I have experience") && !output.includes("synthetic-secret"));
      if (["idle", "busy", "suspend", "renew", "terminate", "cancel", "multiple"].includes(mode)) {
        const value = JSON.parse(output.trim());
        assert.equal(value.ready, true);
        assert.equal(value.providerCalls, 1);
        assert.equal(value.originalExpiry - value.originalCompletion, 1_800_000);
        assert.ok(
          Date.now() - value.originalCompletion < 2500,
          "Original kernel deadline exceeded test tolerance",
        );
      }
      if (mode === "settlement") assert.equal(output, "settlement-pending\n");
      if (mode === "boot") assert.equal(output, "");
    } finally {
      clearTimeout(fallback);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
}
