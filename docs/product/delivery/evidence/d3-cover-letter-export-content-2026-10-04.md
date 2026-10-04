# D3-072: Saved cover-letter content in candidate export

Date: 2026-10-04
Status: Source/focused, real SQL and emitted read isolation passed; full verifier/artifact pending.

The backend-only branch starts from fresh main bde17d9 and locally integrates exact open #541
9918aeecc8b20b49080c32f036c952c389f0b577. No GitHub merge occurs.

## Result and boundary

Ready cover letters previously exported only metadata and hashes. The candidate's existing
portable export can now include the exact saved paragraphs and ordered fact citations, with
reviewRequired=true. Pending letters remain metadata-only. Export does not approve a packet,
regenerate a draft, renew disclosure or consent, dereference citations, or read provider slots,
prompts, responses, work grants, credentials or internal object identities into the artifact.

Documents owns an exact-ID/version snapshot read under identity.require_active_candidate.
It compares application/context/content/prompt/time metadata, reads the pinned immutable object,
verifies byte count/object hash and the canonical document/content hash, then checks the document's
owner/identity/version/context/model. Historical drafts sharing the same content hash are read by
their distinct saved IDs rather than selecting the latest version. Missing/corrupt/foreign or changed
bindings fail the export before artifact creation. Portability reads saved history without a fresh
model call or current-fact generation; it grants no authority to reuse a draft for submission.

The dedicated ./cover-letter-export entrypoint exposes a frozen readValue capability. Its native
factory owns one Documents pool with native Date/JSON codecs, fixed us-east-2 S3, one SDK attempt
and disabled configured endpoint overrides. No work/generation control escapes. The existing
privacy activity reuses its managed database URL to compose this independent owner pool only when
COVER_LETTER_EXPORT_ENABLED is exactly true and document KMS configuration is available. The flag
defaults off and is rechecked before SQL, before object I/O and after read completion. Withdrawal
withholds a returned value; it does not cancel existing remote effects or certify writer quiescence.

The activity rejects paragraphs injected into owner SQL export metadata, detaches metadata before
the private port, includes only verified returned paragraphs, and revalidates the complete portable
schema before encrypted immutable artifact storage. Existing owner/authentication, expiry, replay,
artifact checksum, no-store download and deletion behavior remain unchanged. No frontend edit.

## Contract compatibility and release

CandidateDataExport v1 gains optional paragraphs/reviewRequired for ready cover letters only.
Both fields must appear together; reviewRequired is true, at most six paragraphs have 1,200-character
text and bounded unique UUID citations, and extra properties refuse. Existing metadata-only v1
exports remain valid. Old strict validators cannot accept the new fields: deploy the updated reader
before enabling the producer. No REST/event schema or generated client shape changes, SQL migration,
dependency version, IAM attachment or infrastructure change occurs. Two contract-generation passes
produce no generated diff. Native activation and exact-version document/KMS read permission require
separately reviewed release/accountable evidence. Nothing is deployed or activated here.

## Executed local checks

- 79 focused Documents cases pass, including fourteen new exact-export checks plus unchanged
  owner preview/read and object transport cases. Exact snapshot drift refuses before object reads;
  model drift, corrupt bytes, pending records, caller mutation and default-off native read refusal
  are covered. The native facade is frozen; exported timestamps compare by instant.
- 47 focused Workflow privacy cases pass, including ten new content composition cases. They cover
  old exports, pending/no-read behavior, exact owner propagation, metadata detachment, read failures,
  invalid returned content and injected owner metadata before artifact storage.
- All 24 Domain cases (one new), 83 API contract cases and 20 event cases pass. Formatting, native
  typecheck/build and emitted read isolation pass. The maintained verifier includes that guard:
  positive owned reader/codec inputs with no emitted generation/work/provider/Invoke actors.
- Seven fresh PostgreSQL cases exercise actual seven-owner migrations twice, real Profile export
  request/operation and all eight-owner exports, independent native Documents reads and ready replay.
  Two historical same-hash drafts stay distinct, pending and neighboring owners are excluded;
  missing/corrupt/foreign-owner bytes, quarantine before read and warm flag withdrawal create no
  export artifact. Legacy metadata-only export remains valid. Completed document rows/object bytes
  are explicitly synthetic read fixtures, not proof of generation admission or provider settlement.

Windows, Node 24.12.0, pnpm 10.24.0, PostgreSQL 16.14-alpine. SQL transactions, owner leases,
request/operation writes and schema validation are real; authentication principal, exact-version
object bytes/transport and encrypted artifact receipts are simulated. No live AWS/model/provider,
managed OIDC/browser, deployment or activation is claimed. The final native S3 factory uses the
already-tested object transport; its packaging change follows the same seven SQL read cases.
The owned tmpfs fixture is removed and Docker Desktop/WSL stopped; shared volumes retained.
Logs remain ignored under .tmp/d3-072-*.log. No PII, artifacts or credentials are committed.

## Remaining gates

Full maintained exact-source verifier and existing core Workflow artifact checks are pending.
Release/IAM, provider privacy retention/original writer drain, restore and accountable/deployed
acceptance remain. No phase exit changes; D1/D3 stay In progress. Hosted CI/CD remains deferred
until production launch by owner instruction.
