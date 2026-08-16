import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/gateway/dist/src/public-job-lambda.js"),
  outputDirectory: path.join(repositoryRoot, "backend/gateway/dist/public-job-lambda"),
  artifactName: "public-job-lambda",
  applicationName: "@ai-job-apply/public-job-lambda",
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/gateway...",
  external: [
    "@fastify/static",
    "@fastify/view",
    "@nestjs/microservices",
    "@nestjs/microservices/microservices-module",
    "@nestjs/platform-express",
    "@nestjs/websockets/socket-module",
    "class-transformer",
    "class-validator",
  ],
});

process.stdout.write(`${JSON.stringify(artifact)}\n`);
