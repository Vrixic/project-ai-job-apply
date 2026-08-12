# ATS Fixture Acquisition and Sanitization Policy

- Status: Process and automated repository gate implemented; provider evidence is owned by the
  delivery that activates each adapter under [ADR-021](../../adr/021-own-provider-fixtures-with-adapter-deliveries.md)
- Policy version: `ats-fixture-policy-2026-08-12`
- Accountable roles: QA/automation; legal/privacy counsel; security/privacy reviewer
- Executable metadata contract:
  [`fixture-metadata.v1.schema.json`](../../../packages/test-fixtures/ats/fixture-metadata.v1.schema.json)
- Repository validator:
  [`validate-fixtures.mjs`](../../../packages/test-fixtures/ats/validate-fixtures.mjs)

This policy governs test evidence, not production ingestion. A fixture being safe to store does not
authorize retrieval, automation, submission, redistribution, or any other provider behavior. A
synthetic fixture can prove tooling behavior but can never satisfy the representative-provider
evidence gate.

## Allowed inputs

- Fully synthetic HTML/forms created for tests.
- Public provider examples only when accountable counsel records that the applicable terms and
  rights permit the exact capture, sanitization, storage, and testing purpose.
- Controlled employer or provider test tenants with written authorization for the exact purpose.
- User-provided pages only with specific, recorded consent and a documented lawful storage purpose.

Until foundational approval is recorded, only the first category may enter shared development,
CI, staging, demos, or this repository.

## Prohibited inputs

- Production candidate resumes, answers, credentials, cookies, tokens, demographic data, or raw
  user artifacts.
- Pages captured behind authentication without written authorization.
- CAPTCHA/MFA artifacts, authentication challenges, remote-browser recordings, or live session
  state.
- Third-party fixtures with uncertain provenance or authorization.
- Executable scripts, network-loading resources, tracking identifiers, or forms that can submit to
  an external endpoint.
- A raw capture, quarantine archive, authorization letter, reviewer identity, source-account ID,
  private URL, or other restricted evidence committed to Git.

Reject rather than partially redact a fixture whenever provenance, authorization, or safe
sanitization is unclear.

## Evidence classes

| Class | Meaning | May satisfy the representative gate? |
|---|---|---|
| `synthetic` | Authored solely for testing; no real provider, tenant, job, or candidate represented | No |
| `sanitized_authorized_provider` | Derived from an exact provider/variant under recorded authorization, sanitized and independently reviewed | Yes, but only after a separate representative-review acceptance |

Provider-family naming in a synthetic fixture is prohibited because it could be mistaken for
provider evidence. Provider-inspired behaviors may be described with neutral behavior tags.

## Reproducible intake workflow

1. **Open an intake record outside Git.** Record an opaque evidence ID, exact provider family and
   variant, source category, intended behavior coverage, accountable owner, acquisition date,
   applicable terms/policy version, authorization scope, authorization expiry and revalidation
   date, retention, and deletion owner. Use
   [`authorized-provider-intake.template.json`](../../../packages/test-fixtures/ats/templates/authorized-provider-intake.template.json)
   as the field checklist. Do not put credentials, private URLs, account IDs, raw terms, or people’s
   names in repository metadata.
2. **Obtain the blocking dispositions.** Accountable legal/privacy review must permit the exact
   capture/storage/test use. Accountable security/privacy review must approve the quarantine,
   sanitization, scanning, evidence, and deletion controls. One provider or variant does not
   authorize another.
3. **Capture into restricted quarantine outside the repository.** Encrypt the capture, deny CI and
   general developer access, log access, and set deletion no later than 30 days after capture.
   Never capture authentication, CAPTCHA/MFA, cookies, tokens, or candidate content.
4. **Sanitize into a separate working copy.** Remove names, emails, phones, addresses, account and
   tenant IDs, cookies, tokens, hidden identifiers, tracking parameters, free-text candidate
   content, private URLs, scripts, executable content, network-loading resources, and form actions.
   Replace employer, job, URL, and person values with obviously synthetic reserved examples.
5. **Run automated checks.** Run the repository validator plus approved secret and PII scanners on
   the sanitized tree. Record tool/version, run date, pass result, and opaque evidence ID. Scanner
   logs stay outside Git if they could contain matched content.
