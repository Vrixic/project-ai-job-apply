# D1 Moderation Implementation Baseline

- State: Implemented technical candidate; accountable policy approval remains open
- Administrative deployment/activation: prohibited (`false`)
- Real candidate reports/provider data: prohibited (`false`)
- Source resume: absent and prohibited

The implemented candidate follows the recommended conservative baseline:

- a dedicated Auth0 Regular Web Application and administrative session boundary;
- exact API audience and only `openid profile jobs:moderate` scopes, with no offline access;
- MFA authentication context and required `amr=mfa` proof;
- reauthentication/inactivity at 15 minutes and absolute session expiry at one hour;
- no reporter identity or cross-report candidate linking in ordinary moderation;
- aggregate fixed-reason summaries only;
- explicit version-fenced, two-step human `no_action`, job block, or exact
  source/adapter/configuration pause;
- no report-, threshold-, or alert-driven lifecycle mutation; and
- no source resume/reactivation operation.

The backend and console enforce these technical constraints, but this baseline is not a D1P
approval. Auth0 tenant MFA factors, the post-login Action/policy that honors the requested MFA ACR,
the dedicated client grant, hosted admin deployment, retention/deletion/export rules, thresholds,
alert recipients, correction/takedown/appeal policy, and named Product/Security/Legal/Operations
sign-off remain external accountable decisions. Every corresponding worksheet authorization flag
therefore remains `false`.
