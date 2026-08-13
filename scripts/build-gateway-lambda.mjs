import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, "backend/gateway/dist/src/lambda.js"),
  outputDirectory: path.join(repositoryRoot, "backend/gateway/dist/lambda"),
  artifactName: "gateway-lambda",
  applicationName: "@ai-job-apply/gateway-lambda",
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/gateway...",
  // Nest keeps these optional features behind runtime require calls. The gateway does not
  // register them, so they remain intentionally absent from the deployable artifact.
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
