# D1 Development Job-Search Stale-Cursor Acceptance

Date: 2026-08-23  
Environment: synthetic development  
Source: `eac06e17393a311ed7ac251a415601cb7eb7b4ee`

## Outcome

The private job-search stale-cursor boundary is deployed and accepted through the exact immutable
gateway and one-off migration runtime for the source above. The acceptance used generated-synthetic
Jobs rows only, invoked the reviewed gateway alias directly with validated synthetic authorizer
context, and removed every fixture before completion.

This is not managed-OIDC, API Gateway/JWT/JWKS, browser, real-provider, or real-candidate evidence.
It does not complete D1-005 or any Phase 1 exit by itself.

## Release evidence

- Migration-image publication receipt SHA-256:
  `2392af445e66b003c4c8ee1ad0fca26155afbd597fa0f36e9b5371383783eaf4`.
- Gateway publication receipt SHA-256:
  `2d42767cc9cb361b73a3e6cd8eb42088dcdc1ba15d334d66ba0efff628b83070`.
- The migration image passed deterministic Linux/AMD64 identity, hardened runtime smoke,
  immutable readback, and a complete zero-High/zero-Critical scan.
- The saved Terraform release plan SHA-256 is
  `e49c58568711cf4dac9acfcc85f98faa01c2188cec9ef0bc066c71aef265e011`.
  It changed only the gateway function, its unweighted alias, and the idle migration task
  definition. The only output change was the expected task-definition revision.
- Live verification recorded state serial `140`, gateway alias version `28`, migration task
  revision `28`, exact artifact/image identities, no alias weights, and zero running ECS tasks.
- Final refresh-backed zero-drift plan SHA-256:
  `f24a3d3c8b1d64caf9c174aca9c629b98193844ff710d5f5063592927d1fd68c`, with zero resource and
  output changes.

No route, trigger, ECS service, provider source, or public-reader activation changed. Docker and
WSL were shut down after the final image publication.

## Operator corrections discovered by live preflight

The fail-closed operator stopped before mutation on two AWS response-shape differences and then
rejected successful stopped tasks on one ECS readback default. Source and dual-shell regression
tests now cover all three:

- omitted empty ECS task-definition collections are treated as empty while nonempty values remain
  rejected;
- omitted empty S3 version/delete-marker and ECS/log response collections are normalized without
  inventing entries; and
- the empty `inferenceAcceleratorOverrides` collection that ECS adds to `describe-tasks` readback
  is removed before comparison, while any nonempty accelerator override remains rejected.

The earlier prepared fixture was independently proven cleaned by a cleanup task with exit code
`0`, one aggregate result, three affected Jobs rows, and an advanced catalog revision. It carries
no acceptance claim. The final acceptance used a new durable claim and a new run identity.

## Acceptance evidence

- Execution-plan SHA-256:
  `f54b9007cc4264d2c8be0540c927bb140b7761c4af5712950aa5b1ec9f5d76bb`.
- Acceptance-receipt SHA-256:
  `57b3a365f9ce8a525aa5a57463f79d971b734503aa44cbf384c468f47184ec1e`.
- Exactly three bounded tasks ran: prepare, mutate, and cleanup.
- The baseline search returned the expected two generated-synthetic jobs.
- A catalog mutation made the retained cursor stale; the exact stable response was HTTP `409`.
- A fresh restart returned both jobs in order with zero duplicates.
- Cleanup returned the fixture search to zero jobs and left zero persistent fixture rows.
- Independent `Verify` repeated the post-cleanup gateway read, proved zero active tasks, and
  reported no Terraform-state change and no verification-time cloud mutation.

## Remaining D1-005 gates

- Managed-OIDC and real API Gateway/JWT/JWKS browser acceptance.
- Deployed saved-job authorization/recovery acceptance and deployed Matching explanation
  acceptance through the candidate web surface.
- Representative reliability/load evidence and human accessibility, security/privacy, and product
  acceptance.
- Real provider and real candidate use remain prohibited pending their separate approvals.

