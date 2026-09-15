import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const keys =
  "schemaVersion kind capabilityMode runId apiOrigin issuedAt expiresAt disposableCandidate identitySha256 issuer audience clientId sourceAuthorized actions ugcPolicyVersion preview previewSha256 readRequests".split(
    " ",
  );
const exact = (value, names) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...names].sort().join("|");
const fail = () => {
  throw new Error("d2_recovery_unavailable");
};
function validate(scope) {
  if (
    !exact(scope, keys) ||
    scope.schemaVersion !== 2 ||
    scope.capabilityMode !== "development" ||
    scope.disposableCandidate !== true ||
    scope.sourceAuthorized !== true ||
    scope.readRequests !== 1 ||
    !exact(scope.preview, ["client", "source", "posting", "observedAt"]) ||
    !exact(scope.preview.client, ["surface", "version"]) ||
    !exact(scope.preview.source, [
      "provider",
      "pageVariant",
      "sourceUrl",
      "externalJobId",
      "adapterVersion",
    ]) ||
    !exact(scope.preview.posting, ["title"]) ||
    scope.preview.posting.title !== "Backend Engineer" ||
    scope.preview.source.sourceUrl !==
      "https://jobs.ashbyhq.com/Mintlify/4da2f7a2-3d5a-4652-bf01-aed59f4cb72b" ||
    !/^[a-f0-9]{64}$/u.test(scope.identitySha256) ||
    !/^[a-f0-9]{64}$/u.test(scope.previewSha256) ||
    !Array.isArray(scope.actions) ||
    scope.actions.some((value) => typeof value !== "string" || value.length > 80)
  )
    fail();
  for (const [key, value] of Object.entries(scope)) {
    if (
      ![
        "preview",
        "actions",
        "schemaVersion",
        "disposableCandidate",
        "sourceAuthorized",
        "readRequests",
      ].includes(key) &&
      (typeof value !== "string" ||
        value.length > 512 ||
        [...value].some((character) => character.codePointAt(0) < 32))
    )
      fail();
  }
  if (JSON.stringify(scope).length > 16_384) fail();
  return scope;
}
function handle(value) {
  if (
    !exact(value, ["fileName", "sha256"]) ||
    !/^scope-[a-f0-9]{32}\.dpapi$/u.test(value.fileName) ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  )
    fail();
  return value;
}
async function call(action, payload, options) {
  if (
    process.platform !== "win32" ||
    (options !== undefined && (process.env.NODE_ENV !== "test" || !exact(options, ["testRoot"])))
  )
    fail();
  return new Promise((resolve, reject) => {
    const child = spawn(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        fileURLToPath(new URL("./protect-d2-workload-recovery.ps1", import.meta.url)),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("d2_recovery_unavailable"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 65_536) {
        child.kill();
      } else output += chunk.toString("utf8");
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("d2_recovery_unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || size > 65_536) fail();
        resolve(JSON.parse(output));
      } catch {
        reject(new Error("d2_recovery_unavailable"));
      }
    });
    child.stdin.end(
      JSON.stringify({ action, payload, ...(options ? { testRoot: options.testRoot } : {}) }),
    );
  });
}
export async function preserveD2RecoveryScope(scope, options) {
  return Object.freeze(handle(await call("preserve", validate(scope), options)));
}
export async function completeD2RecoveryScope(value, options) {
  const result = await call("complete", handle(value), options);
  if (!exact(result, ["completed"]) || result.completed !== true) fail();
  return Object.freeze(result);
}
/** Read-only, process-memory recovery material. Never logs or executes the scope. */
export async function readD2RecoveryScope(value, options) {
  return validate(await call("read", handle(value), options));
}
