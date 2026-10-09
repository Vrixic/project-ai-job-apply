import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  parseCandidateRightsEnvironment,
  safeSessionDiagnostic,
  startNativeResumeSession,
} from "./lib/candidate-rights-session.mjs";
import {
  createNativeResumeSessionOperator,
  NATIVE_DEVELOPMENT_API,
  parseNativeResumeCommand,
} from "./lib/native-resume-session-operator.mjs";

export function validateNativeDevelopmentBinding(identityConfiguration, caller, api) {
  if (
    identityConfiguration.issuer !== "https://dev-chikw7y3dqdi6dyi21.us.auth0.com/" ||
    identityConfiguration.audience !== "ai-job-apply-api" ||
    caller.Account !== "362544434697" ||
    api.ApiId !== "lemwm7dvi4" ||
    api.Name !== "ai-job-apply-development-gateway" ||
    api.ApiEndpoint !== NATIVE_DEVELOPMENT_API ||
    api.ProtocolType !== "HTTP"
  )
    throw new Error("native_development_binding_required");
}

async function main() {
  const checkOnly = process.argv.length === 3 && process.argv[2] === "--check";
  if (process.argv.length !== 2 && !checkOnly) {
    console.log(
      'Usage: node scripts/start-development-native-resume-session.mjs\nSign in with the disposable synthetic account in your regular browser. Commands: {"action":"inspect"}, {"action":"prepare","jobId":"UUID"}, {"action":"preview"}, {"action":"download"}, {"action":"withdraw"}, {"action":"withdrawal"}, {"action":"cancel"}. One application per session; no submission.',
    );
    process.exitCode = process.argv[2] === "--help" && process.argv.length === 3 ? 0 : 2;
    return;
  }
  const report = (value) => console.log(JSON.stringify(value));
  let session;
  let operator;
  let input;
  let timer;
  let closing = false;
  let busy = false;
  let stopRequested = false;
  async function close() {
    stopRequested = true;
    if (closing || busy) return;
    closing = true;
    clearTimeout(timer);
    const result = operator?.close();
    operator = undefined;
    if (result) report(result);
    input?.close();
    await session?.close();
  }
  try {
    const configuration = parseCandidateRightsEnvironment(
      await readFile(new URL("../frontend/web/.env.local", import.meta.url), "utf8"),
    );
    const execute = promisify(execFile);
    const aws = async (...args) =>
      JSON.parse(
        (
          await execute(
            "aws",
            [
              "--profile",
              "ai-job-apply-development-admin",
              "--region",
              "us-east-2",
              ...args,
              "--output",
              "json",
              "--no-cli-pager",
            ],
            { timeout: 30_000, windowsHide: true, maxBuffer: 64 * 1024 },
          )
        ).stdout,
      );
    validateNativeDevelopmentBinding(
      configuration,
      await aws("sts", "get-caller-identity"),
      await aws("apigatewayv2", "get-api", "--api-id", "lemwm7dvi4"),
    );
    if (checkOnly) {
      report({
        outcome: "native-development-binding-verified",
        signInStarted: false,
        cloudMutated: false,
      });
      return;
    }
    input = createInterface({ input: process.stdin, terminal: false });
    session = await startNativeResumeSession({
      ...configuration,
      onDiagnostic(value) {
        report({ outcome: "native-sign-in-rejected", diagnostic: safeSessionDiagnostic(value) });
      },
      onConfirmed(identity) {
        if (closing || stopRequested || operator) throw new Error("native_session_unavailable");
        operator = createNativeResumeSessionOperator({ identity });
        timer = setTimeout(() => void close(), Math.max(1, operator.expiresAt - Date.now()));
        report({
          outcome: "native-session-ready",
          expiresAt: new Date(operator.expiresAt).toISOString(),
          candidateDataChanged: false,
        });
      },
      onClosed({ reason }) {
        if (reason !== "confirmed") void close();
      },
    });
    report({ outcome: "waiting-for-native-disposable-sign-in", url: session.url });
    input.on("line", async (line) => {
      if (busy || closing || stopRequested) {
        report({ outcome: "native-session-busy-or-closed" });
        return;
      }
      try {
        const command = parseNativeResumeCommand(line);
        if (command.action === "cancel") {
          await close();
          return;
        }
        if (!operator) {
          report({ outcome: "native-sign-in-required" });
          return;
        }
        busy = true;
        report(await operator.execute(command));
      } catch {
        report({
          outcome: "native-command-refused-or-failed",
          note: "Retry uses the original idempotency keys. Withdraw materials before closing after preparation.",
        });
      } finally {
        busy = false;
        if (stopRequested) await close();
      }
    });
    input.on("close", () => void close());
    process.on("SIGINT", () => void close());
    process.on("SIGTERM", () => void close());
  } catch {
    report({
      outcome: "native-session-unavailable-check-development-binding-settings-and-port-3000",
    });
    await close();
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error("Native resume session unavailable.");
    process.exitCode = 1;
  });
}
