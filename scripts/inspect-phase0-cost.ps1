[CmdletBinding()]
param(
  [ValidateSet("all", "development", "staging")]
  [string]$Environment = "all",
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
  .\scripts\inspect-phase0-cost.ps1 -Environment development
  .\scripts\inspect-phase0-cost.ps1 -Environment staging
  .\scripts\inspect-phase0-cost.ps1 -StartDate <YYYY-MM-DD> -EndDate <YYYY-MM-DD>

Reads actual unblended Cost Explorer data, the exact environment budget and alert, CUR 2.0 export
  health, and real export delivery from the selected isolated account or both accounts. Cost
  Explorer is constrained to the selected caller account so an AWS Organizations payer cannot
  silently include linked-account spend. EndDate is exclusive. The default is the current UTC
  calendar month. Only the selected IAM Identity Center session must be active; selecting all
  requires both.

This operator is read-only and prints no account identifier, caller ARN, budget destination,
bucket/object key, resource identifier, tag value, credit record, invoice, or raw provider
response. AWS provider validation objects outside the configured `cur-2/` prefix do not count as
CUR delivery.
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
      [Globalization.DateTimeStyles]::None,
      [ref]$start
    ) -or
    -not [DateTime]::TryParseExact(
      $EndDate,
      "yyyy-MM-dd",
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None,
      [ref]$end
    )
  ) {
    throw "Cost dates must use YYYY-MM-DD."
  }
  # Treat date-only operator input as UTC calendar boundaries without a local-time conversion.
  $start = [DateTime]::SpecifyKind($start, [DateTimeKind]::Utc)
  $end = [DateTime]::SpecifyKind($end, [DateTimeKind]::Utc)
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
  # PowerShell enumerates function output. Callers use @() so singleton AWS responses retain a
  # reliable Count and indexer under both Windows PowerShell 5.1 and PowerShell 7.
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
  $costFilter = @{
    Dimensions = @{
      Key          = "LINKED_ACCOUNT"
      Values       = @([string]$identity.Account)
      MatchOptions = @("EQUALS")
    }
  } | ConvertTo-Json -Compress -Depth 4
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
    "--filter",
    $costFilter,
    "--output",
    "json"
  )
  $periods = @(Get-Collection $cost "ResultsByTime")
  $services = @()
  [decimal]$total = 0
  foreach ($period in $periods) {
    foreach ($group in @(Get-Collection $period "Groups")) {
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
  $budgetItems = @(Get-Collection $budgets "Budgets")
  $exportItems = @(Get-Collection $exports "Exports")
  $expectedBudgetName = "ai-job-apply-$Environment-monthly-cost"
  $matchingBudgets = @(
    $budgetItems | Where-Object {
      [string]$_.BudgetName -eq $expectedBudgetName
    }
  )
  $budgetNotifications = @()
  $actualAlertThresholds = @()
  $expectedBudgetAlerts = @()
  if ($matchingBudgets.Count -eq 1) {
    $notifications = Invoke-AwsJson $Profile @(
      "budgets",
      "describe-notifications-for-budget",
      "--account-id",
      [string]$identity.Account,
      "--budget-name",
      $expectedBudgetName,
      "--output",
      "json"
    )
    $budgetNotifications = @(Get-Collection $notifications "Notifications")
    $actualAlertThresholds = @(
      $budgetNotifications |
        Where-Object {
          [string]$_.NotificationType -eq "ACTUAL" -and
          [string]$_.ThresholdType -eq "ABSOLUTE_VALUE"
        } |
        ForEach-Object { [Math]::Round([decimal]$_.Threshold, 4) } |
        Sort-Object
    )
    $expectedBudgetAlerts = @(
      $budgetNotifications | Where-Object {
        [string]$_.ComparisonOperator -eq "GREATER_THAN" -and
        [string]$_.NotificationType -eq "ACTUAL" -and
        [string]$_.ThresholdType -eq "ABSOLUTE_VALUE" -and
        [decimal]$_.Threshold -eq [decimal]5
      }
    )
  }

  $expectedExportName = "ai-job-apply-$Environment-cost-and-usage"
  $matchingExports = @(
    $exportItems | Where-Object {
      [string]$_.ExportName -eq $expectedExportName
    }
  )
  $deliveryObjects = @()
  [string]$exportStatus = "missing-or-duplicate"
  if ($matchingExports.Count -eq 1) {
    $exportStatus = [string]$matchingExports[0].ExportStatus.StatusCode
    $exportDetail = Invoke-AwsJson $Profile @(
      "bcm-data-exports",
      "get-export",
      "--region",
      "us-east-1",
      "--export-arn",
      [string]$matchingExports[0].ExportArn,
      "--output",
      "json"
    )
    $destinations = @(Get-Collection $exportDetail.Export "DestinationConfigurations")
    if ($destinations.Count -ne 1 -or -not [string]$destinations[0].S3Destination.S3Bucket) {
      throw "$Environment CUR 2.0 export does not have one inspectable S3 destination."
    }
    $delivery = Invoke-AwsJson $Profile @(
      "s3api",
      "list-objects-v2",
      "--bucket",
      [string]$destinations[0].S3Destination.S3Bucket,
      "--prefix",
      "cur-2/",
      "--output",
      "json"
    )
    $deliveryObjects = @(Get-Collection $delivery "Contents")
  }
  $parquetObjects = @(
    $deliveryObjects | Where-Object { ([string]$_.Key).EndsWith(".parquet") }
  )
  $manifestObjects = @(
    $deliveryObjects | Where-Object { [string]$_.Key -match "(?i)manifest" }
  )
  [long]$deliveryBytes = 0
  foreach ($object in $deliveryObjects) {
    $deliveryBytes += [long]$object.Size
  }
  $latestDelivery = @(
    $deliveryObjects | Sort-Object { [DateTime]$_.LastModified } -Descending
  ) | Select-Object -First 1
  return [pscustomobject]@{
    Environment        = $Environment
    TemporaryCaller    = $true
    CostScope           = "caller-account-only"
    PeriodStart        = $Window.Start.ToString("yyyy-MM-dd")
    PeriodEndExclusive = $Window.End.ToString("yyyy-MM-dd")
    UnblendedCostUsd   = [Math]::Round($total, 4)
    Estimated          = @($periods | Where-Object { [bool]$_.Estimated }).Count -gt 0
    Services           = @($services | Sort-Object AmountUsd -Descending)
    AwsBudgetCount     = $budgetItems.Count
    ExpectedBudgetCount = $matchingBudgets.Count
    OtherBudgetCount   = $budgetItems.Count - $matchingBudgets.Count
    MonthlyBudgetUsd   = if ($matchingBudgets.Count -eq 1) {
      [Math]::Round([decimal]$matchingBudgets[0].BudgetLimit.Amount, 4)
    } else {
      $null
    }
    BudgetType         = if ($matchingBudgets.Count -eq 1) {
      [string]$matchingBudgets[0].BudgetType
    } else {
      $null
    }
    BudgetTimeUnit     = if ($matchingBudgets.Count -eq 1) {
      [string]$matchingBudgets[0].TimeUnit
    } else {
      $null
    }
    BudgetLimitUnit    = if ($matchingBudgets.Count -eq 1) {
      [string]$matchingBudgets[0].BudgetLimit.Unit
    } else {
      $null
    }
    BudgetNotificationCount = $budgetNotifications.Count
    ExpectedAlertCount       = $expectedBudgetAlerts.Count
    OtherAlertCount          = $budgetNotifications.Count - $expectedBudgetAlerts.Count
    ActualAlertThresholdsUsd = $actualAlertThresholds
    Cur2DataExports          = $exportItems.Count
    ExpectedExportCount      = $matchingExports.Count
    OtherExportCount         = $exportItems.Count - $matchingExports.Count
    Cur2ExportStatus         = $exportStatus
    CurDeliveryObjectCount   = $deliveryObjects.Count
    CurParquetObjectCount    = $parquetObjects.Count
    CurManifestObjectCount   = $manifestObjects.Count
    CurDeliveryBytes         = $deliveryBytes
    CurLatestDeliveryUtc     = if ($latestDelivery) {
      ([DateTime]$latestDelivery.LastModified).ToUniversalTime().ToString("o")
    } else {
      $null
    }
    FirstCurDeliveryPresent = $exportStatus -eq "HEALTHY" -and $parquetObjects.Count -gt 0
  }
}

$window = Convert-DateWindow
$results = @()
if ($Environment -in @("all", "development")) {
  $results += Get-EnvironmentCost "development" $DevelopmentProfile $window
}
if ($Environment -in @("all", "staging")) {
  $results += Get-EnvironmentCost "staging" $StagingProfile $window
}
$results | ConvertTo-Json -Depth 7
