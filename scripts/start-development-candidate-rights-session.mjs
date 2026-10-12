import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  parseCandidateRightsEnvironment,
  startCandidateRightsSession,
} from "./lib/candidate-rights-session.mjs";
import {
  buildIdentityAttestation,
  runSessionOperator,
  sanitizeMissingCoverage,
  validateSessionCommand,
} from "./lib/candidate-rights-session-operator.mjs";

if (process.argv.length > 2) {
  console.log(
    "Usage: node scripts/start-development-candidate-rights-session.mjs\nReads only the existing candidate web identity settings. Opens a loopback sign-in handoff, not a browser-cookie collector. After private disposable-account confirmation, the operator supplies reviewed plan/execute commands through stdin. No candidate data is changed by sign-in or planning. See the candidate-rights acceptance runbook.",
  );
  process.exit(process.argv.length === 3 && process.argv[2] === "--help" ? 0 : 2);
}

let identity;
let clientSecret;
let attestationJson;
let identityExpiryTimer;
let session;
let plan;
let planOptions;
let busy = false;
let executionAttempted = false;
let closing = false;
let closeAfterAction = false;
const input = createInterface({ input: process.stdin, terminal: false });
const report = (outcome, extra = {}) => console.log(JSON.stringify({ outcome, ...extra }));

async function close() {
  if (closing) return;
  closing = true;
  identity = undefined;
  attestationJson = undefined;
  clearTimeout(identityExpiryTimer);
  clientSecret = undefined;
  plan = undefined;
  planOptions = undefined;
  input.close();
  await session?.close();
}

try {
  const configuration = parseCandidateRightsEnvironment(
    await readFile(fileURLToPath(new URL("../frontend/web/.env.local", import.meta.url)), "utf8"),
  );
  clientSecret = configuration.clientSecret;
  session = await startCandidateRightsSession({
    ...configuration,
    onDiagnostic(diagnostic) {
      report("local-sign-in-request-rejected", { diagnostic, candidateDataChanged: false });
    },
    async onConfirmed(confirmed) {
      if (identity || closing) throw new Error("session_already_bound");
      const attestation = buildIdentityAttestation(confirmed);
      attestationJson = JSON.stringify(attestation);
      identity = confirmed;
      identityExpiryTimer = setTimeout(
        () => {
          closeAfterAction = true;
          if (!busy) void close();
        },
        Math.max(1, Date.parse(attestation.expiresAt) - Date.now()),
      );
      report("disposable-account-confirmed", {
        tokensRetainedOnDisk: false,
        candidateDataChanged: false,
      });
    },
    onClosed({ reason }) {
      if (reason === "confirmed") return; // HTTP server closes; confirmed memory-only operator session continues.
      if (busy) {
        closeAfterAction = true;
        return;
      } // Never silently retry an in-flight Execute.
      void close(); // Do not await this callback's own server-close promise recursively.
    },
  });
  report("waiting-for-disposable-sign-in", { url: session.url, candidateDataChanged: false });
} catch {
  report("session-unavailable-check-candidate-settings-and-port-3000");
  await close();
  process.exitCode = 1;
}

input.on("line", async (line) => {
  if (busy || closing) {
    report("session-busy-or-closed");
    return;
  }
  busy = true;
  try {
    if (line.length > 16384) throw new Error("invalid_session_command");
    const command = validateSessionCommand(JSON.parse(line));
    if (command.action === "cancel") {
      await close();
      return;
    }
    if (!identity || !attestationJson) {
      report("disposable-sign-in-required");
      return;
    }
    if (
      Date.now() >=
      Math.min(Date.parse(identity.expiresAt), Date.parse(identity.authTime) + 900_000)
    ) {
      report("fresh-disposable-sign-in-required");
      await close();
      return;
    }
    if (executionAttempted) {
      report("execution-already-attempted-check-recovery");
      return;
    }
    if (command.action === "execute" && (!plan || command.reviewedPlanSha256 !== plan.PlanSha256)) {
      report("exact-reviewed-plan-required");
      return;
    }
    if (command.action === "execute") executionAttempted = true;
    else {
      plan = undefined;
      planOptions = command.options;
    }
    report("operator-running", { action: command.action });
    const result = await runSessionOperator({
      action: command.action,
      options: planOptions,
      reviewedPlan: plan,
      identity,
      clientSecret,
      attestationJson,
    });
    if (command.action === "plan") plan = result;
    report("operator-complete", result);
    if (command.action === "execute") await close();
  } catch (error) {
    const safe = [
      "invalid_session_command",
      "invalid_plan_options",
      "operator_result_invalid",
      "zero_drift_plan_changed",
      "operator_interrupted_check_recovery",
      "operator_unavailable",
      "operator_failed_check_recovery",
      "d2_coverage_missing",
      "d3_coverage_missing",
      "identity_not_fresh",
      "source_not_ready",
    ];
    const missingCoverage = ["d2_coverage_missing", "d3_coverage_missing"].includes(error.message)
      ? sanitizeMissingCoverage(error.missingCoverage, error.message === "d3_coverage_missing")
      : null;
    report(
      safe.includes(error.message) ? error.message : "session-command-failed",
      missingCoverage ? { missingCoverage } : {},
    );
    if (executionAttempted) await close();
  } finally {
    busy = false;
    if (closeAfterAction) await close();
  }
});

input.on("close", () => {
  if (!busy) void close();
});
process.on("SIGINT", () => {
  if (busy) report("operator-in-progress-do-not-retry-inspect-recovery-if-interrupted");
  else void close();
});
process.on("SIGTERM", () => {
  if (!busy) void close();
});
