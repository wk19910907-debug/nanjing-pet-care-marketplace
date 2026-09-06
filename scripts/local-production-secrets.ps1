param(
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NormalizedPath {
  param([Parameter(Mandatory)][string]$Path)
  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  if ($fullPath.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $root }
  return $fullPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-PathWithin {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Parent
  )
  $normalizedPath = Get-NormalizedPath $Path
  $normalizedParent = Get-NormalizedPath $Parent
  $prefix = if ($normalizedParent.EndsWith([IO.Path]::DirectorySeparatorChar)) {
    $normalizedParent
  } else {
    $normalizedParent + [IO.Path]::DirectorySeparatorChar
  }
  return $normalizedPath.Equals($normalizedParent, [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Get-VaultRoot {
  param([Parameter(Mandatory)][string]$StartPath)
  $candidate = Get-NormalizedPath $StartPath
  while ($true) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'AGENTS.md') -PathType Leaf) { return $candidate }
    $parent = Split-Path -Parent $candidate
    if ($parent -eq $candidate) { return $null }
    $candidate = $parent
  }
}

function Test-PathIsRoot {
  param([Parameter(Mandatory)][string]$Path)
  $normalizedPath = Get-NormalizedPath $Path
  return $normalizedPath.Equals([IO.Path]::GetPathRoot($normalizedPath), [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparsePoint {
  param([Parameter(Mandatory)][string]$Path)
  $candidate = Get-NormalizedPath $Path
  while ($true) {
    if (Test-Path -LiteralPath $candidate) {
      $attributes = (Get-Item -LiteralPath $candidate -Force).Attributes
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Destination must not include a reparse point'
      }
    }
    if (Test-PathIsRoot $candidate) { return }
    $candidate = Split-Path -Parent $candidate
  }
}

function Test-OwnedSecretDirectory {
  param([Parameter(Mandatory)][string]$Target)
  $markerPath = Join-Path $Target '.local-production-owner'
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $false }
  Assert-NoReparsePoint $markerPath
  $markerBytes = [IO.File]::ReadAllBytes($markerPath)
  $expectedMarkerBytes = [Text.UTF8Encoding]::new($false).GetBytes("NanjingPetCare local production secrets v1`n")
  if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$markerBytes, [byte[]]$expectedMarkerBytes)) { return $false }
  $acl = Get-Acl -LiteralPath $Target
  if (-not $acl.AreAccessRulesProtected) { return $false }
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  foreach ($identity in @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)) {
    if ($identity -ne $currentIdentity -and $identity -ne 'NT AUTHORITY\SYSTEM') { return $false }
  }
  return $true
}

function Assert-SafeSecretTarget {
  param(
    [Parameter(Mandatory)][string]$Target,
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [AllowNull()][string]$VaultRoot
  )
  if (Test-PathIsRoot $Target) { throw 'Destination must be a dedicated non-root directory' }
  if ((Test-PathWithin $Target $RepositoryRoot) -or ($null -ne $VaultRoot -and (Test-PathWithin $Target $VaultRoot))) {
    throw 'Destination must be outside the repository and Vault'
  }
  Assert-NoReparsePoint $Target
  $parent = Split-Path -Parent $Target
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw 'Destination parent must be an existing non-reparse directory'
  }
  if (Test-Path -LiteralPath $Target) {
    if (-not (Test-Path -LiteralPath $Target -PathType Container) -or -not (Test-OwnedSecretDirectory $Target)) {
      throw 'Destination must be an absent leaf directory or an owned local production secret directory'
    }
  }
}

function New-RandomText {
  param([Parameter(Mandatory)][ValidateRange(16, 128)][int]$ByteCount)
  $bytes = [byte[]]::new($ByteCount)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-RandomBase64 {
  param([Parameter(Mandatory)][ValidateRange(16, 128)][int]$ByteCount)
  $bytes = [byte[]]::new($ByteCount)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Set-RestrictedAcl {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][bool]$IsDirectory
  )
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $inheritance = if ($IsDirectory) { '(OI)(CI)' } else { '' }
  $arguments = @($Path, '/inheritance:r', '/grant:r', "${currentIdentity}:${inheritance}(F)", "SYSTEM:${inheritance}(F)")
  & icacls.exe @arguments 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict local production secret permissions' }

  $acl = Get-Acl -LiteralPath $Path
  foreach ($identity in @($acl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)) {
    if ($identity -ne $currentIdentity -and $identity -ne 'NT AUTHORITY\SYSTEM') {
      & icacls.exe $Path '/remove' $identity 2>$null | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict local production secret permissions' }
    }
  }
}

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Content
  )
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Get-EnvironmentValues {
  param([Parameter(Mandatory)][string]$Path)
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw 'The existing local production environment file is malformed; nothing was changed'
  }
  $values = [ordered]@{}
  foreach ($line in [IO.File]::ReadAllLines($Path, [Text.UTF8Encoding]::new($false))) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[0]) -or $values.Contains($parts[0])) {
      throw 'The existing local production environment file is malformed; nothing was changed'
    }
    $values[$parts[0]] = $parts[1]
  }
  return $values
}

