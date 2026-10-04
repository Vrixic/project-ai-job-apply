# Isolated cover-letter provider object policy

This provider-free module renders an **unattached S3 identity policy**. No environment calls it;
it creates no role, bucket policy, function, permission, network path or activation flag. It is a
reviewable source prerequisite for proposed [ADR-037](../../../../docs/adr/037-precreated-cover-letter-provider-slots.md),
not deployed isolation, a complete execution-role policy or a quiescence certificate.

Inputs identify an exact platform bucket, account and same-account `us-east-2` customer KMS key.
Reads cover only the fixed request/dispatch/result JSON slots; writes cover dispatch/result only.
Explicit denies reject other S3 resources/actions, request writes, deletion, missing/empty/wildcard
If-Match, copy-source writes, missing/wrong encryption and insecure transport. Additional Allow
statements cannot override these denies. KMS, model-secret, logging and private RPC permissions
are neither granted here nor replaced by this policy.

[AWS conditional-write enforcement](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html)
supports `s3:if-match`. This policy omits the documentation's multipart exemption: APIs that
cannot supply the header receive no exception. Matching an existing ETag remains an S3 service
precondition, not a local IAM test. The deny using `NotAction` is scoped to ordinary S3 ARNs;
[AWS documents that Resource scopes applicable actions](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notaction.html).

IAM `*` can match slashes. These paths do not validate document UUIDs, candidate ownership,
request hashes, state transitions or object versions. The owning reservation and canonical
handler/S3 transport must still enforce those bindings. Broad reads within these slot patterns
require independent data-access review. No grant to the private initializer or deletion worker is
supplied, and their separate creation/drain problem remains open.

Before any attachment, review the complete provider role/boundary, bucket/access-point policies,
KMS and exact-version private caller policies, immutable runtime and restore/deletion evidence.
Keep existing functions and flags dark. Acceptance must test actual S3 refusal of missing keys,
current delete markers, bad ETags, creation, deletion, copies, multipart and extra IAM grants.
Offline policy evaluation cannot stand in for that deployed evidence.

With approved Terraform 1.16.2 on PATH, run:

```powershell
terraform -chdir=infrastructure/terraform/modules/cover-letter-provider-objects init -backend=false
terraform -chdir=infrastructure/terraform/modules/cover-letter-provider-objects validate
terraform -chdir=infrastructure/terraform/modules/cover-letter-provider-objects test
node --test scripts/tests/cover-letter-provider-object-policy.test.mjs
```

The Node suite renders an actual synthetic Terraform plan and exercises the policy's supported
IAM operators locally, including additional broad S3 grants. No AWS request, credential, state
write, database, Docker or candidate data is used.

Read-only AWS validation also reports zero errors/security warnings and one intentional
literal-star comparison warning; 61 AWS custom-policy simulator evaluations pass. These checks
do not attach the policy or contact S3. See the retained
[source evidence](../../../../docs/product/delivery/evidence/d3-provider-object-policy-source-validation-2026-10-04.md).
