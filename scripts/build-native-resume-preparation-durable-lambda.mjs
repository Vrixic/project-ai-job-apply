import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "native-resume-preparation-durable-lambda";
const names = [
  "NATIVE_RESUME_PREPARATION_DURABLE_ENABLED",
  "AWS_REGION",
  "PLATFORM_AWS_ACCOUNT_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "NATIVE_RESUME_PREPARATION_CONTROL_FUNCTION_ARN",
  "DATABASE_URL",
  "DATABASE_SECRET_ID",
  "OPENAI_API_KEY",
  "OPENAI_API_KEY_SECRET_ID",
  "COVER_LETTER_OPENAI_SECRET_ID",
  "CANDIDATE_DOCUMENT_BUCKET",
  "PLATFORM_KMS_KEY_ARN",
  "COVER_LETTER_PROVIDER_FUNCTION_ARN",
];
const artifact = await buildLambdaArtifact({
  repositoryRoot,
  entryPoint: path.join(repositoryRoot, `backend/workflows/dist/src/${artifactName}.js`),
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/native-resume-lambda"),
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  handlers: ["index.handler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const fetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("SyntheticUnexpectedOrchestrationFetch");
    };
    try {
      for (const name of names) delete process.env[name];
      const context = {
        invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:9",
      };
      await assert.rejects(() => bundle.handler({}, context), {
        message: "NativeResumePreparationWorkflowUnavailable",
      });
      Object.assign(process.env, {
        NATIVE_RESUME_PREPARATION_DURABLE_ENABLED: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "synthetic-durable",
        AWS_LAMBDA_FUNCTION_VERSION: "9",
        NATIVE_RESUME_PREPARATION_CONTROL_FUNCTION_ARN:
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-private:7",
      });
      await assert.rejects(
        () =>
          bundle.handler(
            {},
            { ...context, invokedFunctionArn: context.invokedFunctionArn.replace(":9", ":8") },
          ),
        { message: "NativeResumePreparationWorkflowUnavailable" },
      );
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = fetch;
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  },
});
process.stdout.write(`${JSON.stringify({ artifact })}\n`);
