# D1 provider activation preflight — 2026-08-24

- Exact merged source: `961753e5790a47994b93737ead919758b33ed966`
- Scope: default-off Greenhouse, Lever, and Ashby configuration validation
- Network/provider/data effect: none

## Outcome

The exact company-input blocker now has a one-line preflight that calls the production ingestion
configuration parser. It accepts one literal JSON file and fails closed before any Terraform plan,
runtime/source authority, or provider request.

```powershell
.\scripts\validate-d1-provider-source-configuration.ps1 -Path .\infrastructure\terraform\environments\development\.terraform\development-provider-input-preflight\provider-source.json
```

The input must use `schemaVersion: 1` and `enabled: false`. Common required fields are provider,
stable source ID, exact company display name, and verified company domain. Provider-specific fields
are Greenhouse `boardToken`; Lever `site` plus `region` (`global` or `eu`); or Ashby
`jobBoardName`.

The production parser retains its exact-key, canonical value, unique-source, eight-source,
1,800-byte, adapter-constructor, and provider-authority checks. Preflight specifically refuses any
`enabled: true` entry because validation is not activation authority.

Successful output contains only:

- fixed outcome and source count;
- provider and source ID;
- immutable adapter version; and
- adapter configuration SHA-256.

It does not emit the company name/domain or provider board/site value. Rejections use one fixed
message and do not reflect raw configuration.

## Verification

- Workflows unit tests: `44/44` passed.
- Workflows typecheck: passed.
- Workflows production TypeScript build: passed.
- Scoped Biome check: passed.
- PowerShell 7 exact sample execution: passed.
- Windows PowerShell 5.1 exact sample execution: passed.
- PowerShell parser and `git diff --check`: passed.

The ignored sample execution returned one safe Greenhouse descriptor and a 64-character
configuration digest. It made no network request and was not retained in Git.

## Delivery effect

This removes input-format ambiguity from D1-003 and D1-R1. It does not provide the missing company
choice, establish accountable activation, publish a new artifact, change AWS/Terraform, or satisfy
live-provider acceptance. The next source step still requires the repository owner to supply one
exact public board/company tuple from the list in the Phase 1 task document.
