# ADR-048: Development recovery safeguards

Status: Accepted owner revision; formal proof proposal withdrawn
Date: 2026-10-10

The owner removed formal database recovery-proof gates. D3 does not require a physical restore
rehearsal, whole-database equality attestation, reconciled-copy promotion operator, or invocation
provenance package. Existing diagnostic tools and historical evidence may remain; they are not
prerequisites for D3 delivery or database dormancy.

Keep encrypted safety/final snapshots, automated backups, exact account/region/database selection,
private networking, protected restoration and narrowly scoped reviewed Terraform changes. Never
replace a database with an empty one or select an older backup silently. Before database deletion,
require an available encrypted safety snapshot of the exact development source. A separate
restorecheck database and receipt are no longer required.

Restore with application traffic and writers off. Apply current migrations and reconcile completed
candidate deletions from retained markers, using bounded transactional owner deletion functions,
subject/request binding, document absence checks and terminal postconditions before admitting
traffic. Never resurrect deleted candidates. Whole-row comparisons are optional diagnostics;
replay no longer scans the entire database before committing authorized deletion work.

No recovery operation extends generated-material expiry, approvals, submission authority or an
expired replay invocation. Use fresh bounded execution when required. Verify the connected D3
journey with targeted component tests/typechecks; distinguish simulation from live acceptance.
Independent D1/admin acceptance stays deferred. Shut down test compute/network runtimes after
use, preserving backups and recovery configuration. The PC remains on.
