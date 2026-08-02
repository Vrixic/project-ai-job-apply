import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(repositoryRoot, "backend/workflows/dist/lambda");
const packageFilter = "@ai-job-apply/workflows...";

const durable = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/workflows/dist/src/profile-readiness-durable.js"),
  outputDirectory,
  artifactName: "profile-readiness-durable-lambda",
  applicationName: "@ai-job-apply/profile-readiness-durable-lambda",
  handlers: ["index.handler"],
  packageFilter,
});
const activity = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/workflows/dist/src/profile-readiness-lambda.js"),
  outputDirectory,
  artifactName: "profile-readiness-activity-lambda",
  applicationName: "@ai-job-apply/profile-readiness-activity-lambda",
  handlers: ["index.activity", "index.terminal"],
  packageFilter,
});

process.stdout.write(`${JSON.stringify({ durable, activity })}\n`);
