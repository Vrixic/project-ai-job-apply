# D3 native API scope admission — 2026-10-11

D3-114 started 2026-10-11. The native in-memory SPA requests `applications:read`, but the deployed API Gateway JWT route admitted only job/profile/document scopes. The worker's second authorization proof therefore could not reach the owning controller. The original browser reported a safe service failure; its underlying HTTP status was not captured.

The route now includes application read/write scopes when Applications is deployed. JWT authorization, integration, controller-specific scopes and owner checks remain unchanged. Two focused Terraform mock plans cover document intake on/off; three focused controller tests verify missing/read-only scope refusals. All pass. Independent consequential source review passes. No full repository checks were run.

Managed deployment and another synthetic native journey are pending. This source correction does not establish successful live preview, approval, download or submission. AI and employer submission remain off behind their existing external gates; independent D1/admin acceptance stays deferred.
