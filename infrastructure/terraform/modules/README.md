# Terraform Modules

Reusable, environment-neutral infrastructure components live here. Modules expose explicit inputs
and outputs, contain no account credentials, and default to encrypted, lean, recoverable
resources. Private networking, replicas, caches, and Multi-AZ capacity are explicit
measured-demand or launch-review changes.

- `platform/` owns the environment runtime, data plane, ingress, secrets, and observability.
- `cost-controls/` owns the account-local monthly budget and CUR 2.0 export/storage controls.
