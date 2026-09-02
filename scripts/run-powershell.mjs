import { spawnSync } from "node:child_process";

const rawArguments = process.argv.slice(2);
const requireCore = rawArguments[0] === "--require-core";
const powershellArguments = requireCore ? rawArguments.slice(1) : rawArguments;

if (powershellArguments.length === 0) {
  console.error("A PowerShell script or command is required.");
  process.exit(2);
}

const candidates =
  process.platform === "win32"
    ? requireCore
      ? ["pwsh.exe", "pwsh"]
      : ["pwsh.exe", "pwsh", "powershell.exe"]
    : ["pwsh"];

for (const executable of candidates) {
  const result = spawnSync(executable, ["-NoProfile", ...powershellArguments], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error && result.error.code === "ENOENT") continue;
  if (result.error) {
    console.error(`Unable to start ${executable}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error(
  requireCore
    ? "PowerShell 7 (pwsh) is required for this check but was not found on PATH."
    : "Neither PowerShell 7 nor Windows PowerShell was found on PATH.",
);
process.exit(127);
