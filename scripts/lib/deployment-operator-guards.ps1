Set-StrictMode -Version Latest

function ConvertTo-DeploymentCanonicalValue {
  param(
    [AllowNull()]
    [object]$Value,

    [switch]$SortArrays
  )

  if ($null -eq $Value) { return "null" }

  if ($Value -is [string] -or $Value -is [char]) {
    return ($Value.ToString() | ConvertTo-Json -Compress)
  }
  if ($Value -is [bool]) { return $Value.ToString().ToLowerInvariant() }
  if ($Value -is [ValueType]) {
    return ($Value | ConvertTo-Json -Compress)
  }

  if ($Value -is [System.Collections.IDictionary]) {
    $properties = @($Value.Keys | ForEach-Object {
        [pscustomobject]@{ Name = [string]$_; Value = $Value[$_] }
      })
  }
  elseif ($Value -is [System.Collections.IEnumerable]) {
    $items = @($Value | ForEach-Object {
        ConvertTo-DeploymentCanonicalValue -Value $_ -SortArrays:$SortArrays
      })
    if ($SortArrays) { $items = @($items | Sort-Object) }
    return "[$($items -join ',')]"
  }
  else {
    $properties = @($Value.PSObject.Properties | ForEach-Object {
        [pscustomobject]@{ Name = [string]$_.Name; Value = $_.Value }
      })
  }

  $members = @($properties | Sort-Object Name | ForEach-Object {
      $name = $_.Name | ConvertTo-Json -Compress
      $value = ConvertTo-DeploymentCanonicalValue -Value $_.Value -SortArrays:$SortArrays
      "${name}:${value}"
    })
  return "{$($members -join ',')}"
}

function ConvertFrom-IamPolicyValue {
  param(
    [Parameter(Mandatory)]
    [object]$Policy
  )

  if ($Policy -is [string]) {
    try { return $Policy | ConvertFrom-Json }
    catch { throw "The IAM policy JSON is invalid." }
  }
  if ($Policy -is [System.Collections.IDictionary]) {
    return $Policy | ConvertTo-Json -Depth 50 | ConvertFrom-Json
  }
  return $Policy
}

function Assert-SingleAddedIamStatement {
  param(
    [Parameter(Mandatory)]
    [object]$BeforePolicy,

    [Parameter(Mandatory)]
    [object]$AfterPolicy,

    [Parameter(Mandatory)]
    [object]$ExpectedStatement
  )

  $before = ConvertFrom-IamPolicyValue -Policy $BeforePolicy
  $after = ConvertFrom-IamPolicyValue -Policy $AfterPolicy
  $expectedSid = [string]$ExpectedStatement.Sid
  if ([string]::IsNullOrWhiteSpace($expectedSid)) {
    throw "The expected IAM statement requires a nonempty Sid."
  }
  if ([string]$before.Version -cne [string]$after.Version) {
    throw "The IAM policy version changed."
  }

  $beforeStatements = @($before.Statement)
  $afterStatements = @($after.Statement)
  if (@($beforeStatements + $afterStatements | Where-Object {
        [string]::IsNullOrWhiteSpace([string]$_.Sid)
      }).Count -ne 0) {
    throw "IAM statement Sids must be present and unique."
  }
  $duplicateBefore = @($beforeStatements | Group-Object Sid | Where-Object Count -ne 1)
  $duplicateAfter = @($afterStatements | Group-Object Sid | Where-Object Count -ne 1)
  if ($duplicateBefore.Count -ne 0 -or $duplicateAfter.Count -ne 0) {
    throw "IAM statement Sids must be present and unique."
  }
  if (@($beforeStatements | Where-Object { [string]$_.Sid -ceq $expectedSid }).Count -ne 0) {
    throw "The approved IAM statement already exists in the before policy."
  }
  if ($afterStatements.Count -ne ($beforeStatements.Count + 1)) {
    throw "The IAM delta must add exactly one statement."
  }

  $added = @($afterStatements | Where-Object { [string]$_.Sid -ceq $expectedSid })
  if ($added.Count -ne 1) {
    throw "The IAM delta does not add the exact approved Sid."
  }
  $expectedCanonical = ConvertTo-DeploymentCanonicalValue -Value $ExpectedStatement -SortArrays
  $addedCanonical = ConvertTo-DeploymentCanonicalValue -Value $added[0] -SortArrays
  if ($addedCanonical -cne $expectedCanonical) {
    throw "The added IAM statement does not match the approved semantics."
  }

  foreach ($statement in $beforeStatements) {
    $sid = [string]$statement.Sid
    $matchingAfter = @($afterStatements | Where-Object { [string]$_.Sid -ceq $sid })
    if ($matchingAfter.Count -ne 1) {
      throw "An existing IAM statement was removed or duplicated: $sid."
    }
    $beforeCanonical = ConvertTo-DeploymentCanonicalValue -Value $statement -SortArrays
    $afterCanonical = ConvertTo-DeploymentCanonicalValue -Value $matchingAfter[0] -SortArrays
    if ($beforeCanonical -cne $afterCanonical) {
      throw "An existing IAM statement changed: $sid."
    }
  }

  return [pscustomobject]@{
    AddedSid             = $expectedSid
    BeforeStatementCount = $beforeStatements.Count
    AfterStatementCount  = $afterStatements.Count
  }
}

