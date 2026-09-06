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
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name

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

function Get-PathFingerprint {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  $item = Get-Item -LiteralPath $Path -Force
  $content = if ($item -is [IO.FileInfo]) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path)) } else { '<directory>' }
  return "$content|$((Get-Acl -LiteralPath $Path).Sddl)"
}

function Assert-RejectedWithoutMutation {
  param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string[]]$WatchPaths,
    [Parameter(Mandatory)][string]$Reason
  )
  $before = @{}
  foreach ($path in $WatchPaths) { $before[$path] = Get-PathFingerprint $path }
  $output = & pwsh -NoProfile -File $generator -Destination $Destination 2>&1
  $exitCode = $LASTEXITCODE
  Assert-True ($exitCode -ne 0) "$Reason must be rejected"
  foreach ($path in $WatchPaths) {
    Assert-True ((Get-PathFingerprint $path) -eq $before[$path]) "$Reason must leave bytes and ACLs unchanged"
  }
  Assert-True (-not (($output -join "`n").Contains('POSTGRES_PASSWORD'))) "$Reason failure must not print secrets"
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
  $ownerMarkerPath = Join-Path $expectedTarget '.local-production-owner'

  Assert-True (Test-Path -LiteralPath $environmentPath -PathType Leaf) 'First run must create local-production.env'
  Assert-True (Test-Path -LiteralPath $adminPasswordPath -PathType Leaf) 'First run must create admin-password'
  Assert-True (-not $expectedTarget.StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase)) 'Default target must be outside the repository'

  $environment = Get-EnvironmentValues -Path $environmentPath
  foreach ($name in @('NODE_ENV', 'PILOT_MODE', 'PILOT_SHARED_INGRESS_RATE_LIMITING', 'SITE_DOMAIN', 'STORAGE_DOMAIN', 'POSTGRES_MAINTENANCE_PORT', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET')) {
    Assert-True ($environment.ContainsKey($name)) "Environment must contain $name"
  }
  Assert-True ($environment['POSTGRES_MAINTENANCE_PORT'] -eq '54329') 'PostgreSQL maintenance port must be explicit and stable'
  Assert-True ($environment['LOCAL_HTTP_PORT'] -eq '8080' -and $environment['LOCAL_HTTPS_PORT'] -eq '443') 'Local host ports default to HTTP 8080 and fixed-origin HTTPS 443'
  Assert-True ($environment['S3_ACCESS_KEY_ID'] -match '^[A-Za-z0-9_-]{20}$') 'Generated MinIO service-account access key must be exactly 20 URL-safe characters'
  Assert-True ($environment['S3_SECRET_ACCESS_KEY'] -match '^[A-Za-z0-9_-]{40}$') 'Generated MinIO service-account secret key must be exactly 40 URL-safe characters'
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

  $safeOverrideTarget = Join-Path $temporaryLocalAppData 'safe-override-secret-leaf'
  $safeOverrideOutput = Invoke-Generator -Arguments @('-Destination', $safeOverrideTarget)
  Assert-True (Test-Path -LiteralPath (Join-Path $safeOverrideTarget '.local-production-owner') -PathType Leaf) 'A safe absent override leaf must be accepted and marked as owned'
  Assert-True (($safeOverrideOutput -join "`n").Contains($safeOverrideTarget, [StringComparison]::OrdinalIgnoreCase)) 'Safe override output must name the secret directory'

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
      Assert-True ($identity -eq $currentIdentity -or $identity -eq 'NT AUTHORITY\SYSTEM') "ACL for $path must only allow current user and SYSTEM"
    }
  }

  $unrelatedDirectory = Join-Path $temporaryLocalAppData 'unrelated-existing-directory'
  $legacyAccessKey = 'L' * 32
  $originalEnvironmentText = [IO.File]::ReadAllText($environmentPath)
  $legacyEnvironmentText = $originalEnvironmentText.Replace("S3_ACCESS_KEY_ID=$($environment['S3_ACCESS_KEY_ID'])", "S3_ACCESS_KEY_ID=$legacyAccessKey")
  [IO.File]::WriteAllText($environmentPath, $legacyEnvironmentText, [Text.UTF8Encoding]::new($false))
  $migrationAcls = @{}
  foreach ($path in @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath)) { $migrationAcls[$path] = (Get-Acl -LiteralPath $path).Sddl }
  $migrationAdminBytes = [IO.File]::ReadAllBytes($adminPasswordPath)
  $migrationOutput = Invoke-Generator
  $migratedEnvironment = Get-EnvironmentValues $environmentPath
  Assert-True ($migratedEnvironment['S3_ACCESS_KEY_ID'] -match '^[A-Za-z0-9_-]{20}$') 'Legacy 32-character generator access key is migrated to supported length'
  $migratedText = [IO.File]::ReadAllText($environmentPath)
  Assert-True ($migratedText -ceq $legacyEnvironmentText.Replace("S3_ACCESS_KEY_ID=$legacyAccessKey", "S3_ACCESS_KEY_ID=$($migratedEnvironment['S3_ACCESS_KEY_ID'])")) 'Migration changes exactly the access-key field, preserving every other byte'
  Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$migrationAdminBytes, [byte[]][IO.File]::ReadAllBytes($adminPasswordPath))) 'Migration preserves administrator password bytes'
  foreach ($path in $migrationAcls.Keys) { Assert-True ((Get-Acl -LiteralPath $path).Sddl -eq $migrationAcls[$path]) 'Migration preserves existing ACL restrictions' }
  Assert-True (-not (($migrationOutput -join "`n").Contains($legacyAccessKey)) -and -not (($migrationOutput -join "`n").Contains($migratedEnvironment['S3_ACCESS_KEY_ID']))) 'Migration prints neither access-key value'
  $null = Invoke-Generator
  Assert-True ([IO.File]::ReadAllText($environmentPath) -ceq $migratedText) 'Migration is idempotent'
  foreach ($invalidKey in @(('A' * 21), ('A' * 31), ('A' * 33), ('A' * 31 + '/'))) {
    [IO.File]::WriteAllText($environmentPath, $migratedText.Replace("S3_ACCESS_KEY_ID=$($migratedEnvironment['S3_ACCESS_KEY_ID'])", "S3_ACCESS_KEY_ID=$invalidKey"), [Text.UTF8Encoding]::new($false))
    Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath) -Reason 'A non-legacy invalid service-account access key'
  }
  [IO.File]::WriteAllText($environmentPath, $migratedText, [Text.UTF8Encoding]::new($false))
  $legacySecretKey = 'S' * 43
  $legacySecretText = $migratedText.Replace("S3_SECRET_ACCESS_KEY=$($migratedEnvironment['S3_SECRET_ACCESS_KEY'])", "S3_SECRET_ACCESS_KEY=$legacySecretKey")
  [IO.File]::WriteAllText($environmentPath, $legacySecretText, [Text.UTF8Encoding]::new($false))
  $secretMigrationOutput = Invoke-Generator
  $secretMigratedEnvironment = Get-EnvironmentValues $environmentPath
  Assert-True ($secretMigratedEnvironment['S3_SECRET_ACCESS_KEY'] -match '^[A-Za-z0-9_-]{40}$') 'Legacy 43-character secret key is migrated to supported length'
  $secretMigratedText = [IO.File]::ReadAllText($environmentPath)
  Assert-True ($secretMigratedText -ceq $legacySecretText.Replace("S3_SECRET_ACCESS_KEY=$legacySecretKey", "S3_SECRET_ACCESS_KEY=$($secretMigratedEnvironment['S3_SECRET_ACCESS_KEY'])")) 'Secret-key migration changes exactly its field, preserving every other byte'
  Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$migrationAdminBytes, [byte[]][IO.File]::ReadAllBytes($adminPasswordPath))) 'Secret-key migration preserves administrator password bytes'
  foreach ($path in $migrationAcls.Keys) { Assert-True ((Get-Acl -LiteralPath $path).Sddl -eq $migrationAcls[$path]) 'Secret-key migration preserves existing ACL restrictions' }
  Assert-True (-not (($secretMigrationOutput -join "`n").Contains($legacySecretKey)) -and -not (($secretMigrationOutput -join "`n").Contains($secretMigratedEnvironment['S3_SECRET_ACCESS_KEY']))) 'Secret-key migration prints neither value'
  $null = Invoke-Generator
  Assert-True ([IO.File]::ReadAllText($environmentPath) -ceq $secretMigratedText) 'Secret-key migration is idempotent'
  foreach ($invalidKey in @(('S' * 41), ('S' * 42), ('S' * 44), ('S' * 42 + '/'))) {
    [IO.File]::WriteAllText($environmentPath, $secretMigratedText.Replace("S3_SECRET_ACCESS_KEY=$($secretMigratedEnvironment['S3_SECRET_ACCESS_KEY'])", "S3_SECRET_ACCESS_KEY=$invalidKey"), [Text.UTF8Encoding]::new($false))
    Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath) -Reason 'A non-legacy invalid service-account secret key'
  }
  [IO.File]::WriteAllText($environmentPath, $secretMigratedText, [Text.UTF8Encoding]::new($false))
  $withoutPorts = [regex]::Replace($secretMigratedText, '(?m)^LOCAL_(HTTP|HTTPS)_PORT=\d+\r?\n?', '')
  [IO.File]::WriteAllText($environmentPath, $withoutPorts, [Text.UTF8Encoding]::new($false))
  $null = Invoke-Generator
  $portedText = [IO.File]::ReadAllText($environmentPath)
  $portSeparator = if ($withoutPorts.EndsWith("`n")) { '' } else { "`n" }
  Assert-True ($portedText -ceq ($withoutPorts + $portSeparator + "LOCAL_HTTP_PORT=8080`nLOCAL_HTTPS_PORT=443`n")) 'Owned legacy environment gains only the two non-secret port fields'
  foreach ($path in $migrationAcls.Keys) { Assert-True ((Get-Acl -LiteralPath $path).Sddl -eq $migrationAcls[$path]) 'Port-field migration preserves ACL restrictions' }
  foreach ($invalidPort in @('0', '65536', 'abc', '443', '54329')) {
    [IO.File]::WriteAllText($environmentPath, $portedText.Replace('LOCAL_HTTP_PORT=8080', "LOCAL_HTTP_PORT=$invalidPort"), [Text.UTF8Encoding]::new($false))
    Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($environmentPath, $adminPasswordPath) -Reason 'An invalid or internally conflicting HTTP port'
  }
  [IO.File]::WriteAllText($environmentPath, $portedText.Replace('LOCAL_HTTPS_PORT=443', 'LOCAL_HTTPS_PORT=8443'), [Text.UTF8Encoding]::new($false))
  Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($environmentPath) -Reason 'HTTPS port conflicting with fixed public origins'
  $customPortText = $portedText.Replace('LOCAL_HTTP_PORT=8080', 'LOCAL_HTTP_PORT=8081')
  [IO.File]::WriteAllText($environmentPath, $customPortText, [Text.UTF8Encoding]::new($false))
  $null = Invoke-Generator
  Assert-True ([IO.File]::ReadAllText($environmentPath) -ceq $customPortText) 'Valid custom HTTP port remains unchanged'
  [IO.File]::WriteAllText($environmentPath, $portedText, [Text.UTF8Encoding]::new($false))
  New-Item -ItemType Directory -Path $unrelatedDirectory -Force | Out-Null
  $unrelatedSentinel = Join-Path $unrelatedDirectory 'sentinel.txt'
  [IO.File]::WriteAllText($unrelatedSentinel, 'must remain unchanged', [Text.UTF8Encoding]::new($false))
  Assert-RejectedWithoutMutation -Destination $unrelatedDirectory -WatchPaths @($unrelatedDirectory, $unrelatedSentinel) -Reason 'An unrelated existing directory'

  $driveLetter = @('Z', 'Y', 'X', 'W', 'V', 'U') | Where-Object { -not (Test-Path -LiteralPath "$_`:\") } | Select-Object -First 1
  Assert-True ($null -ne $driveLetter) 'A free drive letter is required for the safe root-rejection test'
  $substituteRootBacking = Join-Path $temporaryLocalAppData 'substitute-drive-root'
  New-Item -ItemType Directory -Path $substituteRootBacking -Force | Out-Null
  $substituteSentinel = Join-Path $substituteRootBacking 'sentinel.txt'
  [IO.File]::WriteAllText($substituteSentinel, 'must remain unchanged', [Text.UTF8Encoding]::new($false))
  & subst.exe "$driveLetter`:" $substituteRootBacking | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'Unable to create a harmless substitute drive for the root-rejection test'
  try {
    Assert-RejectedWithoutMutation -Destination "$driveLetter`:\" -WatchPaths @($substituteRootBacking, $substituteSentinel) -Reason 'A filesystem root'
  } finally {
    & subst.exe "$driveLetter`:" '/d' | Out-Null
  }

  Assert-True (Test-Path -LiteralPath $ownerMarkerPath -PathType Leaf) 'First run must create an ownership marker'
  $markerAcl = Get-Acl -LiteralPath $ownerMarkerPath
  Assert-True $markerAcl.AreAccessRulesProtected 'Ownership-marker ACL inheritance must be removed'
  foreach ($identity in @($markerAcl.Access | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)) {
    Assert-True ($identity -eq $currentIdentity -or $identity -eq 'NT AUTHORITY\SYSTEM') 'Ownership-marker ACL must only allow current user and SYSTEM'
  }

  $reparseBacking = Join-Path $temporaryLocalAppData 'reparse-backing'
  $reparsePath = Join-Path $temporaryLocalAppData 'reparse-link'
  New-Item -ItemType Directory -Path $reparseBacking -Force | Out-Null
  $reparseSentinel = Join-Path $reparseBacking 'sentinel.txt'
  [IO.File]::WriteAllText($reparseSentinel, 'must remain unchanged', [Text.UTF8Encoding]::new($false))
  $junctionCreated = $false
  try {
    New-Item -ItemType Junction -Path $reparsePath -Target $reparseBacking -ErrorAction Stop | Out-Null
    $junctionCreated = $true
  } catch { }
  if ($junctionCreated) {
    try {
      Assert-RejectedWithoutMutation -Destination (Join-Path $reparsePath 'NanjingPetCare') -WatchPaths @($reparseBacking, $reparseSentinel) -Reason 'A reparse-point ancestor'
    } finally {
      Remove-Item -LiteralPath $reparsePath -Force
    }
  }

  $validEnvironmentBytes = [IO.File]::ReadAllBytes($environmentPath)
  $validAdminPasswordBytes = [IO.File]::ReadAllBytes($adminPasswordPath)
  [IO.File]::WriteAllText($environmentPath, 'malformed', [Text.UTF8Encoding]::new($false))
  Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath) -Reason 'A malformed existing environment file'
  [IO.File]::WriteAllBytes($environmentPath, $validEnvironmentBytes)
  Remove-Item -LiteralPath $adminPasswordPath -Force
  Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath) -Reason 'A partial existing secret set'
  [IO.File]::WriteAllBytes($adminPasswordPath, $validAdminPasswordBytes)
  [IO.File]::WriteAllBytes($environmentPath, [byte[]](0xEF, 0xBB, 0xBF) + $validEnvironmentBytes)
  Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath) -Reason 'A BOM-prefixed existing environment file'
  [IO.File]::WriteAllBytes($environmentPath, $validEnvironmentBytes)
  [IO.File]::WriteAllBytes($adminPasswordPath, [byte[]](0xEF, 0xBB, 0xBF) + $validAdminPasswordBytes)
  Assert-RejectedWithoutMutation -Destination $expectedTarget -WatchPaths @($expectedTarget, $environmentPath, $adminPasswordPath, $ownerMarkerPath) -Reason 'A BOM-prefixed existing administrator password file'
  [IO.File]::WriteAllBytes($adminPasswordPath, $validAdminPasswordBytes)

  $unsafeRepositoryTarget = Join-Path $repositoryRoot '.local-production\unsafe'
  $unsafeVaultTarget = Join-Path $vaultRoot '.local-production\unsafe'
  foreach ($unsafeTarget in @($unsafeRepositoryTarget, $unsafeVaultTarget)) {
    $unsafeOutput = & pwsh -NoProfile -File $generator -Destination $unsafeTarget 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "Target inside repository or Vault must be rejected: $unsafeTarget"
    Assert-True (-not (($unsafeOutput -join "`n").Contains('POSTGRES_PASSWORD'))) 'Unsafe-destination failure must not print secrets'
  }
  Assert-RejectedWithoutMutation -Destination $env:USERPROFILE -WatchPaths @($env:USERPROFILE) -Reason 'A user-profile root'

  $validMarkerBytes = [IO.File]::ReadAllBytes($ownerMarkerPath)
  [IO.File]::WriteAllText($ownerMarkerPath, 'invalid owner marker', [Text.UTF8Encoding]::new($false))
  $invalidDefaultOutput = & pwsh -NoProfile -File $generator 2>&1
  Assert-True ($LASTEXITCODE -ne 0) 'A damaged existing default secret directory must fail closed instead of creating replacement secrets in a child'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $expectedTarget 'local-production-secrets'))) 'A damaged owned parent must not silently fall back'
  [IO.File]::WriteAllBytes($ownerMarkerPath, $validMarkerBytes)

  # The application also stores runtime/backups here; never claim or rewrite that parent.
  $sharedLocalAppData = Join-Path $temporaryLocalAppData 'shared-application-data'
  $sharedParent = Join-Path $sharedLocalAppData 'NanjingPetCare'
  $backups = Join-Path $sharedParent 'backups'
  $runtime = Join-Path $sharedParent 'runtime'
  New-Item -ItemType Directory -Path $backups, $runtime -Force | Out-Null
  $beforeParent = Get-PathFingerprint $sharedParent
  $beforeBackups = Get-PathFingerprint $backups
  $beforeRuntime = Get-PathFingerprint $runtime
  $env:LOCALAPPDATA = $sharedLocalAppData
  $null = Invoke-Generator
  $secureLeaf = Join-Path $sharedParent 'local-production-secrets'
  Assert-True (Test-Path -LiteralPath (Join-Path $secureLeaf 'local-production.env')) 'An unowned application parent must use the dedicated secure child'
  Assert-True ((Get-PathFingerprint $sharedParent) -eq $beforeParent) 'Default selection must preserve the existing parent ACL'
  Assert-True ((Get-PathFingerprint $backups) -eq $beforeBackups) 'Default selection must preserve backups'
  Assert-True ((Get-PathFingerprint $runtime) -eq $beforeRuntime) 'Default selection must preserve runtime'
  $secureBytes = [IO.File]::ReadAllBytes((Join-Path $secureLeaf 'local-production.env'))
  $null = Invoke-Generator
  Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$secureBytes, [byte[]][IO.File]::ReadAllBytes((Join-Path $secureLeaf 'local-production.env')))) 'The dedicated secure child must be reused without rotation'
  Assert-RejectedWithoutMutation -Destination $sharedParent -WatchPaths @($sharedParent, $backups, $runtime) -Reason 'An explicitly selected unowned application parent'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryLocalAppData)
  if ($resolvedTemporaryRoot.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemporaryRoot).StartsWith('NanjingPetCare-secrets-test-') -and
      (Test-Path -LiteralPath $resolvedTemporaryRoot)) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}

Write-Output 'local-production-secrets tests passed'
