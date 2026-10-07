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
  "transport",
  "controls",
  "runtime",
  "runtime-read-sealed",
  "runtime-terminate",
  "runtime-revoked",
  "runtime-controls-failure",
  "runtime-bootstrap",
  "runtime-bootstrap-delayed",
  "runtime-bootstrap-revoked",
  "runtime-image",
  "runtime-image-read-sealed",
  "runtime-image-version-two",
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
      // This existing compiler image lacks optional raster-canvas dependencies. PDF text
      // verification does not draw a canvas. Accept only these exact source-only startup
      // diagnostics; any document warning, exception or arbitrary output still fails.
      const startup =
        'Warning: Cannot load "@napi-rs/canvas" package: "Error: Cannot find module \'@napi-rs/canvas\'\nRequire stack:\n- /native/fixture.mjs".\nWarning: Cannot polyfill `Path2D`, rendering may be broken.\n';
      const remainingDiagnostics = mode.startsWith("runtime")
        ? diagnostics.replace(startup, "")
        : diagnostics;
      assert.equal(
        remainingDiagnostics,
        "",
        "No content-derived or unrecognized diagnostics are allowed",
      );
      assert.ok(!output.includes("I have experience") && !output.includes("synthetic-secret"));
      if (
        [
          "idle",
          "busy",
          "suspend",
          "renew",
          "terminate",
          "cancel",
          "multiple",
          "transport",
          "controls",
          "runtime",
          "runtime-terminate",
          "runtime-bootstrap",
          "runtime-bootstrap-delayed",
          "runtime-image",
          "runtime-image-version-two",
        ].includes(mode)
      ) {
        const value = JSON.parse(output.trim());
        assert.equal(value.ready, true);
        assert.equal(value.providerCalls, 1);
        assert.equal(value.originalExpiry - value.originalCompletion, 1_800_000);
        assert.ok(
          Date.now() - value.originalCompletion <
            (mode === "transport" || mode.startsWith("runtime") ? 6000 : 2500),
          "Original kernel deadline exceeded test tolerance",
        );
        if (mode === "transport") assert.ok(value.transportAssertions >= 28);
        if (mode === "controls") assert.equal(value.controlInvocations, 3);
        if (mode.startsWith("runtime")) {
          assert.equal(value.controlInvocations, 3);
          assert.equal(value.actualFiles, 2);
        }
      }
      if (mode === "settlement") assert.equal(output, "settlement-pending\n");
      if (mode === "boot") assert.equal(output, "");
    } finally {
      clearTimeout(fallback);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
}

for (const mode of [
  "runtime-image-secret-refused",
  "runtime-image-tls-refused",
  "runtime-bootstrap-expired",
  "runtime-bootstrap-admission-refused",
  "runtime-bootstrap-ports-revoked",
]) {
  test(`bootstrap refuses ${mode} before content admission`, { timeout: 30_000 }, async () => {
    const child = spawn(
      process.execPath,
      [`${root}/fixture.mjs`, mode, `${root}/kernel-deadline.node`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exit = once(child, "exit");
    let output = "",
      diagnostics = "";
    child.stdout.setEncoding("utf8").on("data", (data) => {
      output += data;
    });
    child.stderr.setEncoding("utf8").on("data", (data) => {
      diagnostics += data;
    });
    const fallback = setTimeout(() => child.kill("SIGKILL"), 27_000);
    try {
      const [code, signal] = await exit;
      assert.equal(code, 0, diagnostics);
      assert.equal(signal, null);
      const startup =
        'Warning: Cannot load "@napi-rs/canvas" package: "Error: Cannot find module \'@napi-rs/canvas\'\nRequire stack:\n- /native/fixture.mjs".\nWarning: Cannot polyfill `Path2D`, rendering may be broken.\n';
      assert.equal(diagnostics.replace(startup, ""), "");
      if (mode.startsWith("runtime-image")) {
        assert.deepEqual(JSON.parse(output.trim()), {
          imageRefused: true,
          secretReads: 2,
          providerCalls: 0,
          controlInvocations: 0,
        });
      } else
        assert.deepEqual(JSON.parse(output.trim()), {
          bootstrapRefused: true,
          providerCalls: 0,
          controlInvocations: 0,
          metadataReads: 2,
          portLoads: mode === "runtime-bootstrap-ports-revoked" ? 1 : 0,
        });
    } finally {
      clearTimeout(fallback);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  });
}
