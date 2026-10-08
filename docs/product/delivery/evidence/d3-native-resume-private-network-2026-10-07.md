# D3 resume private API network - 2026-10-07

D3-064/D3-079 remain In progress. Platform source now supplies private ECS API access for
original resume preparation releases and EC2 API access when their DNS route is configured.
Both environments derive the network inputs from their existing original preparation releases.
No cloud resources, live release values or activation switches changed.

`native_resume_control_network` binds numeric original task revisions, same-account us-east-2
clusters and the exact Lambda security groups. With a persistent data plane, the module creates
one ECS interface endpoint in the first private subnet, with private DNS and TCP 443 ingress
from only the supplied groups. EC2 is added only when original address lookup is configured.
Empty inputs and dormant data planes create neither endpoint nor endpoint security group.

The ECS endpoint admits RunTask for the original task definition, control role and cluster with
remote exec disabled. DescribeTasks admits original control/observer roles within the original
cluster. DescribeTaskDefinition requires wildcard resources; the runtime verifies the exact
original definition. EC2 admits only DescribeNetworkInterfaces from original route-enabled
control roles. Its wildcard resource follows the API's metadata permission model; the runtime
checks original ENI/task/network identity. Endpoint policies constrain existing IAM permissions;
they do not replace role policies or permissions boundaries.

Only the ECS API endpoint is needed for these Fargate control calls; this change does not add
EC2 container-agent endpoints, NAT, internet egress, task mutation or image-pull routing.
References: [ECS endpoints and policy](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/vpc-endpoints.html)
and [EC2 interface endpoint policy](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/interface-vpc-endpoints.html).

## Local verification

Terraform 1.16.2 passes five new mocked network tests plus seven existing native RPC/secret tests
(12 total). Coverage includes default absence, dormant absence, launch without unused EC2,
foreign-account refusal, original security groups, original launch scope, read-only observer and
control-only address metadata. Development and staging configuration validation passes.
The dormant fixture initially hit the existing database deletion-protection precondition; only
that synthetic test fixture was corrected to express an already-dormant database configuration.

These are mocked plans and static validation, not deployed reachability or effective IAM proof.
No full verifier, registry audit, AWS call, Docker/WSL startup or PC shutdown occurred.

## Remaining launch work

Retain original endpoint policy entries until trusted drain, including when creation is disabled.
Private DNS affects other callers of ECS/EC2 in this VPC: inventory any additional callers before
activation and explicitly review their access rather than opening the endpoint policy globally.
Verify supplied Lambda groups allow outbound TCP 443 and belong to this VPC; the platform's
standard application group already permits outbound connections. Custom release groups remain
caller-owned. Verify endpoint DNS, network ACLs, role/boundary intersections and original task
launch/address reads in the managed environment. This closes source endpoint composition only.

Hostname/zone ownership, task TLS/ingress, terminal unresolved-route reconciliation, immutable
publication and managed download acceptance remain. Prior dependency findings remain open.
D1 and D3 remain incomplete; ADR-040 remains Proposed and CI/CD stays deferred.
