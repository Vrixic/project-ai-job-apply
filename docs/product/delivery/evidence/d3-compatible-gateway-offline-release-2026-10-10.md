# D3 compatible Gateway installation — 2026-10-10

D3-107 installs the previously verified immutable Gateway artifact from source
`e061b9106cc8d8d3198e38a877d530592b0117f4`, SHA-256
`f8139c9499c51b6118d3c33df823b0b18aef1af3dacab81c220d270246970355`.
Focused source/contract comparison establishes compatibility with current resume and saved-answer
APIs and retained native artifacts; this is not a new build from current main.

Fresh versioned S3 checksum/encryption/source readback passes. The exact reviewed Terraform plan
`44a4be253104c656fb63a05b94a3654707e2fb03f185d828048e0baab6b83fc7`
changes only Gateway and its alias, with four known read-only metadata reads. Application/runtime
activation remains disabled. Live readback confirms numeric version **90**, exact code checksum
and release hash, Active/Successful state and an unweighted development alias. Independent
compatibility, plan and installed-release reviews pass. No full repository checks were run.

Development shutdown readback at **2026-10-11T03:25:57Z** confirms actual writer/queue drain,
zero project databases, NAT gateways, paid interface endpoints, EIPs, temporary replay executors
and restore roles. The exact removed primary's encrypted safety and final snapshots are available;
automated backups are retained. Latest full dormant inputs are archived in the encrypted,
versioned state bucket with exact-version checksum readback. Docker/WSL are off; the PC is on.
Snapshots/backups, S3/ECR, KMS and secrets retain costs. Staging was not accessed in this batch.

The existing candidate Vercel production deployment from `8e663f9f` is Ready. Its four public
native UI/SPA/base-host settings are absent; server authentication settings exist. HTTPS native
configuration, live owner authentication, actual native bindings and the installed connected
journey remain internal work. Installation is verified, not live D3 acceptance.

The owner confirms no qualifying provider retention policy exists. Live AI cover-letter testing
remains externally blocked and disabled under ADR-038. Authorized provider fixtures and acceptance
also remain open; synthetic fixtures do not establish provider acceptance. Independent D1/admin
acceptance remains deferred.