function Assert-ExactIamStatementDelta {
  param(
    [Parameter(Mandatory)][object]$BeforePolicy,
    [Parameter(Mandatory)][object]$AfterPolicy,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$AddedStatements,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$ModifiedStatements
  )

  $before = ConvertFrom-IamPolicyValue -Policy $BeforePolicy
  $after = ConvertFrom-IamPolicyValue -Policy $AfterPolicy
  if ([string]$before.Version -cne [string]$after.Version) {
    throw "The IAM policy version changed."
  }

  $beforeStatements = @($before.Statement)
  $afterStatements = @($after.Statement)
  $allStatements = @($beforeStatements) + @($afterStatements)
  if (@($allStatements | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.Sid) }).Count -ne 0 -or
    @($beforeStatements | Group-Object Sid | Where-Object Count -ne 1).Count -ne 0 -or
    @($afterStatements | Group-Object Sid | Where-Object Count -ne 1).Count -ne 0) {
    throw "IAM statement Sids must be present and unique."
  }

  $addedSids = @($AddedStatements | ForEach-Object { [string]$_.Sid })
  $modifiedSids = @($ModifiedStatements | ForEach-Object { [string]$_.After.Sid })
  if (@($addedSids + $modifiedSids | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -ne 0 -or
    @($addedSids + $modifiedSids | Group-Object | Where-Object Count -ne 1).Count -ne 0) {
    throw "The expected IAM delta Sids must be present, unique, and disjoint."
  }
  if ($afterStatements.Count -ne ($beforeStatements.Count + $AddedStatements.Count)) {
    throw "The IAM statement count does not match the exact approved delta."
  }

  foreach ($expected in $AddedStatements) {
    $sid = [string]$expected.Sid
    if (@($beforeStatements | Where-Object { [string]$_.Sid -ceq $sid }).Count -ne 0) {
      throw "An approved added IAM statement already exists in the before policy."
    }
    $actual = @($afterStatements | Where-Object { [string]$_.Sid -ceq $sid })
    if ($actual.Count -ne 1 -or
      (ConvertTo-DeploymentCanonicalValue -Value $actual[0] -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue -Value $expected -SortArrays)) {
      throw "An added IAM statement does not match the exact approved semantics."
    }
  }

  foreach ($expected in $ModifiedStatements) {
    if ([string]$expected.Before.Sid -cne [string]$expected.After.Sid) {
      throw "An approved modified IAM statement cannot change Sid."
    }
    $sid = [string]$expected.After.Sid
    $actualBefore = @($beforeStatements | Where-Object { [string]$_.Sid -ceq $sid })
    $actualAfter = @($afterStatements | Where-Object { [string]$_.Sid -ceq $sid })
    if ($actualBefore.Count -ne 1 -or $actualAfter.Count -ne 1 -or
      (ConvertTo-DeploymentCanonicalValue -Value $actualBefore[0] -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue -Value $expected.Before -SortArrays) -or
      (ConvertTo-DeploymentCanonicalValue -Value $actualAfter[0] -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue -Value $expected.After -SortArrays)) {
      throw "A modified IAM statement does not match the exact approved before/after semantics."
    }
  }

  foreach ($statement in $beforeStatements) {
    $sid = [string]$statement.Sid
    if ($sid -in $modifiedSids) { continue }
    $matchingAfter = @($afterStatements | Where-Object { [string]$_.Sid -ceq $sid })
    if ($matchingAfter.Count -ne 1 -or
      (ConvertTo-DeploymentCanonicalValue -Value $statement -SortArrays) -cne
      (ConvertTo-DeploymentCanonicalValue -Value $matchingAfter[0] -SortArrays)) {
      throw "An unapproved existing IAM statement changed."
    }
  }

  return [pscustomobject]@{
    AddedSids    = ($addedSids | Sort-Object) -join ","
    ModifiedSids = ($modifiedSids | Sort-Object) -join ","
  }
}

function Resolve-DeploymentPlanPath {
  param(
    [Parameter(Mandatory)]
    [string]$Candidate,

    [Parameter(Mandatory)]
    [string]$AllowedRoot,

    [switch]$MustExist
  )

  $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
  $resolved = if ([IO.Path]::IsPathRooted($Candidate)) {
    [IO.Path]::GetFullPath($Candidate)
  }
  else {
    [IO.Path]::GetFullPath((Join-Path $root $Candidate))
  }
  $prefix = $root + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The plan path must stay below the ignored operator plan directory."
  }
  if ($MustExist -and -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "The required saved plan does not exist."
  }
  return $resolved
}

function Assert-ReviewedPlanMetadata {
  param(
    [Parameter(Mandatory)]
    [object]$Metadata,

    [Parameter(Mandatory)]
    [hashtable]$Expected
  )

  foreach ($entry in $Expected.GetEnumerator()) {
    $property = $Metadata.PSObject.Properties[[string]$entry.Key]
    if ($null -eq $property -or [string]$property.Value -cne [string]$entry.Value) {
      throw "The reviewed plan metadata does not match '$($entry.Key)'."
    }
  }
}
