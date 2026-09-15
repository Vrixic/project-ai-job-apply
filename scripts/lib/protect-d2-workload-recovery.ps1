Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
  if (-not $IsWindows) { throw 'unsupported' }
  $buffer = [char[]]::new(32769)
  $length = 0
  while ($length -lt $buffer.Length) {
    $read = [Console]::In.Read($buffer, $length, $buffer.Length - $length)
    if ($read -eq 0) { break }
    $length += $read
  }
  if ($length -gt 32768) { throw 'large' }
  $inputValue = ([string]::new($buffer, 0, $length)) | ConvertFrom-Json -AsHashtable -DateKind String
  $expected = if ($inputValue.ContainsKey('testRoot')) { 'action,payload,testRoot' } else { 'action,payload' }
  if ((@($inputValue.Keys | Sort-Object) -join ',') -cne $expected) { throw 'shape' }
  $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../infrastructure/terraform/environments/development/.terraform/development-d2-workload-session'))
  if ($inputValue.ContainsKey('testRoot')) {
    $root = [IO.Path]::GetFullPath([string]$inputValue.testRoot)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($env:NODE_ENV -cne 'test' -or -not $root.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $root -Leaf) -cnotmatch '^d2-recovery-test-[a-f0-9]{32}$') { throw 'test-root' }
  }
  function Assert-NoLinks([string]$Path) {
    $probe = $Path
    while ($probe) {
      if (Test-Path -LiteralPath $probe) {
        if (((Get-Item -LiteralPath $probe -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'link' }
      }
      $probe = Split-Path $probe -Parent
    }
  }
  Assert-NoLinks $root
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  function Assert-Private([string]$Path) {
    Assert-NoLinks $Path
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value -or -not $acl.AreAccessRulesProtected) { throw 'owner' }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -cne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'acl' }
  }
  if (-not (Test-Path -LiteralPath $root)) {
    if ($inputValue.action -cne 'preserve') { throw 'missing' }
    $parent = Split-Path $root -Parent
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'parent' }
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($root), $acl)
  }
  Assert-Private $root
  $entropy = [Text.Encoding]::UTF8.GetBytes('applydash-d2-workload-recovery-v1')
  function Write-Private([string]$Path, [byte[]]$Bytes) {
    Assert-NoLinks $Path
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
    $stream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Path), [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::FullControl, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $acl)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Assert-Private $Path
  }
  if ($inputValue.action -ceq 'preserve') {
    $scopeKeys = @('schemaVersion','kind','capabilityMode','runId','apiOrigin','issuedAt','expiresAt','disposableCandidate','identitySha256','issuer','audience','clientId','sourceAuthorized','actions','ugcPolicyVersion','preview','previewSha256','readRequests')
    if ((@($inputValue.payload.Keys | Sort-Object) -join ',') -cne (@($scopeKeys | Sort-Object) -join ',')) { throw 'scope-shape' }
    function Assert-NoCredentials([object]$Value) {
      if ($Value -is [Collections.IDictionary]) {
        foreach ($key in $Value.Keys) {
          if ([string]$key -match 'token|secret|password|subject|authorizedOwner|email') { throw 'credential' }
          Assert-NoCredentials $Value[$key]
        }
      } elseif ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
        foreach ($entry in $Value) { Assert-NoCredentials $entry }
      }
    }
    Assert-NoCredentials $inputValue.payload
    $plain = [Text.Encoding]::UTF8.GetBytes(($inputValue.payload | ConvertTo-Json -Depth 12 -Compress))
    if ($plain.Length -gt 16384) { throw 'large' }
    $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Array]::Clear($plain)
    $name = 'scope-' + [Guid]::NewGuid().ToString('N') + '.dpapi'
    Write-Private (Join-Path $root $name) $cipher
    @{ fileName = $name; sha256 = [Convert]::ToHexStringLower([Security.Cryptography.SHA256]::HashData($cipher)) } | ConvertTo-Json -Compress
  } elseif ($inputValue.action -cin @('read', 'complete')) {
    $item = $inputValue.payload
    if ((@($item.Keys | Sort-Object) -join ',') -cne 'fileName,sha256' -or $item.fileName -cnotmatch '^scope-[a-f0-9]{32}\.dpapi$' -or $item.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'handle' }
    $path = Join-Path $root $item.fileName
    Assert-Private $path
    if ((Get-Item -LiteralPath $path).Length -gt 32768) { throw 'large' }
    $cipher = [IO.File]::ReadAllBytes($path)
    if ([Convert]::ToHexStringLower([Security.Cryptography.SHA256]::HashData($cipher)) -cne $item.sha256) { throw 'digest' }
    if ($inputValue.action -ceq 'complete') {
      Write-Private ($path + '.complete') ([Text.Encoding]::UTF8.GetBytes($item.sha256))
      '{"completed":true}'
    } else {
      $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
      try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain)) } finally { [Array]::Clear($plain) }
    }
  } else { throw 'action' }
} catch {
  [Console]::Error.WriteLine('d2_recovery_unavailable')
  exit 1
}
