# Staging Environment

Composes an on-demand pre-release environment in its own AWS account in `us-east-2`. It uses a
non-overlapping network and the same fail-closed application-deployment gate as development.
Provision it for release candidates, destructive migration rehearsals, restore exercises,
security acceptance, and launch—not as an always-on duplicate throughout every delivery.

The launch boundary uses a staging-only Auth0 tenant and clients and never reuses development or
future production identity configuration. Until launch preparation, controlled synthetic-only
staging may temporarily trust the exact development Auth0 issuer and stable audience under
[ADR-014](../../../../docs/adr/014-shared-development-auth0-for-synthetic-staging.md). This does
not prove identity isolation and permits no real users, invited testers, public access, live ATS
submissions, or release-candidate claim. Dedicated staging and production tenants plus replayed
conformance are mandatory before launch.