function Assert-ExistingSecretsAreValid {
  param(
    [Parameter(Mandatory)][string]$EnvironmentPath,
    [Parameter(Mandatory)][string]$AdminPasswordPath
  )
  $environment = Get-EnvironmentValues $EnvironmentPath
  $required = @(
    'NODE_ENV', 'PILOT_MODE', 'PILOT_SHARED_INGRESS_RATE_LIMITING', 'SITE_DOMAIN', 'STORAGE_DOMAIN',
    'PILOT_PUBLIC_ORIGIN', 'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_MAINTENANCE_PORT', 'DATABASE_URL',
    'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET',
    'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'FIELD_ENCRYPTION_KEY_V1', 'PILOT_AUTH_PEPPER'
  )
  if ($environment.Count -ne $required.Count -or @($required | Where-Object { -not $environment.Contains($_) }).Count -ne 0) {
    throw 'The existing local production environment file is malformed; nothing was changed'
  }
  $expected = @{
    NODE_ENV = 'production'; PILOT_MODE = 'enabled'; PILOT_SHARED_INGRESS_RATE_LIMITING = 'enabled'
    SITE_DOMAIN = 'petcare.localhost'; STORAGE_DOMAIN = 'storage.petcare.localhost'; PILOT_PUBLIC_ORIGIN = 'https://petcare.localhost'
    POSTGRES_USER = 'petcare'; POSTGRES_DB = 'petcare'; POSTGRES_MAINTENANCE_PORT = '54329'; S3_ENDPOINT = 'http://minio:9000'
    S3_PUBLIC_ENDPOINT = 'https://storage.petcare.localhost'; S3_BUCKET = 'pet-evidence'; S3_REGION = 'us-east-1'
  }
  foreach ($name in $expected.Keys) {
    if ($environment[$name] -ne $expected[$name]) { throw 'The existing local production environment file is malformed; nothing was changed' }
  }
  foreach ($name in @('POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'S3_SECRET_ACCESS_KEY')) {
    if ($environment[$name] -notmatch '^[A-Za-z0-9_-]{32,}$') { throw 'The existing local production environment file is malformed; nothing was changed' }
  }
  foreach ($name in @('MINIO_ROOT_USER', 'S3_ACCESS_KEY_ID')) {
    if ($environment[$name] -notmatch '^[A-Za-z0-9_-]{16,}$') { throw 'The existing local production environment file is malformed; nothing was changed' }
  }
  foreach ($name in @('FIELD_ENCRYPTION_KEY_V1', 'PILOT_AUTH_PEPPER')) {
    try { $decoded = [Convert]::FromBase64String($environment[$name]) } catch { throw 'The existing local production environment file is malformed; nothing was changed' }
    if ($decoded.Length -ne 32 -or [Convert]::ToBase64String($decoded) -ne $environment[$name]) {
      throw 'The existing local production environment file is malformed; nothing was changed'
    }
  }
  if ($environment['FIELD_ENCRYPTION_KEY_V1'] -eq $environment['PILOT_AUTH_PEPPER'] -or
    $environment['DATABASE_URL'] -ne "postgresql://petcare:$($environment['POSTGRES_PASSWORD'])@postgres:5432/petcare?schema=public") {
    throw 'The existing local production environment file is malformed; nothing was changed'
  }
  $adminBytes = [IO.File]::ReadAllBytes($AdminPasswordPath)
  if ($adminBytes.Length -ge 3 -and $adminBytes[0] -eq 0xEF -and $adminBytes[1] -eq 0xBB -and $adminBytes[2] -eq 0xBF) {
    throw 'The existing administrator password file is malformed; nothing was changed'
  }
  $adminPassword = [IO.File]::ReadAllText($AdminPasswordPath, [Text.UTF8Encoding]::new($false)).TrimEnd("`r", "`n")
  if ($adminPassword -notmatch '^[A-Za-z0-9_-]{32,}$') { throw 'The existing administrator password file is malformed; nothing was changed' }
}

if (-not $IsWindows) { throw 'Local production secret generation requires Windows' }
if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is unavailable' }

$repositoryRoot = Get-NormalizedPath (Join-Path $PSScriptRoot '..')
$vaultRoot = Get-VaultRoot $repositoryRoot
if ([string]::IsNullOrWhiteSpace($Destination)) {
  $Destination = Join-Path $env:LOCALAPPDATA 'NanjingPetCare'
} elseif (-not [IO.Path]::IsPathFullyQualified($Destination)) {
  throw 'Destination must be an absolute path outside the repository and Vault'
}
$target = Get-NormalizedPath $Destination
Assert-SafeSecretTarget -Target $target -RepositoryRoot $repositoryRoot -VaultRoot $vaultRoot

$ownerMarkerPath = Join-Path $target '.local-production-owner'
$environmentPath = Join-Path $target 'local-production.env'
$adminPasswordPath = Join-Path $target 'admin-password'
foreach ($path in @($ownerMarkerPath, $environmentPath, $adminPasswordPath)) {
  Assert-NoReparsePoint $path
  if ((Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw 'The local production secret set is malformed; nothing was changed'
  }
}
$environmentExists = Test-Path -LiteralPath $environmentPath -PathType Leaf
$adminPasswordExists = Test-Path -LiteralPath $adminPasswordPath -PathType Leaf
if ($environmentExists -xor $adminPasswordExists) {
  throw 'The local production secret set is incomplete; nothing was changed'
}

if ($environmentExists) {
  Assert-ExistingSecretsAreValid -EnvironmentPath $environmentPath -AdminPasswordPath $adminPasswordPath
  Set-RestrictedAcl -Path $target -IsDirectory $true
  Set-RestrictedAcl -Path $environmentPath -IsDirectory $false
  Set-RestrictedAcl -Path $adminPasswordPath -IsDirectory $false
  Write-Output "Validated protected local production secrets at $target"
  exit 0
}

New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
Assert-NoReparsePoint $target
Set-RestrictedAcl -Path $target -IsDirectory $true
Write-Utf8NoBomFile -Path $ownerMarkerPath -Content "NanjingPetCare local production secrets v1`n"
Set-RestrictedAcl -Path $ownerMarkerPath -IsDirectory $false

$postgresPassword = New-RandomText -ByteCount 32
$minioRootUser = New-RandomText -ByteCount 24
$minioRootPassword = New-RandomText -ByteCount 32
$minioAccessKeyId = New-RandomText -ByteCount 24
$minioSecretAccessKey = New-RandomText -ByteCount 32
$fieldEncryptionKey = New-RandomBase64 -ByteCount 32
$pilotAuthPepper = New-RandomBase64 -ByteCount 32
$adminPassword = New-RandomText -ByteCount 32

$environmentContent = @"
NODE_ENV=production
PILOT_MODE=enabled
PILOT_SHARED_INGRESS_RATE_LIMITING=enabled
SITE_DOMAIN=petcare.localhost
STORAGE_DOMAIN=storage.petcare.localhost
PILOT_PUBLIC_ORIGIN=https://petcare.localhost
POSTGRES_USER=petcare
POSTGRES_DB=petcare
POSTGRES_PASSWORD=$postgresPassword
POSTGRES_MAINTENANCE_PORT=54329
DATABASE_URL=postgresql://petcare:$postgresPassword@postgres:5432/petcare?schema=public
MINIO_ROOT_USER=$minioRootUser
MINIO_ROOT_PASSWORD=$minioRootPassword
S3_ENDPOINT=http://minio:9000
S3_PUBLIC_ENDPOINT=https://storage.petcare.localhost
S3_BUCKET=pet-evidence
S3_ACCESS_KEY_ID=$minioAccessKeyId
S3_SECRET_ACCESS_KEY=$minioSecretAccessKey
S3_REGION=us-east-1
FIELD_ENCRYPTION_KEY_V1=$fieldEncryptionKey
PILOT_AUTH_PEPPER=$pilotAuthPepper
"@

Write-Utf8NoBomFile -Path $environmentPath -Content $environmentContent
Write-Utf8NoBomFile -Path $adminPasswordPath -Content ($adminPassword + "`n")
Set-RestrictedAcl -Path $environmentPath -IsDirectory $false
Set-RestrictedAcl -Path $adminPasswordPath -IsDirectory $false
Write-Output "Created protected local production secrets at $target"
