import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Preserve the old entry point without preserving its caller-supplied database
// URL or mutation-capable live activity store. All paths use the same operator.
const launcher = ["../../../scripts/run-powershell.mjs", "../../../../scripts/run-powershell.mjs"]
  .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
  .find((candidate) => existsSync(candidate));
if (!launcher) throw new Error("CandidateDeletionRestoreOperatorUnavailable");
const repositoryRoot = path.resolve(path.dirname(launcher), "..");
const result = spawnSync(
  process.execPath,
  [
    launcher,
    "--require-core",
    "-File",
    path.join(repositoryRoot, "scripts/operate-development-candidate-deletion-replay.ps1"),
    ...process.argv.slice(2),
  ],
  { cwd: repositoryRoot, stdio: "inherit", windowsHide: true },
);
process.exitCode = result.status ?? 1;
