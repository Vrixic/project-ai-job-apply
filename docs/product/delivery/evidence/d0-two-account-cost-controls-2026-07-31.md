# D0 Two-Account Cost-Control Deployment — 2026-07-31

## Scope and result

This record covers the isolated development and staging AWS budget and CUR 2.0 control rollout in
`us-east-2`, with billing-provider operations in `us-east-1`. It proves the controls exist and the
two Terraform roots are drift free. It does not claim a hard spending cap, automatic shutdown,
first export-object delivery, final non-estimated two-account billing, or D0-008 completion.

Both accounts now have:

- one `$5` monthly actual-cost AWS Budget;
- one `$5` absolute actual-cost notification routed to the existing encrypted operational topic;
- one healthy CUR 2.0 export using daily resource-attributed Parquet output;
- one private, bucket-owner-enforced export bucket with public access blocked, SSE-S3 encryption,
  and versioning; and
- 400-day current-object retention and 90-day noncurrent-version cleanup.

AWS Budgets sends alerts; it does not cap or stop spending.

## Reviewed plans and applies

The bootstrap plans independently updated only the GitHub deployment boundary and inline policy:

| Environment | Bootstrap plan SHA-256 | Apply result | Post-apply result |
|---|---|---|---|
| Development | `2FEF6423E293929A43256C0A3FCC21C5210F851A2B4F1FE48EAD3BA499BF2C16` | `0` added, `2` changed, `0` destroyed | Refresh-backed zero change |
| Staging | `CA38F59E529E2A97BCD0E8097A971D4AEF4A9AED171054AAEC6675D23B2A1AD2` | `0` added, `2` changed, `0` destroyed | Refresh-backed zero change |

The full exact-live-input plans preserved immutable image digests, deployed application settings,
database posture, OIDC inputs, and Temporal inputs. Each plan allowed nine creates and two in-place
policy updates with zero deletes or replacements:

| Environment | Full plan SHA-256 | Source |
|---|---|---|
| Development | `1327FE90BF65FEF4F65F9394A128E404A96D881518BEA85E7F59D6B10652F220` | Merged `$5` cost-control source |
| Staging | `FE208BC8726EC5FF14FE332DF171C641E1C4E4D6CAF54710A7A1A218284CED18` | Merged commit `6f3ae15` including PR #57 |

## Provider normalization and safe reconciliation

AWS injected a nonempty `BILLING_VIEW_ARN` into the CUR 2.0 table configuration during each
initial create. AWS provider `5.100.0` reported an inconsistent post-apply result even though AWS
created the export and Terraform recorded it. This matches the open
[upstream provider issue](https://github.com/hashicorp/terraform-provider-aws/issues/48807).

[PR #57](https://github.com/Vrixic/project-ai-job-apply/pull/57) added the upstream-recommended
lifecycle guard for service-normalized table-configuration keys. For each environment, operators
then:

1. confirmed exactly one AWS export existed and reported `HEALTHY`;
2. confirmed Terraform tracked the export, budget, bucket, and bucket controls;
3. cleared only the provider-induced taint, preserving the live export;
4. reviewed and applied a state-only plan containing zero resource actions and one sensitive
   `cost_export_arn` output addition; and
5. ran the original exact inputs against refreshed state and required a zero-change result.

The state-only plan hashes were:

- development: `AA9740D19FC9E36EA460EE1F4EB67754DF1698920DDBF13B2AEDB714AB3A4F2B`;
- staging: `76B4E8D7B104089E22550D627F03F5A690B411949F630F657C57187EDC453DF3`.

Both state-only applies reported `0` added, `0` changed, and `0` destroyed. Temporary diagnostic
replacement plans were removed and never applied.

## Live verification

Sanitized AWS and Terraform reads confirmed independently in both accounts:

- the monthly limit is exactly `$5`;
- exactly one actual, absolute-value notification exists at `$5`;
- exactly one matching CUR 2.0 export exists and reports `HEALTHY`;
- all four S3 public-access-block controls are enabled;
- versioning reports `Enabled`;
- default encryption reports `AES256`;
- lifecycle retention reports 400 current-object days and 90 noncurrent-version days; and
- an exact-input, refresh-backed Terraform plan exits with zero changes.

No account ID, ARN, bucket name, subscriber destination, token, provider credential, OIDC value,
Temporal value, or application artifact was retained in this record.

## Immediate delivery and billing check

The first read after deployment found no object in either export bucket, which is expected within
the provider's initial delivery window. Cost Explorer reported:

- development: estimated `$2.6802` unblended cost across 10 nonzero service groups; and
- staging: estimated `$0.00` with zero nonzero service groups.

The development amount is initial provider-estimated evidence, not an accepted monthly baseline.
No alert should be expected while actual cost remains below `$5`.

## Duplicate-budget cleanup

The exact-control inspection subsequently found one additional development budget that was not
managed by this repository. It was also a `$5` monthly actual-cost budget, but used percentage
notifications at 50%, 80%, and 100% rather than the accepted single `$5` absolute notification.

Immediately before deletion, the operator revalidated the development caller, account boundary,
expected Terraform-managed budget, and the exact shape of the additional budget. With explicit
product-owner authorization, only that stale manual budget was deleted. The deletion did not
change application resources and is recoverable only by explicitly recreating the manual budget.

The post-delete two-account inspection now confirms independently for development and staging:

- `ExpectedBudgetCount` is `1` and `OtherBudgetCount` is `0`;
- the monthly `COST` budget is exactly `$5 USD`, with `ExpectedAlertCount` equal to `1` and
  `OtherAlertCount` equal to `0`;
- `ExpectedExportCount` is `1` and `OtherExportCount` is `0`; and
- the matching export reports `HEALTHY`.

The same check still reports no delivered Parquet or manifest object in either `cur-2/` prefix.
Development remains at an estimated `$2.6802`, while staging remains at an estimated `$0.00`.
No account identifier, budget name, subscriber destination, or other sensitive identifier is
retained in this record.

## Remaining D0-008 acceptance

D0-008 remains in progress until:

1. each export delivers its first healthy object to its account-local bucket;
2. staging Cost Explorer or delivered billing evidence contains nonzero service-attributed
   charges; and
3. development's initial estimated evidence and staging's later evidence are reconciled against
   the operating-cost baseline and explicitly accepted.

CUR 2.0 delivery can take up to 24 hours to begin, so absence of a first object immediately after
creation is not a failure.
