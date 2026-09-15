import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import {
  parseCandidateRightsEnvironment,
  safeSessionDiagnostic,
  startD2WorkloadSession,
} from "./lib/candidate-rights-session.mjs";
import {
  createD2WorkloadSessionOperator,
  D2_WORKLOAD_SOURCE,
  D2_WORKLOAD_TITLE,
  PROCESSING_CONFIRMATION,
} from "./lib/d2-workload-session-operator.mjs";

export function d2SignInDiagnostic(value) {
  return {
    outcome: "workload-sign-in-request-rejected",
    diagnostic: safeSessionDiagnostic(value),
    candidateDataChanged: false,
  };
}
export function d2SignInClosed(reason) {
  return {
    outcome: "workload-sign-in-closed",
    reason: ["confirmed", "cancelled", "timeout", "failed", "closed"].includes(reason)
      ? reason
      : "closed",
  };
}

export function parseD2WorkloadCommand(line) {
  if (typeof line !== "string" || Buffer.byteLength(line, "utf8") > 1024)
    throw new Error("invalid_workload_command");
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_workload_command");
  const keys = Object.keys(value).sort().join(",");
  if (keys === "action" && value.action === "cancel") return value;
  if (
    keys === "action,confirmation,reviewedScopeSha256" &&
    value.action === "execute" &&
    value.confirmation === PROCESSING_CONFIRMATION &&
    typeof value.reviewedScopeSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.reviewedScopeSha256)
  )
    return value;
  throw new Error("invalid_workload_command");
}

export function parseD2WorkloadPublicSettings(text) {
  const settings = parseEnv(text.startsWith("\uFEFF") ? text.slice(1) : text);
  if (settings.EXTENSION_DEVELOPMENT_CONTRIBUTIONS !== "true")
    throw new Error("development_workload_configuration_required");
  const apiOrigin = settings.EXTENSION_API_ORIGIN;
  const ugcPolicyVersion = settings.EXTENSION_UGC_CONTRIBUTION_POLICY_VERSION;
  if (
    typeof apiOrigin !== "string" ||
    !/^https:\/\/[a-z0-9]+\.execute-api\.us-east-2\.amazonaws\.com$/u.test(apiOrigin) ||
    typeof ugcPolicyVersion !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(ugcPolicyVersion)
  )
    throw new Error("development_workload_configuration_required");
  return { apiOrigin, ugcPolicyVersion };
}

async function main() {
  if (process.argv.length !== 2) {
    console.log(
      "Usage: node scripts/start-development-d2-workload-session.mjs\nUses existing local web identity and extension development settings. Sign in and confirm the disposable Mintlify workload. Operator stdin then accepts only exact reviewed execute or cancel. No token or account deletion command is accepted.",
    );
    process.exitCode = process.argv.length === 3 && process.argv[2] === "--help" ? 0 : 2;
    return;
  }
  let session;
  let operator;
  let busy = false;
  let closing = false;
  let expired = false;
  let expiryTimer;
  const input = createInterface({ input: process.stdin, terminal: false });
  const report = (value) => console.log(JSON.stringify(value));
  async function close() {
    if (closing || busy) return;
    try {
      const result = operator?.close();
      if (result && result.outcome !== "closed") {
        report({ outcome: "workload-still-running" });
        return;
      }
      if (result?.recoveryRequired)
        report({ outcome: "encrypted-recovery-scope-retained-do-not-rerun" });
    } catch {
      report({ outcome: "workload-close-failed-check-recovery" });
      return;
    }
    closing = true;
    clearTimeout(expiryTimer);
    operator = undefined;
    input.close();
    await session?.close();
  }
  try {
    const configuration = parseCandidateRightsEnvironment(
      await readFile(fileURLToPath(new URL("../frontend/web/.env.local", import.meta.url)), "utf8"),
    );
    const publicSettings = parseD2WorkloadPublicSettings(
      await readFile(
        fileURLToPath(new URL("../frontend/extension/.env.local", import.meta.url)),
        "utf8",
      ),
    );
    session = await startD2WorkloadSession({
      ...configuration,
      onDiagnostic(diagnostic) {
        report(d2SignInDiagnostic(diagnostic));
      },
      onConfirmed(identity) {
        if (closing || operator) throw new Error("session_already_bound");
        operator = createD2WorkloadSessionOperator({
          identity,
          configuration: {
            issuer: configuration.issuer,
            audience: configuration.audience,
            clientId: configuration.clientId,
          },
          ...publicSettings,
        });
        const review = operator.prepare({
          client: { surface: "browser_extension", version: "0.2.0" },
          source: {
            provider: "ashby",
            sourceUrl: D2_WORKLOAD_SOURCE,
            externalJobId: "4da2f7a2-3d5a-4652-bf01-aed59f4cb72b",
            pageVariant: "ashby-job-board-v1",
            adapterVersion: "d2-job-page-v1",
          },
          posting: { title: D2_WORKLOAD_TITLE },
          observedAt: new Date().toISOString(),
        });
        report(review);
        expiryTimer = setTimeout(() => {
          expired = true;
          if (!busy) void close();
        }, 4 * 60_000);
      },
      onClosed({ reason }) {
        report(d2SignInClosed(reason));
        if (reason !== "confirmed") void close();
      },
    });
    report({ outcome: "waiting-for-disposable-workload-sign-in", url: session.url });
  } catch {
    report({ outcome: "workload-session-unavailable-check-settings-and-port-3000" });
    await close();
    process.exitCode = 1;
    return;
  }
  input.on("line", async (line) => {
    if (closing || busy) {
      report({ outcome: "workload-session-busy-or-closed" });
      return;
    }
    try {
      const command = parseD2WorkloadCommand(line);
      if (command.action === "cancel") {
        await close();
        return;
      }
      if (!operator || expired) {
        report({ outcome: "fresh-disposable-workload-sign-in-required" });
        return;
      }
      busy = true;
      report({ outcome: "workload-running", maximumContributions: 1, publicationAllowed: false });
      const result = await operator.execute({
        confirmation: command.confirmation,
        reviewedScopeSha256: command.reviewedScopeSha256,
      });
      report(result);
      busy = false;
      await close();
    } catch (error) {
      busy = false;
      if (error?.message === "workload_recovery_unavailable_no_dispatch") {
        report({
          outcome: "workload-recovery-record-failed-no-dispatch",
          candidateDataChanged: false,
        });
        await close();
        return;
      }
      report({
        outcome:
          operator?.readiness === "recovery-required"
            ? "encrypted-recovery-scope-retained-do-not-rerun"
            : "workload-command-refused-or-failed-check-session-state",
      });
      if (expired || operator?.readiness === "recovery-required") await close();
    }
  });
  input.on("close", () => {
    expired = true;
    if (!busy) void close();
  });
  process.on("SIGINT", () => {
    if (busy) report({ outcome: "workload-running-cleanup-must-finish" });
    else void close();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("D2 workload session could not start.");
    process.exitCode = 1;
  });
}
