import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(
    repositoryRoot,
    "backend/workflows/dist/src/candidate-deletion-restore-lambda.js",
  ),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/lambda"),
  artifactName: "candidate-deletion-restore-lambda",
  applicationName: "@ai-job-apply/candidate-deletion-restore-lambda",
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
});

process.stdout.write(`${JSON.stringify(result)}\n`);
