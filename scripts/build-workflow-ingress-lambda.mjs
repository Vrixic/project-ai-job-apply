import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const result = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/workflows/dist/src/serverless-outbox-lambda.js"),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/lambda"),
  artifactName: "workflow-ingress-lambda",
  applicationName: "@ai-job-apply/workflow-ingress-lambda",
  handlers: ["index.starter", "index.reconcile"],
  packageFilter: "@ai-job-apply/workflows...",
});

process.stdout.write(`${JSON.stringify(result)}\n`);
