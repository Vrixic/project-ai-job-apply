import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  closes: [vi.fn(), vi.fn()],
  calls: 0,
  reconcile: vi.fn(),
  cipher: vi.fn(),
}));
vi.mock("./application-restore-reconciliation.js", () => ({
  reconcileApplicationRestore: state.reconcile,
}));
vi.mock("./restore-data-inventory-manifest.js", () => ({
  resolveRestoreDataManifest: () => ({ manifest: {}, sha256: "synthetic" }),
}));
vi.mock("./restore-verifier-runtime.js", () => ({
  resolveRestoreDatabaseUrl: () => "synthetic-url",
  createRestoreClient: () => ({ end: state.closes[state.calls++] }),
}));
const owningModule = fileURLToPath(
  new URL("../../applications/dist/src/legacy-receipt-restore-verifier.js", import.meta.url),
);
vi.doMock(owningModule, () => ({
  createLegacyReceiptRestoreVerifier: () => ({ verify: state.cipher }),
}));
vi.doMock(
  fileURLToPath(new URL("../../profile/dist/src/restore-candidate-admission.js", import.meta.url)),
  () => ({ verifyRestoreCandidateOwners: vi.fn() }),
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = 0;
});
async function run(failure?: number, enabled = true) {
  vi.resetModules();
  state.calls = 0;
  state.reconcile.mockReset().mockResolvedValue({ transitionReconciled: true });
  for (const [index, close] of state.closes.entries())
    close
      .mockReset()
      .mockImplementation(() =>
        failure === index ? Promise.reject(Error("private-close-details")) : Promise.resolve(),
      );
  const values = {
    RESTORE_APPLICATIONS_RECONCILIATION_ENABLED: enabled ? "true" : "false",
    RESTORE_DATA_MANIFEST_GZIP_BASE64: "synthetic-compressed",
    RESTORE_DATA_MANIFEST_SHA256: "synthetic-sha",
    RESTORE_LEGACY_RECEIPT_KEY_ARN: "synthetic-key",
    RESTORE_TRANSITION_STARTED_AT: "2026-01-01T00:00:00.000Z",
    RESTORE_TRANSITION_ENDED_AT: "2026-01-01T00:01:00.000Z",
    RESTORE_ORIGINAL_HOST:
      "ai-job-apply-development-restorecheck-latest.synthetic.us-east-2.rds.amazonaws.com",
    RESTORE_HOST:
      "ai-job-apply-development-restorecheck-historical.synthetic.us-east-2.rds.amazonaws.com",
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  const out = vi.spyOn(console, "log").mockImplementation(() => {}),
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  await import("./application-restore-reconciliation-cli.js");
  await vi.waitFor(() => expect(out.mock.calls.length + error.mock.calls.length).toBe(1));
  return { out, error };
}
it("defaults off before connections and emits only a fixed error", async () => {
  const { out, error } = await run(undefined, false);
  expect(state.calls).toBe(0);
  expect(out).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(
    '{"event":"application_restore_reconciliation_failed","error_code":"verification_failed"}',
  );
});
it.each([0, 1])(
  "suppresses success when close %s fails and still awaits both closes",
  async (index) => {
    const { out, error } = await run(index);
    expect(state.calls).toBe(2);
    for (const close of state.closes) expect(close).toHaveBeenCalledTimes(1);
    expect(out).not.toHaveBeenCalled();
    expect(error.mock.calls[0]?.[0]).not.toContain("private-close-details");
    expect(process.exitCode).toBe(1);
  },
);
it("prints success only after both connections close", async () => {
  const { out, error } = await run();
  expect(error).not.toHaveBeenCalled();
  for (const close of state.closes) expect(close).toHaveBeenCalledTimes(1);
  expect(out).toHaveBeenCalledWith(
    '{"event":"application_restore_reconciliation","result":{"transitionReconciled":true}}',
  );
});
