import { spawnSync } from "node:child_process";
import process from "node:process";
import { Connection } from "@temporalio/client";

const defaults = {
  profile: "ai-job-apply-development-admin",
  region: "us-east-2",
  secretId: "ai-job-apply/development/temporal-api-key",
};

const usage = `Usage:
  pnpm --filter @ai-job-apply/workflows cloud:verify -- \\
    --address <namespace>.<account>.tmprl.cloud:7233 \\
    --namespace <namespace>.<account>

Options:
  --profile <name>       AWS CLI profile (default: ${defaults.profile})
  --region <region>      AWS region (default: ${defaults.region})
  --secret-id <id>       Secrets Manager secret ID (default: ${defaults.secretId})
  --address <endpoint>   Temporal Cloud gRPC endpoint
  --namespace <name>     Full Temporal Cloud namespace ID
  --help                 Show this help

The command never prints the secret value, AWS account ID, secret ARN, or Temporal account suffix.`;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { ...defaults };
  const valueOptions = new Set(["profile", "region", "secret-id", "address", "namespace"]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (!argument.startsWith("--")) {
      fail(`Unexpected argument: ${argument}`);
    }

    const name = argument.slice(2);
    if (!valueOptions.has(name)) {
      fail(`Unknown option: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for ${argument}`);
    }
    index += 1;

    const property = name === "secret-id" ? "secretId" : name;
    options[property] = value;
  }

  if (!options.address) {
    fail("--address is required.");
  }
  if (!options.namespace) {
    fail("--namespace is required.");
  }
  if (!options.address.endsWith(".tmprl.cloud:7233")) {
    fail("--address must be a Temporal Cloud gRPC endpoint ending in .tmprl.cloud:7233.");
  }
  const addressNamespace = options.address.slice(0, -".tmprl.cloud:7233".length);
  if (options.namespace !== addressNamespace) {
    fail("--namespace must exactly match the namespace portion of --address.");
  }

  return options;
}

function runAws(argumentsList, options, { containsSecret = false } = {}) {
  const result = spawnSync(
    "aws",
    [
      ...argumentsList,
      "--profile",
      options.profile,
      "--region",
      options.region,
      "--no-cli-pager",
      "--output",
      "json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AWS_PAGER: "",
      },
      windowsHide: true,
    },
  );

  if (result.error) {
    fail("AWS CLI could not be started. Confirm it is installed and available on PATH.");
  }
  if (result.status !== 0) {
    if (containsSecret) {
      fail("AWS Secrets Manager did not return the runtime secret.");
    }
    const detail = result.stderr.trim();
    fail(detail ? `AWS CLI failed: ${detail}` : "AWS CLI failed.");
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(
      containsSecret ? "AWS returned an invalid secret response." : "AWS returned invalid JSON.",
    );
  }
}

async function verify(options) {
  const identity = runAws(["sts", "get-caller-identity"], options);
  const secret = runAws(
    ["secretsmanager", "describe-secret", "--secret-id", options.secretId],
    options,
  );

  if (!identity.Account || !secret.ARN) {
    fail("AWS identity or secret metadata is incomplete.");
  }
  const secretArnParts = secret.ARN.split(":");
  if (
    secretArnParts[3] !== options.region ||
    secretArnParts[4] !== identity.Account ||
    secret.Name !== options.secretId
  ) {
    fail("AWS caller, region, and target secret are not aligned.");
  }

  const currentVersions = Object.entries(secret.VersionIdsToStages ?? {}).filter(([, stages]) =>
    stages.includes("AWSCURRENT"),
  );
  if (currentVersions.length !== 1) {
    fail(
      "The Temporal runtime secret must have exactly one AWSCURRENT value version. Add or repair it before continuing.",
    );
  }
  process.stdout.write("AWS caller, region, and managed secret metadata passed.\n");

  const secretValue = runAws(
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      options.secretId,
      "--version-stage",
      "AWSCURRENT",
    ],
    options,
    { containsSecret: true },
  );
  let temporalApiKey = secretValue.SecretString;
  secretValue.SecretString = "";
  if (!temporalApiKey || typeof temporalApiKey !== "string") {
    fail("The Temporal runtime secret must contain a non-empty plaintext API key.");
  }

  let connection;
  try {
    connection = await Connection.connect({
      address: options.address,
      tls: true,
      apiKey: temporalApiKey,
    });
    await connection.workflowService.listWorkflowExecutions({
      namespace: options.namespace,
      pageSize: 1,
    });
  } catch {
    fail(
      "Temporal Cloud authentication or namespace read conformance failed. Check the key identity, expiry, namespace permission, address, and namespace.",
    );
  } finally {
    temporalApiKey = "";
    await connection?.close();
  }

  process.stdout.write("Temporal Cloud authentication and namespace read conformance passed.\n");
  process.stdout.write("No secret values or environment identifiers were printed.\n");
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\n`);
  } else {
    await verify(options);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown conformance failure.";
  process.stderr.write(`Temporal Cloud conformance failed: ${message}\n`);
  process.exitCode = 1;
}
