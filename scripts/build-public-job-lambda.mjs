import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

const outputDirectory = path.join(repositoryRoot, "backend/gateway/dist/public-job-lambda");
const packageFilter = "@ai-job-apply/gateway...";
const external = [
  "@fastify/static",
  "@fastify/view",
  "@nestjs/microservices",
  "@nestjs/microservices/microservices-module",
  "@nestjs/platform-express",
  "@nestjs/websockets/socket-module",
  "class-transformer",
  "class-validator",
];

const edge = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/gateway/dist/src/public-job-lambda.js"),
  outputDirectory,
  artifactName: "public-job-edge-lambda",
  applicationName: "@ai-job-apply/public-job-edge-lambda",
  handlers: ["index.handler"],
  packageFilter,
  external,
});
const projection = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/gateway/dist/src/public-job-projection-lambda.js"),
  outputDirectory,
  artifactName: "public-job-projection-lambda",
  applicationName: "@ai-job-apply/public-job-projection-lambda",
  handlers: ["index.projectionHandler"],
  packageFilter,
  external,
});

const edgeBundle = await readFile(path.join(outputDirectory, "public-job-edge-lambda.mjs"), "utf8");
for (const forbidden of [
  "PUBLIC_JOB_DATABASE_HOST",
  "ai_job_apply_public_job_reader",
  "@aws-sdk/rds-signer",
]) {
  if (edgeBundle.includes(forbidden)) {
    throw new Error(
      `The anonymous public-job edge bundle contains forbidden DB marker ${forbidden}`,
    );
  }
}

process.stdout.write(`${JSON.stringify({ edge, projection })}\n`);
