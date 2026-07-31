[CmdletBinding()]
param(
  [string]$DevelopmentProfile = "ai-job-apply-development-admin",
  [string]$StagingProfile = "ai-job-apply-staging-admin",
  [string]$StartDate = "",
  [string]$EndDate = "",
  [switch]$Help
)

$ErrorActionPreference = "Stop"

if ($Help) {
  @"
Usage:
  .\scripts\inspect-phase0-cost.ps1
  .\scripts\inspect-phase0-cost.ps1 -StartDate <YYYY-MM-DD> -EndDate <YYYY-MM-DD>

Reads actual unblended Cost Explorer data, budget count, and CUR 2.0 Data Export count from the
isolated development and staging accounts. EndDate is exclusive. The default is the current UTC
calendar month. Both IAM Identity Center sessions must be active.

This operator is read-only and prints no account identifier, caller ARN, budget destination,
resource identifier, tag value, credit record, invoice, or raw provider response.
"@
  exit 0
}

function Convert-DateWindow {
  $now = [DateTime]::UtcNow
  if (-not $StartDate -and -not $EndDate) {
    $start = [DateTime]::new($now.Year, $now.Month, 1, 0, 0, 0, [DateTimeKind]::Utc)
    return [pscustomobject]@{ Start = $start; End = $start.AddMonths(1) }
  }
  if (-not $StartDate -or -not $EndDate) {
    throw "StartDate and EndDate must be provided together."
  }
  $start = [DateTime]::MinValue
  $end = [DateTime]::MinValue
  if (
    -not [DateTime]::TryParseExact(
      $StartDate,
      "yyyy-MM-dd",
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$start
    ) -or
    -not [DateTime]::TryParseExact(
      $EndDate,
      "yyyy-MM-dd",
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$end
    )
  ) {
    throw "Cost dates must use YYYY-MM-DD."
  }
  if ($end -le $start -or ($end - $start).TotalDays -gt 93 -or $end -gt $now.Date.AddDays(1)) {
    throw "The cost window must be positive, no more than 93 days, and not beyond tomorrow UTC."
  }
  return [pscustomobject]@{ Start = $start; End = $end }
}

function Invoke-AwsJson {
  param(
    [string]$Profile,
    [string[]]$CommandArguments
  )

  $raw = & aws @CommandArguments --profile $Profile 2>$null
  if ($LASTEXITCODE -ne 0) {
    $operation = ($CommandArguments | Select-Object -First 2) -join " "
    throw "The $Profile AWS '$operation' operation failed. Refresh its SSO session and retry."
  }
  if (-not $raw) {
    return $null
  }
  return $raw | ConvertFrom-Json
}

function Get-Collection {
  param(
    [object]$Object,
    [string]$Property
  )

  if ($null -eq $Object -or $null -eq $Object.$Property) {
    return @()
  }
  return @($Object.$Property)
}

function Get-EnvironmentCost {
  param(
    [string]$Environment,
    [string]$Profile,
    [object]$Window
  )

  $identity = Invoke-AwsJson $Profile @("sts", "get-caller-identity", "--output", "json")
  if (-not ([string]$identity.Arn).Contains(":assumed-role/")) {
    throw "$Environment must use a temporary IAM Identity Center caller."
  }
  $cost = Invoke-AwsJson $Profile @(
    "ce",
    "get-cost-and-usage",
    "--time-period",
    "Start=$($Window.Start.ToString('yyyy-MM-dd')),End=$($Window.End.ToString('yyyy-MM-dd'))",
    "--granularity",
    "MONTHLY",
    "--metrics",
    "UnblendedCost",
    "--group-by",
    "Type=DIMENSION,Key=SERVICE",
    "--output",
    "json"
  )
  $periods = Get-Collection $cost "ResultsByTime"
  $services = @()
  [decimal]$total = 0
  foreach ($period in $periods) {
    foreach ($group in (Get-Collection $period "Groups")) {
      [decimal]$amount = [decimal]$group.Metrics.UnblendedCost.Amount
      $total += $amount
      if ($amount -ne 0) {
        $services += [pscustomobject]@{
          Service   = [string]$group.Keys[0]
          AmountUsd = [Math]::Round($amount, 4)
        }
      }
    }
  }
  $budgets = Invoke-AwsJson $Profile @(
    "budgets",
    "describe-budgets",
    "--account-id",
    [string]$identity.Account,
    "--max-results",
    "100",
    "--output",
    "json"
  )
  $exports = Invoke-AwsJson $Profile @(
    "bcm-data-exports",
    "list-exports",
    "--region",
    "us-east-1",
    "--max-results",
    "100",
    "--output",
    "json"
  )
  return [pscustomobject]@{
    Environment       = $Environment
    TemporaryCaller   = $true
    PeriodStart       = $Window.Start.ToString("yyyy-MM-dd")
    PeriodEndExclusive = $Window.End.ToString("yyyy-MM-dd")
    UnblendedCostUsd  = [Math]::Round($total, 4)
    Estimated         = @($periods | Where-Object { [bool]$_.Estimated }).Count -gt 0
    Services          = @($services | Sort-Object AmountUsd -Descending)
    AwsBudgetCount    = (Get-Collection $budgets "Budgets").Count
    Cur2DataExports   = (Get-Collection $exports "Exports").Count
  }
}

$window = Convert-DateWindow
@(
  Get-EnvironmentCost "development" $DevelopmentProfile $window
  Get-EnvironmentCost "staging" $StagingProfile $window
) | ConvertTo-Json -Depth 7
