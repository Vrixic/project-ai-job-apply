import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLambdaArtifact } from "./lib/build-lambda-artifact.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactName = "application-preparation-recovery-lambda";
const names = [
  "APPLICATION_PREPARATION_RECOVERY_ENABLED",
  "AWS_REGION",
  "PLATFORM_AWS_ACCOUNT_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_SESSION_TOKEN",
  "DATABASE_SECRET_ID",
  "APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN",
  "APPLICATION_PREPARATION_RETAINED_FUNCTION_ARNS",
  "APPLICATION_PREPARATION_RECOVERY_RULE_ARN",
  "APPLICATION_PREPARATION_QUEUE_URL",
  "APPLICATION_PREPARATION_NUDGES_ENABLED",
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
  outputDirectory: path.join(repositoryRoot, "backend/workflows/dist/preparation-recovery-lambda"),
  artifactName,
  applicationName: `@ai-job-apply/${artifactName}`,
  handlers: ["index.terminalHandler", "index.reconcileHandler"],
  packageFilter: "@ai-job-apply/workflows...",
  verifyBundle: async (bundle) => {
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const fetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("SyntheticUnexpectedRecoveryFetch");
    };
    try {
      for (const name of names) delete process.env[name];
      const context = {
        invokedFunctionArn: "arn:aws:lambda:us-east-2:123456789012:function:synthetic-recovery:9",
      };
      for (const handler of [bundle.terminalHandler, bundle.reconcileHandler])
        await assert.rejects(handler({}, context), /ApplicationPreparationRecoveryUnavailable/u);
      Object.assign(process.env, {
        APPLICATION_PREPARATION_RECOVERY_ENABLED: "true",
        AWS_REGION: "us-east-2",
        PLATFORM_AWS_ACCOUNT_ID: "123456789012",
        AWS_LAMBDA_FUNCTION_NAME: "synthetic-recovery",
        AWS_LAMBDA_FUNCTION_VERSION: "9",
        AWS_SESSION_TOKEN: "synthetic-token",
        DATABASE_SECRET_ID:
          "arn:aws:secretsmanager:us-east-2:123456789012:secret:synthetic-db-123456",
        APPLICATION_PREPARATION_DURABLE_FUNCTION_ARN:
          "arn:aws:lambda:us-east-2:123456789012:function:synthetic-durable:7",
      });
      await assert.rejects(
        bundle.terminalHandler(
          {},
          { invokedFunctionArn: context.invokedFunctionArn.replace(":9", ":8") },
        ),
        /ApplicationPreparationRecoveryUnavailable/u,
      );
      await assert.rejects(
        bundle.terminalHandler({}, context),
        /ApplicationPreparationRecoveryInputRejected/u,
      );
      Object.assign(process.env, {
        APPLICATION_PREPARATION_RECOVERY_RULE_ARN:
          "arn:aws:events:us-east-2:123456789012:rule/synthetic-recovery",
        APPLICATION_PREPARATION_QUEUE_URL:
          "https://sqs.us-east-2.amazonaws.com/123456789012/synthetic-preparation",
      });
      await assert.rejects(
        bundle.reconcileHandler(
          {},
          { invokedFunctionArn: context.invokedFunctionArn.replace(":9", ":8") },
        ),
        /ApplicationPreparationRecoveryUnavailable/u,
      );
      await assert.rejects(
        bundle.reconcileHandler({}, context),
        /ApplicationPreparationRecoveryInputRejected/u,
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
