# Web Application

The primary candidate experience: onboarding, profile management, job discovery, application review, technical history through confirmed submission, outreach, billing, settings, and crawlable public job pages.

## Planned subfolders

- `app/` — Next.js routes, layouts, server components, and route handlers.
- `features/` — Product modules such as jobs, applications, profile, and billing.
- `components/` — Web-only composed components.
- `lib/` — Generated API clients, session helpers, and browser-safe utilities.
- `public/` — Static assets.
- `tests/` — Unit, accessibility, integration, and browser tests.

The web app orchestrates presentation only. Long-running preparation and submission work is started through backend APIs and displayed as durable workflow state.
