import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const result = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/workflows/dist/src/d2-community-lambda.js"),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/lambda"),
  artifactName: "d2-community-runtime-lambda",
  applicationName: "@ai-job-apply/d2-community-runtime-lambda",
  handlers: ["index.scheduled", "index.trustSignal"],
  packageFilter: "@ai-job-apply/workflows...",
});

process.stdout.write(`${JSON.stringify(result)}\n`);
