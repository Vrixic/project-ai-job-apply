import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "application-preparation-starter-lambda";
const names = [
  "APPLICATION_PREPARATION_STARTER_ENABLED",
  "AWS_REGION",
  "PLATFORM_AWS_ACCOUNT_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_SESSION_TOKEN",
  "DATABASE_SECRET_ID",
  "APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN",
  "APPLICATION_PREPARATION_QUEUE_ARN",
  "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS",
  "DATABASE_URL",
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
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/preparation-starter-lambda"),
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
      throw Error("SyntheticUnexpectedStarterFetch");
    };
    try {
      for (const name of names) delete process.env[name];
      const queue = "arn:aws:sqs:us-east-2:123456789012:synthetic-preparation";
      const context = {
        invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-starter:9",
      };
      const event = {
        Records: [
          { messageId: "synthetic-1", eventSource: "aws:sqs", eventSourceARN: queue, body: "{}" },
        ],
      };
      const unavailable = { batchItemFailures: [{ itemIdentifier: "synthetic-1" }] };
      assert.deepEqual(await bundle.handler(event, context), unavailable);
      Object.assign(process.env, {
        APPLICATION_PREPARATION_STARTER_ENABLED: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "synthetic-starter",
        AWS_LAMBDA_FUNCTION_VERSION: "9",
        AWS_SESSION_TOKEN: "synthetic-token",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
        APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN:
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:7",
        APPLICATION_PREPARATION_QUEUE_ARN: queue,
      });
      assert.deepEqual(
        await bundle.handler(event, {
          ...context,
          invokedFunctionArn: context.invokedFunctionArn.replace(":9", ":8"),
        }),
        unavailable,
      );
      assert.deepEqual(await bundle.handler(event, context), unavailable);
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
