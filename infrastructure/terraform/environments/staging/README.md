# Staging Environment

Composes an on-demand pre-release environment in its own AWS account in `us-east-2`. It uses a
non-overlapping network and the same fail-closed application-deployment gate as development.
Provision it for release candidates, destructive migration rehearsals, restore exercises,
security acceptance, and launch—not as an always-on duplicate throughout every delivery.
Use a staging-only Auth0 tenant and clients; never reuse development or future production identity
configuration.
