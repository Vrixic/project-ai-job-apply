# D2 community default-dark operations

These source operators do not authorize activation. Keep contribution routes, the scheduled rule,
and the Trust signal event-source mapping disabled until every Phase 2 accountable gate passes.

1. Run `operate-development-d2-community-artifact.ps1 -Action Status` with the exact development
   account and versioned encrypted state bucket.
2. From clean reviewed `main`, publish the deterministic artifact with `-Action Publish -SourceSha`.
3. Independently hash and review the private receipt, then use `-Action Verify` to read the exact S3
   object version back. Publication never updates Lambda or a trigger.
4. Use `verify-development-d2-community-dark.ps1` for read-only checks that routes, schedule targets,
   and queue mappings remain dark.
5. `plan-development-d2-community-recovery.ps1` produces only rollback/alarm prerequisites. Actual
   rollback must use a checksum-reviewed Terraform plan. Alarm injection requires accountable metric
   thresholds, alarm ARN, SNS recipients, and both ALARM and OK delivery confirmation; none are
   invented by the repository.

All receipts stay below the ignored development `.terraform` directory. Never retain account IDs,
bucket names, tokens, raw messages, contribution data, source URLs, or provider artifacts in Git.
