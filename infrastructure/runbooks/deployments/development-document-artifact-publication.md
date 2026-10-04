# Development Document Artifact Publication

Use `scripts/publish-development-document-lambdas.ps1` only as the reviewed local fallback when
the protected GitHub Actions publisher cannot run because the repository's Actions budget is
exhausted. It publishes immutable evidence; it does not deploy a Lambda function, change an alias,
or enable SQS/EventBridge processing.

## Boundary

- Target only the dedicated development AWS account in `us-east-2` through a temporary IAM
  Identity Center session.
- Require a clean `main` checkout exactly matching `origin/main` and pass its exact 40-character
  commit as `SourceSha`.
- Supply the encrypted development Terraform state bucket out of band. The operator initializes
  that backend read-only and resolves the artifact bucket and platform KMS key from current
  Terraform state; callers cannot substitute either destination.
- Keep receipts and command logs under the ignored development `.terraform` directory. They may
  contain cloud identifiers needed for local verification and must not be copied wholesale into
  shared evidence.

## Publish

Run the script with `-Action Status` first. It proves the account, tools, clean source, encrypted
state, Terraform ownership, bucket region, versioning, public-access block, and exact customer KMS
default without writing an object.

`-Action Publish` then:

1. runs document-service tests and the centralized dependency audit;
2. builds both document Lambda artifacts twice from the exact source commit;
3. validates both ZIP source markers, schema-2 manifests, hexadecimal/base64 checksums, and
   CycloneDX 1.6 SBOMs, and requires every ZIP/manifest/SBOM/checksum file to reproduce exactly;
4. derives digest-addressed keys below `lambda/documents/<source>/<zip-sha256>/`;
5. rejects any existing object version or delete marker for all eight exact keys before writing;
6. uses conditional `If-None-Match: *` puts with full-object SHA-256 and source/artifact metadata;
7. reads every returned object version back and requires the exact Terraform KMS key, S3 Bucket
   Key, checksum, metadata, length, and version; and
8. writes a sanitized schema-1 receipt and prints its SHA-256.

If publication stops after any put, retain the `publishing` receipt and investigate. Never delete
or overwrite a key and never retry blindly: immutable partial publication is evidence that needs a
new reviewed recovery decision.

## Verify and handoff

Run `-Action Verify` with the exact receipt and reviewed receipt SHA-256. Verification recomputes
the environment binding from the live Terraform-owned bucket/KMS boundary and repeats exact-version
readback for all eight objects.

The later dark-deployment operator consumes only the two receipt entries whose suffix is `zip`:
`key`, `versionId`, `artifactSha256`, and `objectBase64Sha256`. Keep both processing triggers
disabled until their separate conformance and activation gates pass.

## Private Documents control family

`-ArtifactFamily PrivateDocumentControls` selects a separate closed inventory:
`cover-letter-provider-control-lambda`, `cover-letter-response-capture-lambda`,
`cover-letter-cleanup-lambda`, and `cover-letter-response-disposal-lambda`. The local
`build:lambda:private-controls` command builds those four entrypoints under
`backend/services/documents/dist/private-control-lambda`, with default-off and forbidden-content
refusal checks against every actual bundle and no secret fetch.

Its sixteen-object ZIP/manifest/SBOM/checksum matrix uses the dedicated private-control operator
and receipt roots and immutable `lambda/documents/private-controls` key root. Incomplete legacy
twelve-object, mixed document-family and duplicate receipts refuse. Existing two-artifact/eight-object
parser/processor publication stays unchanged. No private family has been published or deployed by
this source work. The unchanged clean-main, dependency-audit, deterministic-build, exact-version,
KMS/checksum and immutable-write guards still apply; this family cannot enable functions or IAM.
Reviewed maintenance-only permissions, runtime composition, writer drain and accountable acceptance
must precede activation. Response disposal does not settle private work or authorize platform purge.
