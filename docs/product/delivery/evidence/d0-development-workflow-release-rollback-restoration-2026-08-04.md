# D0 Development Workflow Release Rollback and Restoration — 2026-08-04

## Scope

This record covers the checksum-authorized rollback from the accepted current development
workflow release to the accepted known-good prior release, conformance of that rollback release,
checksum-authorized restoration, conformance of the restored release, and local recovery-context
cleanup. It is D0-016 development dark-deployment evidence only. It does not authorize triggers,
public Lambda routing, staging deployment, cutover, legacy-runtime retirement, or production use.

No account identifier, ARN, endpoint, credential, secret, candidate value, raw payload, raw log,
notification destination, or product record is retained here.

## Accepted release boundary

The coordinator ran from exact committed `main` at source `eeb12c6` and reconstructed both release
sets from retained reviewed Terraform plans:

- accepted current release source: `281bd9126a2859b854abb2832018d8df1adcb787`;
- accepted rollback release source: `f207bc01d73505244b5e96b8c1005e622953d4f5`.

The strict planner required the complete live dark boundary to be healthy before either plan:
immutable versioned aliases, bounded concurrency, KMS encryption, disabled workflow triggers,
seven healthy alarms, an empty durable DLQ, a complete durable stack, idle retained ECS services,
unchanged API traffic, and refresh-backed zero drift.

## Rollback

The reviewed reverse plan had checksum
`c60d705b64225d1b1da301b4549178e7b6104a11e0b2ccf672edf09cbe9b65d8`. Semantic inspection
accepted exactly:

- zero standalone creates or deletes;
- fourteen bounded updates; and
- one create-before-delete IAM propagation-gate replacement.

After explicit checksum authorization, only that saved plan was applied. Terraform reported the
replacement as one add and one destroy plus thirteen in-place changes. Post-apply verification
proved the accepted rollback source active with zero drift, disabled triggers, idle ECS, and no API
traffic change.

The separately reviewed rollback conformance context had checksum
`4a6d8362af69c4f4bc2e96328d9521113ca5dee9ff6191c3032ea439833b4da8`. Its authorized execution
proved:

- three synchronous invalid handlers reached their expected fail-closed responses;
- the exact durable version asynchronously reached the expected failed state;
- exactly one byte-identical synthetic DLQ message was deleted and the DLQ returned empty;
- the two owned alarms each completed `OK → ALARM → OK`, for four transitions total;
- the reconciler was not invoked and no product data was written;
- triggers remained disabled and public traffic remained unchanged; and
- the conformance context removed itself.

The product owner confirmed receipt of two `ALARM` and two `OK` notification emails without
retaining their destination or contents.

## Restoration

The separately generated forward plan had checksum
`2c5746491e400121e95f80b8cc01b5393cfd5d74d97a54aaea5f61a8a7bbad9c` and the same exact
fourteen-update/one-propagation-gate boundary with zero standalone creates or deletes. After
explicit checksum authorization, only that saved plan was applied. Post-apply verification proved
the accepted current release restored with zero drift, disabled triggers, idle ECS, and unchanged
API traffic.

The restored-release conformance context had checksum
`3954c7e614c3ab981011cbf57993422d031b937e1548ef80c3737b64c729fd80`. Its separately authorized
execution repeated all four fail-closed probes, exact synthetic DLQ deletion, four alarm
transitions, empty-DLQ recovery, context removal, and the no-reconciler/no-product-write/no-trigger/
no-traffic-change boundary. The product owner again confirmed receipt of the two `ALARM` and two
`OK` recovery notifications.

## Cleanup and result

After restored-release conformance and notification acceptance, the coordinator performed a final
zero-drift check and removed only its ignored local recovery context plus the saved reverse and
forward plans. Final status reported no retained context, rollback plan, or restoration plan.

The development known-good coupled workflow rollback/restoration gate is complete. D0-016 remains
in progress for isolated staging serverless deployment and acceptance, both controlled cutovers,
obsolete-runtime retirement, Temporal removal, and post-cutover cost reconciliation.
