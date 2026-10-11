import { describe, expect, it } from "vitest";
import {
  loadReconciledCopyEnvironment,
  validateReconciledCopyRequest,
} from "./candidate-deletion-reconciled-copy-contract.js";
import { reconciledRuntimeFixture } from "./candidate-deletion-reconciled-copy-runtime.fixture.js";

describe("fresh read-only reconciled-copy admission", () => {
  it("accepts fresh authority with a separately expired historical replay", () => {
    const f = reconciledRuntimeFixture();
    const admission = loadReconciledCopyEnvironment(f.environment, f.now);
    expect(admission.configuration.sourceSha).toBe(f.environment.RELEASE_SHA);
    expect(
      validateReconciledCopyRequest(
        f.request,
        admission.configuration,
        admission.configurationSha256,
        f.context,
      ),
    ).toEqual(f.request);
  });
  it.each(["RELEASE_SHA", "RECONCILED_COPY_CONFIG_SHA256", "DATABASE_SECRET_ID"])(
    "rejects a substituted %s",
    (key) => {
      const f = reconciledRuntimeFixture();
      f.environment[key] = "f".repeat(64);
      expect(() => loadReconciledCopyEnvironment(f.environment, f.now)).toThrow(
        "AdmissionRejected",
      );
    },
  );
  it.each([
    "DATABASE_URL",
    "RESTORE_CONFIG_JSON",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "AWS_ENDPOINT_URL",
  ])("rejects injected %s", (key) => {
    const f = reconciledRuntimeFixture();
    f.environment[key] = "synthetic";
    expect(() => loadReconciledCopyEnvironment(f.environment, f.now)).toThrow("AdmissionRejected");
  });
  it.each(["2026-10-10T23:59:59.000Z", "2026-10-11T00:29:00.000Z", "2026-10-11T00:31:00.000Z"])(
    "rejects issuance/expiry outside authority at %s",
    (now) => {
      const f = reconciledRuntimeFixture();
      expect(() => loadReconciledCopyEnvironment(f.environment, new Date(now))).toThrow(
        "AdmissionRejected",
      );
    },
  );
  it("binds the release even when the environment checksum is recomputed", () => {
    const f = reconciledRuntimeFixture();
    f.environment.RELEASE_SHA = "9".repeat(40);
    f.seal();
    expect(() => loadReconciledCopyEnvironment(f.environment, f.now)).toThrow("AdmissionRejected");
  });
  it.each(["action", "runId", "configurationSha256", "functionVersion"])(
    "rejects stale or replay request %s",
    (key) => {
      const f = reconciledRuntimeFixture();
      expect(() =>
        validateReconciledCopyRequest(
          { ...f.request, [key]: "replay" },
          f.configuration,
          f.environment.RECONCILED_COPY_CONFIG_SHA256 ?? "",
          f.context,
        ),
      ).toThrow("AdmissionRejected");
    },
  );
  it("rejects substituted historical receipt, alias invocation and unreviewed fields", () => {
    const f = reconciledRuntimeFixture();
    for (const request of [
      { ...f.request, originalReceipt: { ...f.originalReceipt, sourceSha: "8".repeat(40) } },
      { ...f.request, extra: true },
    ]) {
      expect(() =>
        validateReconciledCopyRequest(
          request,
          f.configuration,
          f.environment.RECONCILED_COPY_CONFIG_SHA256 ?? "",
          f.context,
        ),
      ).toThrow("AdmissionRejected");
    }
    expect(() =>
      validateReconciledCopyRequest(
        f.request,
        f.configuration,
        f.environment.RECONCILED_COPY_CONFIG_SHA256 ?? "",
        { ...f.context, functionVersion: "$LATEST" },
      ),
    ).toThrow("AdmissionRejected");
  });
});
