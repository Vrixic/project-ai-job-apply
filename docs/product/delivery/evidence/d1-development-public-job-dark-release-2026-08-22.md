# D1 development public-job dark release

Date: 2026-08-22  
Environment: Development  
Status: In progress; corrected package build awaits immutable publication and apply

## Released boundary

Exact source revision `1fda2f2bff649c1f62437055e140bb9f3a8dd085` was released through saved
Terraform plan SHA-256
`3a02df4b2b5724f5270656795a41d359f3e06cc8d2657de49fb5295724872306`.
The field-reviewed plan added the separate public edge and private projection functions, aliases,
least-privilege roles, and six alarms; advanced the existing gateway, parser, processor, and
migration-task artifacts; and preserved every activation gate as false. The apply completed with
18 creates, 6 updates, and one immutable migration task-definition replacement. Development state
advanced to serial 117 and migration task revision 13.

Live inspection established:

- gateway alias `20`, parser alias `3`, processor alias `3`, and both public aliases at version `1`
  were `Active`/`Successful`, used the exact planned code checksums, and had no weighted routing;
- the public edge had zero VPC subnets, zero security groups, and zero database environment names;
- the projection alone had the exact two private subnets, one application security group, and the
  public-reader database settings;
- `GET /v1/public/jobs/{jobId}` was absent from API Gateway;
- the document scan rule and event-source mapping remained disabled, ingestion remained
  undeployed/disabled, and no ECS task was running or pending; and
- all six public edge/projection alarms reached `OK`.

No anonymous route, document trigger, ingestion trigger/source, provider, real candidate, or real
job data was activated.

## Runtime finding and correction

The first generated-synthetic direct invocation correctly found a release-blocking Node.js 24
runtime incompatibility before public activation. Lambda returned
`Runtime.CallbackHandlerDeprecated` because the edge and projection lazy handlers exposed legacy
three-argument callback signatures. No handler logic, database read, API route, or user-visible
response executed.

The first source correction removed the unused callback parameter from both async Lambda
entrypoints and their shared handler type, forwarded only event and context, and added exact
source-export arity regressions. Gateway type-check and all 108 gateway tests passed. Revision
`6e7b07ed320bb8d41f9ae45739aa1a631d7f4614` was then published and applied through exact
two-function/two-alias plan SHA-256
`1a8343cc5756d127d5b2081583db684f9434ed356a54e354886b93de68066f80`, advancing both public
aliases to version `2` without exposing the route.

The version `2` direct-dark replay returned the same pre-handler runtime error. Inspection proved
that directly invoking the low-level bundler had packaged stale compiled `dist` output even though
the TypeScript source and source-level tests were corrected. The owned package build command already
compiles the dependency closure first. The shared artifact builder now additionally imports each
completed bundle and fails if an exported Node.js 24 handler has arity greater than two. Two full
package builds are deterministic, and the completed bundles report edge/projection arity `2`/`2`.

Completion of this evidence requires committing the packaging guard, rebuilding and publishing
artifacts bound to that exact clean revision through the package command, applying a separately
reviewed two-function/two-alias Terraform plan, repeating the direct-dark invocation, and proving
zero drift. The anonymous route must remain absent throughout.
