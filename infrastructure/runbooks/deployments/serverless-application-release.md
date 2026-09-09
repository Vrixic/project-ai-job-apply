# Serverless Application Release

Use this procedure for development or synthetic staging after provider retirement. The supported
runtime is API Gateway plus versioned Lambda aliases, SQS/outbox recovery, and Lambda durable
workflows. There is no continuously running application service or provider fallback.

## Preconditions

- Use an exact clean upstream-matched `main` checkout and portable Terraform `1.16.2`.
- Select the environment's IAM Identity Center profile, AWS account, `us-east-2` state bucket, and
  KMS-encrypted `platform.tfstate`; never reuse another environment's inputs.
- Require passing repository checks, a healthy current alias, enabled triggers, empty DLQ, and a
  current PostgreSQL backup/PITR chain.
- Keep secrets in managed stores and plans below the ignored environment `.terraform` directory.

## Publish immutable artifacts

Run the protected `Publish gateway Lambda` and `Publish workflow Lambdas` GitHub workflows for the
selected environment and exact merged commit. Record each versioned S3 object version, source
SHA-256, and Lambda-compatible base64 SHA-256. Publication must fail on provenance mismatch,
dependency-audit failure, or unexpected artifact contents.

The database migration is separate. Publish `Dockerfile.migration` through `Publish environment
images`, require a complete ECR scan with zero High or Critical findings, and select the exact
`linux/amd64` digest rather than a tag.

## Plan and apply

Initialize the exact remote backend with its customer-managed KMS key. Supply only the reviewed
Auth0 issuer/audience, immutable artifact coordinates, migration digest, bounded concurrency, and
steady-state `serverless_runtime_enabled = true` inputs through process-scoped variables.

Create a refresh-backed saved plan. Review every address and action. A routine release may update
only the selected Lambda functions, immutable aliases, durable definition/version resources,
their exact artifact metadata, and associated alarms or propagation gates. It must not replace or
delete RDS, backups, KMS, S3, queues/DLQs, API Gateway, identity boundaries, or migration history.

Compute the plan SHA-256, obtain explicit approval for material changes, and apply that exact file.
Never regenerate a reviewed checksum in place.

## Verify and recover

Require:

- aliases target immutable numeric versions and functions report `Active`/`Successful`;
- API liveness/readiness and anonymous protected access return `200/200/401`;
- JWT issuer, audience, and owner-scoped behavior pass;
- SQS and EventBridge durable triggers are enabled with zero unexpected backlog or DLQ records;
- preference persistence, operation completion, idempotent replay, and two-account isolation pass;
- aggregate logs contain no error spike or restricted values; and
- a same-input refresh-backed Terraform plan reports zero drift.

For a bad release, disable `serverless_runtime_enabled` only through a separately reviewed saved
plan when fail-closed unavailability is required. Otherwise move aliases only through an exact,
checksum-reviewed rollback plan to an already accepted immutable version, then repeat the entire
verification boundary. Never reconstruct the retired runtime.
