$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vaultRoot = $repositoryRoot
while ($null -ne $vaultRoot -and -not (Test-Path -LiteralPath (Join-Path $vaultRoot 'AGENTS.md'))) {
  $parent = Split-Path -Parent $vaultRoot
  if ($parent -eq $vaultRoot) { $vaultRoot = $null; break }
  $vaultRoot = $parent
}
$generator = Join-Path $PSScriptRoot 'local-production-secrets.ps1'

function Assert-True {
  param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Get-EnvironmentValues {
  param([Parameter(Mandatory)][string]$Path)
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -ne 2) { throw "Malformed environment line in test fixture: $line" }
    $values[$parts[0]] = $parts[1]
  }
  return $values
}

function Invoke-Generator {
  param([string[]]$Arguments = @())
  $output = & pwsh -NoProfile -File $generator @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Generator failed: $($output -join [Environment]::NewLine)" }
  return @($output | ForEach-Object { [string]$_ })
}

Assert-True (Test-Path -LiteralPath $generator) 'Generator script is missing'

$originalLocalAppData = $env:LOCALAPPDATA
$temporaryLocalAppData = Join-Path ([IO.Path]::GetTempPath()) ("NanjingPetCare-secrets-test-" + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $temporaryLocalAppData -Force | Out-Null
  $env:LOCALAPPDATA = $temporaryLocalAppData
  $expectedTarget = [IO.Path]::GetFullPath((Join-Path $temporaryLocalAppData 'NanjingPetCare'))
  $firstOutput = Invoke-Generator
  $environmentPath = Join-Path $expectedTarget 'local-production.env'
  $adminPasswordPath = Join-Path $expectedTarget 'admin-password'

  Assert-True (Test-Path -LiteralPath $environmentPath -PathType Leaf) 'First run must create local-production.env'
  Assert-True (Test-Path -LiteralPath $adminPasswordPath -PathType Leaf) 'First run must create admin-password'
  Assert-True (-not $expectedTarget.StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase)) 'Default target must be outside the repository'

  $environment = Get-EnvironmentValues -Path $environmentPath
  foreach ($name in @('NODE_ENV', 'PILOT_MODE', 'PILOT_SHARED_INGRESS_RATE_LIMITING', 'SITE_DOMAIN', 'STORAGE_DOMAIN', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET')) {
    Assert-True ($environment.ContainsKey($name)) "Environment must contain $name"
  }
  foreach ($name in @('PILOT_AUTH_PEPPER', 'FIELD_ENCRYPTION_KEY_V1')) {
    Assert-True ([Convert]::FromBase64String($environment[$name]).Length -eq 32) "$name must decode to exactly 32 bytes"
  }
  foreach ($name in @('POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'S3_SECRET_ACCESS_KEY')) {
    Assert-True ($environment[$name].Length -ge 32) "$name must be at least 32 characters"
  }
  $adminPassword = [IO.File]::ReadAllText($adminPasswordPath).TrimEnd("`r", "`n")
  Assert-True ($adminPassword.Length -ge 32) 'Administrator password must be at least 32 characters'
  Assert-True (-not $environment.ContainsKey('ADMIN_PASSWORD')) 'Administrator password must not be stored in the environment file'
  Assert-True ($environment['PILOT_AUTH_PEPPER'] -ne $environment['FIELD_ENCRYPTION_KEY_V1']) 'Independent Base64 secrets must differ'

  $firstEnvironmentBytes = [IO.File]::ReadAllBytes($environmentPath)
  $firstAdminPasswordBytes = [IO.File]::ReadAllBytes($adminPasswordPath)
  $secondOutput = Invoke-Generator
  Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$firstEnvironmentBytes, [byte[]][IO.File]::ReadAllBytes($environmentPath))) 'Second run must not rotate environment values'
  Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$firstAdminPasswordBytes, [byte[]][IO.File]::ReadAllBytes($adminPasswordPath))) 'Second run must not rotate administrator password'

  $allOutput = @($firstOutput + $secondOutput) -join "`n"
  foreach ($secret in @($environment['POSTGRES_PASSWORD'], $environment['MINIO_ROOT_PASSWORD'], $environment['S3_SECRET_ACCESS_KEY'], $environment['PILOT_AUTH_PEPPER'], $environment['FIELD_ENCRYPTION_KEY_V1'], $adminPassword)) {
    Assert-True (-not $allOutput.Contains($secret, [StringComparison]::Ordinal)) 'Standard output must not contain a generated value'
  }
  Assert-True ($allOutput.Contains($expectedTarget, [StringComparison]::OrdinalIgnoreCase)) 'Standard output must name the secret directory'

  foreach ($path in @($expectedTarget, $environmentPath, $adminPasswordPath)) {
    $acl = Get-Acl -LiteralPath $path
    Assert-True (-not $acl.AreAccessRulesProtected -eq $false) "ACL inheritance must be removed for $path"
    $identities = @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    foreach ($identity in $identities) {
      Assert-True ($identity -eq "$env:USERDOMAIN\$env:USERNAME" -or $identity -eq 'NT AUTHORITY\SYSTEM') "ACL for $path must only allow current user and SYSTEM"
    }
  }

  $unsafeRepositoryTarget = Join-Path $repositoryRoot '.local-production\unsafe'
  $unsafeVaultTarget = Join-Path $vaultRoot '.local-production\unsafe'
  foreach ($unsafeTarget in @($unsafeRepositoryTarget, $unsafeVaultTarget)) {
    $unsafeOutput = & pwsh -NoProfile -File $generator -Destination $unsafeTarget 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "Target inside repository or Vault must be rejected: $unsafeTarget"
    Assert-True (-not (($unsafeOutput -join "`n").Contains('POSTGRES_PASSWORD'))) 'Unsafe-destination failure must not print secrets'
  }
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  if (Test-Path -LiteralPath $temporaryLocalAppData) { Remove-Item -LiteralPath $temporaryLocalAppData -Recurse -Force }
}

Write-Output 'local-production-secrets tests passed'
