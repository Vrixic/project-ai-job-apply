# ATS Fixtures

This tree stores inert, integrity-pinned application-form fixtures. A fixture may be fully
synthetic or an authorized provider-derived page that passed the acquisition, sanitization,
scanning, and human-review process. Raw captures and restricted evidence never belong here.

## Layout

- `fixture-metadata.v1.schema.json` — Versioned manifest contract.
- `validate-fixtures.mjs` — Fail-closed metadata, integrity, and lexical safety validator.
- `validate-fixtures.test.mjs` — Validator regression tests.
- `templates/` — Non-evidence intake and manifest checklists; templates are not fixtures.
- `synthetic/` — Synthetic foundation fixture; it represents no provider.
- Future provider evidence — One directory per fixture/variant, each with `metadata.json` and only
  its sanitized payloads.

Run:

```powershell
pnpm --filter @ai-job-apply/test-fixtures test
```

Passing validation proves repository structure and declared integrity. It does not prove source
authorization, legal/privacy approval, security/privacy approval, or representative provider
coverage. See the [fixture policy](../../../docs/product/foundation/ats-fixture-policy.md).
