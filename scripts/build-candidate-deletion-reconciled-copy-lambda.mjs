import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
