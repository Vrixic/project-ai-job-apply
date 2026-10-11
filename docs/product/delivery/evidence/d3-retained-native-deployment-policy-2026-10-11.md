# D3 retained native deployment policy — 2026-10-11

D3-111 fixes the managed IAM deployment policy size failure when retaining resume revision 1 and
adding revision 2. The original annotated policy was 6,912 characters. Serialized deployment grant
and boundary now omit optional statement identifiers and two state grants already wholly covered
by existing unconditional S3/KMS platform authority. The actual complete development inputs produce
5,913 characters. All other actions, resources and conditions remain identical; original revision
role/boundary grants remain separate. No release or permission ceiling is removed.

All 25 bootstrap component Terraform test runs, configuration validation, changed-file formatting
and diff checks pass. Regressions cover two retained revisions alongside the existing preparation,
material and primary deletion safeguards, identical emitted grant/boundary, unchanged statements,
state-grant subsumption and exact original role/boundary restrictions. Consequential source review passes; managed
application are recorded separately; local mocked tests do not establish effective managed IAM.

The enabled r2 worker image and current migration image are published with complete ECR scans and
zero High/Critical findings. Worker smoke passes 24 actual isolated assertions; two clean migration
builds are byte-identical and package/checksum smoke passes. Six native Lambda archives and compatible
Gateway/cleanup archives are published immutably. The protected candidate host serves the D3-110
build. Publication does not establish native generation or submission acceptance.

Development is in an active writer-off test batch: the restored database is private, encrypted,
protected with 35-day backups, and its connection secret/public-reader physical binding is verified.
Basic completed-deletion reconciliation precedes candidate traffic. Docker and WSL are off; AWS
data-preserving shutdown remains required before handoff. Private receipts/logs remain under ignored
`.tmp/d3-primary-recovery-20261010/`. The PC stays on. D3 remains In progress; AI retention policy
and authorized ATS QA/fixtures remain external blockers. Independent D1/admin acceptance is deferred.
