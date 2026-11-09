# Shared scan gate for the one-off migration image (publisher and document migration operator).
# The AWS CLI prints finding descriptions that contain U+200E; on a legacy Windows code page that
# crashes it (exit 255) and the callers only report a generic lookup failure, so force UTF-8.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

# Findings the owner accepted on 2026-11-09 (ADR-058): the pinned Alpine runtime base ships zlib and musl
# releases that have no fixed version yet. Only these exact id and severity pairs are set aside; any other
# High or Critical finding, an id with a different severity, an incomplete findings list or a paginated one
# still fails the gate. Remove an entry when a fixed package exists and the base is rebuilt.
function Get-AcceptedImageFindings {
  return @{ "CVE-2026-4738" = "CRITICAL"; "CVE-2026-107891" = "HIGH" }
}

function Get-UnacceptedFindingCounts {
  param(
    [Parameter(Mandatory)][object]$Scan,
    [AllowNull()][object]$FindingsEnvelope,
    [Parameter(Mandatory)][int]$Critical,
    [Parameter(Mandatory)][int]$High
  )
  $result = [pscustomobject]@{ Critical = $Critical; High = $High; Accepted = @() }
  if ($Critical -eq 0 -and $High -eq 0) { return $result }
  # The severity counts must be fully explained by the listed findings, and the list must be complete.
  if ($null -ne $Scan.PSObject.Properties["nextToken"]) { return $result }
  $findingsProperty = if ($null -eq $FindingsEnvelope) { $null } else { $FindingsEnvelope.PSObject.Properties["findings"] }
  $listed = if ($null -eq $findingsProperty) { @() } else { @($findingsProperty.Value) }
  $listedCritical = @($listed | Where-Object { [string]$_.severity -ceq "CRITICAL" })
  $listedHigh = @($listed | Where-Object { [string]$_.severity -ceq "HIGH" })
  if ($listedCritical.Count -ne $Critical -or $listedHigh.Count -ne $High) { return $result }
  $allowed = Get-AcceptedImageFindings
  $accepted = @()
  $unaccepted = @{ CRITICAL = 0; HIGH = 0 }
  foreach ($finding in @($listedCritical) + @($listedHigh)) {
    $name = [string]$finding.name
    $severity = [string]$finding.severity
    if ($allowed.ContainsKey($name) -and $allowed[$name] -ceq $severity) {
      $accepted += $name
    } else {
      $unaccepted[$severity]++
    }
  }
  return [pscustomobject]@{ Critical = [int]$unaccepted["CRITICAL"]; High = [int]$unaccepted["HIGH"]; Accepted = @($accepted | Sort-Object) }
}
