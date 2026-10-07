# Native resume private source access

Source-only module for the owner and retained-source RPC functions in Proposed ADR-040.
Development and staging expose optional release maps, empty by default. A null release creates no resources; an exact release
creates two versioned Node.js Lambda functions and separate bounded execution roles. Both
handlers remain disabled unless `enabled = true` is explicitly supplied.

The release pins both ZIP object versions, artifact hashes, source commit, original task
revision, cluster, database secret, platform key, extension layer and existing private network.
Only the source function receives versioned read permission for retained normalized resume JSON;
the owner function explicitly denies S3. Neither function may launch tasks, invoke other functions
or write resume objects. Both use the existing application log group and workload boundary.
There is no public URL, API route, schedule or resource-based invocation grant.

Prepare the pair before building the image, which pins their numeric qualified function ARNs.
Use the same reviewed original task revision as the task module: the expected task role is
`ai-job-apply-<environment>-native-resume-r<revision>-task`. The eventual task must match that
binding. Changing the runtime gate publishes new versions; it does not disable existing numeric
versions. Build against the intended enabled versions only after release prerequisites pass.
Retain original module instances, function versions and roles until trusted allocation drain
permits retirement. Module removal is not a safe launch kill switch.

The supplied subnets/security groups must reach the owning database and the regional Secrets
Manager, STS and S3 services as required by the existing handlers. Network paths, bucket/key
resource policies, extension compatibility and effective workload-boundary permissions require
managed verification. This module creates none of those dependencies. The source bucket holds
retained normalized originals, not newly generated resume content. Database URLs, credentials,
TLS secret values and candidate data are not module inputs.

Terraform 1.16.2 validation and five mocked tests cover absent defaults, disabled/versioned
configuration, owner/source permission separation, explicit activation and invalid targets.
The configured variable names were checked against the current handler sources. These checks
are not enabled-handler execution or managed end-to-end evidence.

```powershell
terraform -chdir=infrastructure/terraform/modules/native-resume-source-access init -backend=false -lockfile=readonly
terraform -chdir=infrastructure/terraform/modules/native-resume-source-access validate
terraform -chdir=infrastructure/terraform/modules/native-resume-source-access test
```

Remaining composition includes preparation control, durable execution, request dispatch and
private task routing, followed by managed acceptance. No deployment or activation is implied.
