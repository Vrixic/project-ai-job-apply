import { spawnSync } from "node:child_process";
import process from "node:process";
import { Connection } from "@temporalio/client";
import { isProviderAccessRejected } from "./temporal-retirement-rejection.mjs";

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = { profile: "", region: "us-east-2", mode: "active-zero" };
  const values = new Set(["profile", "region", "secret-id", "address", "namespace", "mode"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--") || !values.has(argument.slice(2))) {
      fail("Unknown retirement-inspection argument.");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("A retirement-inspection argument is missing its value.");
    }
    options[argument.slice(2).replace("-id", "Id")] = value;
    index += 1;
  }
  if (
    !options.profile ||
    !options.secretId ||
    !options.address ||
    !options.namespace ||
    !["active-zero", "revoked"].includes(options.mode)
  ) {
    fail("Profile, secret ID, address, namespace, and a supported mode are required.");
  }
  if (!options.address.endsWith(".tmprl.cloud:7233")) {
    fail("The address is not a Temporal Cloud gRPC endpoint.");
  }
  if (options.namespace !== options.address.slice(0, -".tmprl.cloud:7233".length)) {
    fail("The namespace and address do not identify the same boundary.");
  }
  return options;
}

function awsJson(args, options, secretBearing = false) {
  const result = spawnSync(
    "aws",
    [
      ...args,
      "--profile",
      options.profile,
      "--region",
      options.region,
      "--no-cli-pager",
      "--output",
      "json",
    ],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, AWS_PAGER: "" } },
  );
  if (result.status !== 0) {
    fail(
      secretBearing
        ? "The managed runtime credential could not be read."
        : "AWS inspection failed.",
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("AWS returned invalid JSON.");
  }
}

async function inspect(options) {
  const caller = awsJson(["sts", "get-caller-identity"], options);
  const secret = awsJson(
    ["secretsmanager", "describe-secret", "--secret-id", options.secretId],
    options,
  );
  if (!caller.Account || !secret.ARN || secret.Name !== options.secretId) {
    fail("The AWS caller and managed runtime credential are not aligned.");
  }
  const arn = secret.ARN.split(":");
  if (arn[3] !== options.region || arn[4] !== caller.Account) {
    fail("The managed runtime credential is outside the selected account or region.");
  }
  const current = Object.values(secret.VersionIdsToStages ?? {}).filter((stages) =>
    stages.includes("AWSCURRENT"),
  );
  if (current.length !== 1) {
    fail("The managed runtime credential does not have exactly one current version.");
  }
  const value = awsJson(
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      options.secretId,
      "--version-stage",
      "AWSCURRENT",
    ],
    options,
    true,
  );
  let apiKey = value.SecretString;
  value.SecretString = "";
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    fail("The managed runtime credential is empty.");
  }

  let connection;
  try {
    connection = await Connection.connect({ address: options.address, tls: true, apiKey });
    const running = await connection.workflowService.listWorkflowExecutions({
      namespace: options.namespace,
      pageSize: 1,
      query: 'ExecutionStatus = "Running"',
    });
    if (options.mode === "revoked") {
      fail("The retired Temporal credential is still accepted.");
    }
    if ((running.executions?.length ?? 0) !== 0) {
      fail("The Temporal namespace still contains running workflows.");
    }
  } catch (error) {
    if (options.mode === "revoked" && isProviderAccessRejected(error)) {
      // Expected proof: the exact provider credential is no longer accepted.
    } else if (options.mode === "active-zero" && isProviderAccessRejected(error)) {
      fail("The managed runtime credential was rejected before retirement.");
    } else {
      fail("The provider namespace did not reach the expected retirement state.");
    }
  } finally {
    apiKey = "";
    await connection?.close();
  }

  process.stdout.write(
    options.mode === "active-zero"
      ? "Temporal retirement preflight passed: credential active and zero running workflows.\n"
      : "Temporal retirement revocation passed: the exact managed credential is rejected.\n",
  );
  process.stdout.write(
    "No credential, namespace, account, workflow, or candidate identifier was printed.\n",
  );
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Use --profile, --region, --secret-id, --address, --namespace, and --mode active-zero|revoked.\n",
    );
  } else {
    await inspect(options);
  }
} catch (error) {
  process.stderr.write(
    `Temporal retirement inspection failed: ${error instanceof Error ? error.message : "unknown failure"}\n`,
  );
  process.exitCode = 1;
}