6. **Perform human content review.** A reviewer inspects rendered and source representations,
   confirms the absence of identifying/live content, and checks that sanitization did not remove
   the behaviors claimed in metadata. Record an opaque reviewer ID, date, result, and evidence ID.
7. **Perform representative review.** A qualified QA/automation reviewer separately accepts or
   rejects whether the sanitized fixture represents the named provider variant and claimed
   behavior tags. Sanitization approval alone is insufficient.
8. **Dispose of or time-bound the raw capture.** Record destruction evidence, or a quarantine
   deletion deadline no later than 30 days after capture. The repository validator fails an
   approved fixture whose quarantine deadline has elapsed.
9. **Create the repository manifest and integrity record.** Copy the
   [`authorized-provider-metadata.template.json`](../../../packages/test-fixtures/ats/templates/authorized-provider-metadata.template.json)
   checklist, use only opaque evidence references, list every payload byte count and SHA-256
   digest, then run `pnpm --filter @ai-job-apply/test-fixtures test`.
10. **Merge only the sanitized package.** Reviewers confirm the diff contains only approved
    sanitized payloads, metadata, and non-sensitive documentation. Any later payload change
    invalidates its checksum and requires the scanners and both human reviews to be repeated.

## Repository acceptance contract

Each fixture is one manifested directory within `packages/test-fixtures/ats/` (nesting is allowed)
and contains one `metadata.json`. Infrastructure folders `templates/` and `schema/` are not
fixtures. The
manifest must conform to `ats-fixture-metadata.v1`, enumerate every payload with exact SHA-256 and
byte length, and pass the fail-closed validator.

The validator enforces these minimum controls:

- no unmanifested fixture payload, nested fixture, symbolic link, unsafe path, active HTML content,
  external form action, obvious credential/token material, or non-reserved email value;
- exact payload checksums and byte lengths;
- synthetic/provider evidence separation and no representative claim for synthetic material;
- opaque authorization, scan, human-review, raw-disposition, and representativeness evidence for
  every approved provider-derived fixture; and
- a non-expired authorization plus a current or future authorization revalidation date for every
  approved provider-derived fixture;
- both secret and PII scan categories, human sanitization acceptance, and human representative
  acceptance for provider-derived material.

This repository validator is a defense-in-depth structural and lexical gate; it does not replace
approved secret/PII scanners, counsel, security/privacy approval, or human inspection.

## Minimum owning-delivery representative evidence

D0-007 establishes this process, its fail-closed repository gate, and executable synthetic proof.
Actual provider families, variants, and behavior coverage are selected only when the owning
adapter is concrete: job-page detection in D2, application-form/autofill adapters in D3, and
Workday tenant/widget/application support in D4. Each owning delivery must justify why its accepted
set represents the variants it declares supported; repository authors and agents must not reduce
that coverage decision to an arbitrary fixture count. Every package in an accepted provider set
must have all of the following inspected evidence before the affected adapter is activated:

- accountable legal/privacy and security/privacy approvals are complete;
- a permitted exact provider family and variant, source category, capture date, and authorization
  evidence ID;
- sanitized payloads containing no candidate/production data, authentication material, active
  content, or live external target;
- passing approved secret scan, PII scan, repository validator, and checksum verification;
- human sanitization acceptance and separate representative-behavior acceptance;
- raw-capture destruction evidence or a compliant, unexpired quarantine deletion record; and
- an approved `sanitized_authorized_provider` manifest committed with the payload.

The existing `synthetic-foundation-v1` fixture is executable evidence that the Phase 0 process and
validator work. It does not count as provider evidence or satisfy a D2, D3, or D4 representative
fixture gate.

## Change and incident handling

- Payload or behavior-tag changes require new checksums and repeated scanner/human review evidence.
- An elapsed authorization expiry or revalidation date fails repository validation and removes the
  fixture from active evidence until an accountable renewed disposition is recorded.
- Authorization, terms, provider layout, or policy changes trigger revalidation; disable affected
  tests/adapters until disposition is recorded.
- A discovered secret, PII item, unauthorized capture, or live endpoint is a security/privacy
  incident: remove access, preserve only safe audit metadata, notify accountable owners, rotate any
  exposed credential, and follow the incident-response procedure. Git history remediation requires
  explicit security ownership.
- Expired or revoked fixtures are removed from active test use. Retain only minimum non-sensitive
  provenance/tombstone evidence required by the approved recordkeeping policy.
