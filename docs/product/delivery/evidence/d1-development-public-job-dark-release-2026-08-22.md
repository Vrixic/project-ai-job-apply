# D1 development public-job dark release

Date: 2026-08-22  
Environment: Development  
Status: In progress; runtime correction awaits immutable publication and apply

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

The source correction removes the unused callback parameter from both async Lambda entrypoints and
their shared handler type, forwards only event and context, and adds exact exported-handler arity
regressions. Gateway type-check, all 108 gateway tests, formatting, and two deterministic public
artifact builds pass. The corrected local artifact SHA-256 values are:

- edge: `397acd4faf15a01c68c7510c61531b4fa152a7fb8b3bf3bdc2d228ef43e0919a`;
- projection: `1ad5822471510f5e7d3a7be37002f81e002c075c751faa435f23aac7fd28f115`.

These local hashes are build evidence only. Completion of this evidence requires committing the
correction, rebuilding and publishing artifacts bound to that exact revision, applying a separately
reviewed two-function/two-alias Terraform plan, repeating the direct-dark invocation, and proving
zero drift. The anonymous route must remain absent throughout.
