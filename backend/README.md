# Backend

This directory contains the Platform's server-side control plane, durable workflows, and isolated task workers. Backend components own business state and external side effects; clients interact through the gateway and versioned contracts.

## Subfolders

- `gateway/` — Public API gateway and backend-for-frontend.
- `services/` — Domain services and their owned data boundaries.
- `workers/` — Asynchronous ingestion, AI, ATS, browser, and messaging execution.
- `workflows/` — Durable orchestration definitions.

Logical service boundaries do not require a separate deployment for every folder on day one. Modules may share a deployable initially while retaining explicit APIs, schema ownership, and failure boundaries.
