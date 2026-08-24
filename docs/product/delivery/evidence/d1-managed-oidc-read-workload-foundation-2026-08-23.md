# D1 Managed-OIDC Read Workload Foundation

Date: 2026-08-23  
Source: `2056dabbbe79a18820a432608aab041fd1fef92d`  
Environment boundary: synthetic development

## Outcome

The remaining deployed-read assurance gap now has an executable, fixed, aggregate-only operator
surface. After the existing launcher validates AWS, Terraform, Auth0, API Gateway, Lambda, durable
triggers, and the idle ECS boundary, an approved synthetic managed-OIDC session can run the bounded
D1 read workload at `/d1-conformance`.

The current source closes the missing workload implementation/runbook gap. It does not claim the
authenticated workload was executed: this Codex session did not expose the repository-approved
browser controller, and no user credential, password, MFA code, token, or browser cookie was read or
handled. One approved synthetic-user login and explicit in-page confirmation remain required.

## Fixed profile and safety

- Development-only opt-in switches; the route is absent from normal production behavior.
- Same-origin POST and exact confirmation string before traffic.
- Managed token remains server-held and is sent only to the already validated deployed API origin.
- Exact generated-schema validation for preferences, entitlements, canonical job search, and
  owner-scoped saved jobs before load.
- Development concurrency `2`, matching the deployed gateway reserved-concurrency ceiling.
- 150 public requests: 50 liveness, 50 readiness, and 50 expected unauthenticated entitlement
  denials.
- 100 authenticated requests: 25 each for preferences, entitlements, canonical job search, and
  saved-job search.
- Fixed 15-second request deadlines, three-minute browser ceiling, and single-flight enforcement.
- Aggregate result only: timestamps, counts, failures, duration, and p50/p95/max latency.
- No write, job report, saved-job mutation, preference mutation, provider activation, provider
  request, external ATS effect, or real candidate data.
- No token, identity, preference, job, saved job, request/response body, endpoint, Auth0 identifier,
  or AWS identifier in the result.

## Verification

- Focused workload and client tests: 8/8.
- Complete web tests: 498/498 across 38 files. One unrelated timing-sensitive resume test failed in
  an earlier full run and passed both its immediate isolated rerun and the subsequent full run.
- Web typecheck passed.
- Web production build passed and included only dynamic opt-in D1 conformance routes.
- Repository formatting and lint passed; lint retained only the six pre-existing repository
  warnings.
- The existing managed-OIDC launcher passed exact live development preflight: Auth0
  issuer/audience, API Gateway JWT authorizer, numeric unweighted Lambda alias, durable triggers,
  idle ECS, and public `200/200/401`.
- With the D1 switch enabled, local readback returned page `200`, displayed the exact synthetic-login
  requirement, returned `401` for a correctly confirmed workload request without a managed session,
  and exposed no private configuration marker in rendered HTML.
- The local server was stopped after verification. Docker and WSL remained stopped.

## Remaining execution and acceptance

1. Start the reviewed launcher with `-EnableD1WorkloadConformance`.
2. Sign in through Auth0 with the approved synthetic account and ensure it has saved synthetic
   preferences.
3. Run the exact fixed profile and retain only its aggregate timestamps/metrics.
4. Corroborate that exact window through the read-only development workload inspector.
5. Later repeat/extend against the frozen Phase 1 candidate with populated exact-source fixtures,
   write/failure/recovery paths, and accountable acceptance.

An empty catalog or empty saved-job page is a valid schema-bound read, so this profile cannot alone
close the representative-data, provider-failure, write/recovery, latency-SLO, human accessibility,
security/privacy, or Phase 1 completion gates.

[Runbook](../../../../infrastructure/runbooks/observability/development-d1-read-workload.md)
