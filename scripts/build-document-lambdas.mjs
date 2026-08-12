import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(repositoryRoot, "backend/services/documents/dist/lambda");
const packageFilter = "@ai-job-apply/documents-service...";

const coordinator = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/services/documents/dist/src/processor-lambda.js"),
  outputDirectory,
  artifactName: "document-processor-lambda",
  applicationName: "@ai-job-apply/document-processor-lambda",
  handlers: ["index.handler"],
  packageFilter,
});
const parser = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/services/documents/dist/src/parser-lambda.js"),
  outputDirectory,
  artifactName: "document-parser-lambda",
  applicationName: "@ai-job-apply/document-parser-lambda",
  handlers: ["index.handler"],
  packageFilter,
});

process.stdout.write(`${JSON.stringify({ coordinator, parser })}\n`);
