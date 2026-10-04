import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";
import {
  privateDocumentArtifacts,
  verifyPrivateDocumentBundle,
} from "./lib/private-document-artifacts.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = [];
// Separate from parser/processor builds and receipts. Never select an entrypoint from caller data.
for (const artifact of privateDocumentArtifacts) {
  artifacts.push(
    await buildLambdaArtifact({
      repositoryRoot,
      entryPoint: path.join(
        repositoryRoot,
        `backend/services/documents/dist/src/${artifact.name}.js`,
      ),
      outputDirectory: path.join(
        repositoryRoot,
        "backend/services/documents/dist/private-control-lambda",
      ),
      artifactName: artifact.name,
      applicationName: `@ai-job-apply/${artifact.name}`,
      handlers: ["index.handler"],
      packageFilter: "@ai-job-apply/documents-service...",
      verifyBundle: (bundleModule) => verifyPrivateDocumentBundle(bundleModule, artifact),
    }),
  );
}
process.stdout.write(`${JSON.stringify({ artifacts })}\n`);
