import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(repositoryRoot, "backend/workflows/dist/lambda");
const packageFilter = "@ai-job-apply/workflows...";

const durable = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/workflows/dist/src/ingestion-durable.js"),
  outputDirectory,
  artifactName: "ingestion-durable-lambda",
  applicationName: "@ai-job-apply/ingestion-durable-lambda",
  handlers: ["index.handler"],
  packageFilter,
});
const runtime = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/workflows/dist/src/ingestion-lambda.js"),
  outputDirectory,
  artifactName: "ingestion-runtime-lambda",
  applicationName: "@ai-job-apply/ingestion-runtime-lambda",
  handlers: ["index.coordinator", "index.starter", "index.activity", "index.terminal"],
  packageFilter,
});

process.stdout.write(`${JSON.stringify({ durable, runtime })}\n`);
