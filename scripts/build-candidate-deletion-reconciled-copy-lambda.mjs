import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_RESTORE_MANIFEST_SHA256 } from "../backend/workflows/dist/src/candidate-deletion-restore-contract.js";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = await readFile(
  path.join(repositoryRoot, "backend/services/database-migrations/restore-manifest.v1.json"),
);
if (createHash("sha256").update(manifest).digest("hex") !== CURRENT_RESTORE_MANIFEST_SHA256) {
  throw new Error("CandidateDeletionReconciledCopyManifestRejected");
}
const result = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(
    repositoryRoot,
    "backend/workflows/dist/src/candidate-deletion-reconciled-copy-lambda.js",
  ),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/lambda"),
  artifactName: "candidate-deletion-reconciled-copy-lambda",
  applicationName: "@ai-job-apply/candidate-deletion-reconciled-copy-lambda",
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async ({ handler }) => {
    try {
      await handler(
        {},
        {
          invokedFunctionArn: "invalid",
          functionVersion: "$LATEST",
          getRemainingTimeInMillis: () => 0,
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "CandidateDeletionReconciledCopyVerificationRejected"
      )
        return;
      throw new Error("ReconciledCopyBundledRefusalRejected");
    }
    throw new Error("ReconciledCopyBundledRefusalMissing");
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
