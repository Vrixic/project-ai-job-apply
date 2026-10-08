# Original resume private secret connectivity

Optional environment release maps derive `native_resume_secret_readers` from original task
revisions and reviewed secret identifiers. Owner/source/control/dispatch/observer roles receive
only their selected database secret through the Secrets Manager VPC endpoint. The native task
role receives only its TLS secret and immutable VersionId. Durable orchestration receives no
secret permission. IAM/resource/key policy checks remain independent; this endpoint does not
broaden the runtime role's permissions.

The endpoint is provisioned for native-only releases while the persistent data plane is active.
Exact caller security groups from source/preparation release inputs join its TCP443 ingress list.
Source and preparation modules wait for platform completion. No secret value enters Terraform.
An empty legacy Lambda-role list is omitted rather than emitted as an empty IAM condition.

Dormant staging can prepare disabled release configuration; it does not create a private endpoint
or database. Source/preparation activation is refused while staging_runtime_mode is dormant.
Retain original entries and security groups until the reviewed drain: removing bindings can break
retained numeric functions and unresolved tasks. Standalone module consumers must provide
corresponding endpoint, routing and security-group configuration themselves.

Four focused platform tests cover no-resources defaults, role/secret/version separation, caller
network wiring, missing TLS version and foreign-role rejection. Ten maintenance tests still pass;
three release-composition cases pass in each environment. These are mocked-provider checks.
Effective AWS requests, caller IAM, native networking,
TLS/DNS routing and end-to-end acceptance remain separate prerequisites. No cloud state changed.


## Private RPC and normalized-source reads

Environment release maps now also derive exact task RPC bindings, dispatcher revisions and
normalized-source bucket bindings. The shared Lambda endpoint permits each original task role
only its two numeric owner/source functions. Its dispatcher permission selects only that original
revision's durable function (`:*` at the endpoint); the dispatcher IAM policy narrows invocation
to the numeric version produced by the release. The qualifier wildcard avoids a dependency cycle
between platform endpoint creation and the later Lambda version, and never grants another caller
or another original function. Keep both policy layers in release review.

The existing document S3 gateway endpoint grants only the original source role GetObjectVersion
on the reviewed bucket's `normalized/*/*/*/resume.json` shape. It adds no List/GetObject/write/delete
or task-role object permission. Actual source ownership/version/digest checks remain runtime-owned.
Source activation requires the existing parser-dark or complete-dark document foundation; disabled
source predeployment still works. Routes and caller subnets must match the reviewed environment.

Three focused mocked cases cover empty defaults, the connected document/RPC policies and rejection
of aliases/foreign revisions. Environment and existing serverless tests provide regression coverage;
managed requests and current key/role/bucket policy evaluation remain release prerequisites.
