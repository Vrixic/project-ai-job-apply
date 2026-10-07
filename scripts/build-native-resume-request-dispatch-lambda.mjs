import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-resume-request-dispatch-lambda";
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-resume-lambda"),
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const flag = process.env.NATIVE_RESUME_REQUEST_DISPATCH_ENABLED;
    try {
      delete process.env.NATIVE_RESUME_REQUEST_DISPATCH_ENABLED;
      await assert.rejects(
        () =>
          bundle.handler(
            { schemaVersion: 1, action: "sweep" },
            {
              invokedFunctionArn:
                "arn:aws:lambda:us-east-2:123456789012:function:synthetic-resume-dispatch:9",
            },
          ),
        { message: "NativeResumeDispatchUnavailable" },
      );
    } finally {
      if (flag === undefined) delete process.env.NATIVE_RESUME_REQUEST_DISPATCH_ENABLED;
      else process.env.NATIVE_RESUME_REQUEST_DISPATCH_ENABLED = flag;
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
