# Terraform Modules

Reusable, environment-neutral infrastructure components live here. Modules expose explicit inputs
and outputs, contain no account credentials, and default to encrypted, lean, recoverable
resources. Private networking, replicas, caches, and Multi-AZ capacity are explicit
measured-demand or launch-review changes.

- `platform/` owns the environment runtime, data plane, ingress, secrets, and observability.
- `cost-controls/` owns the account-local monthly budget and CUR 2.0 export/storage controls.

- `native-resume-task/` supplies an unattached, default-empty native resume task/role release; no environment currently instantiates it.

- `native-resume-source-access/` supplies an unattached owner/source Lambda pair with separate bounded roles and disabled runtime defaults.

- `native-resume-preparation/` supplies unattached private control, durable and dispatcher release wiring with disabled launch/schedule defaults.
