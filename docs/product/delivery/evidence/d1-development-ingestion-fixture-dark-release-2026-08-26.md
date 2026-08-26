# D1 development ingestion fixture default-dark release — 2026-08-26

## Outcome

Exact source `8d2cec438103fcc866aa9b50e9ddd380818345d5` is immutably published and
deployed in development through the reviewed exact twelve-change ingestion fixture plan. The apply
advanced the encrypted, versioned Terraform state to serial `220` and preserved the complete
default-dark boundary.

The release is bound to these reviewed records:

- ingestion publication receipt SHA-256:
  `577f6087b0355e9869909ff4e25bea7fcc9471c6d50f224a011ae216ac341f0a`;
- saved plan SHA-256:
  `a2ebf968fdb551e53f96df18c36de9008592a82400de6d883b62362ccc124c4e`;
- plan receipt SHA-256:
  `17a4c4e35f870360d225e23f9c3c26f8a7172db14b2c9ae9598fd1cca03a3e58`;
- verification receipt SHA-256:
  `ad91c02480f69d4ae90aafbd5a370d02016c41992fa5c4b4d32d0e09901a961a`;
- refresh-backed zero-drift plan SHA-256:
  `766e91f4c854c46b3f028045b4cfeb86b4fb5b41e0931b5cc4d3f28c22b95063`.

## Safety corrections and topology

Three clean-main corrections were included before the accepted release:

- `8582218` verifies the exact qualified ingestion event-source mapping inventory;
- `53be8b9` handles EC2 local routes without weakening exact Terraform-owned NAT checks; and
- `8d2cec4` keeps zero-drift subprocess output outside the machine-readable verification result.

The activity remains on the shared application-private topology. Its legitimate application NAT is
not evidence of provider activation. The accepted boundary is narrower and exact: no dedicated
ingestion-provider NAT, subnet, or route is used; provider authority is false; the source inventory
is empty; schedules, terminal handling, and event-source mappings are disabled; and the final plan
has zero drift.

## Non-claims and remaining work

This release proves immutable publication, the exact twelve-change default-dark apply, live
verification, and zero drift. It does not claim a provider request, provider-failure fixture
execution, catalog write, document corpus execution, representative SLO, alert delivery, Vercel
deployment, human accessibility review, or accountable security/privacy/product acceptance.

Phase 1 remains `In progress`. The next isolated engineering action is the bounded aggregate-only
provider-failure execution. Thresholds, recipients, and alert receipt remain separate accountable
inputs and must not be inferred from this release.
