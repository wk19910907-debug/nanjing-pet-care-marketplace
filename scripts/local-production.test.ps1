$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:passed = 0
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $script:passed++
}
function Assert-Fails([scriptblock]$Operation, [string]$Message) {
  try { & $Operation | Out-Null } catch {
    Assert-True ($_.Exception.Message.Contains($Message)) "Expected sanitized error: $Message; received: $($_.Exception.Message)"
    return
  }
  throw "Expected failure: $Message"
}
$controller = Join-Path $PSScriptRoot 'local-production.ps1'
Assert-True (Test-Path -LiteralPath $controller) 'Lifecycle controller is missing'
. $controller
$realReadyProbe = ${function:Test-LocalProductionReady}

# Exercise the actual native-process adapter before replacing external dependencies.
$probeValue = 'space ; $() " quoted'
$native = Invoke-LocalProductionProcess -FilePath node -Arguments @('-e', 'process.stdout.write(process.argv[1])', $probeValue)
Assert-True ($native.ExitCode -eq 0 -and $native.Output -eq $probeValue) 'Native arguments preserve spaces and shell metacharacters literally'
$native = Invoke-LocalProductionProcess -FilePath node -Arguments @('-e', 'process.stdout.write(process.env.PETCARE_CONTROLLER_TEST);process.exit(17)') -Environment @{ PETCARE_CONTROLLER_TEST = 'child-only' }
Assert-True ($native.ExitCode -eq 17 -and $native.Output -eq 'child-only') 'Native result retains exit code and child environment'
Assert-True ([string]::IsNullOrEmpty($env:PETCARE_CONTROLLER_TEST)) 'Child environment does not mutate the host'
$native = Invoke-LocalProductionProcess -FilePath 'petcare-no-such-executable' -Arguments @()
Assert-True ($native.ExitCode -eq 127 -and $native.Output -eq '') 'Missing executable returns a sanitized failure'
$native = Invoke-LocalProductionProcess -FilePath node -Arguments @('-e', 'setTimeout(()=>{},10000)') -TimeoutSeconds 1
Assert-True ($native.ExitCode -eq 124 -and $native.Output -eq '') 'Hung child is killed at the process deadline'

# Only OS/process/network boundaries are replaced; lifecycle decisions execute for real.
$script:calls = [Collections.Generic.List[object]]::new()
$script:plugin = $true
$script:failure = ''
$script:dockerMissing = $false
$script:ready = $true
$script:probeCount = 0
$script:curlResult = @{ ExitCode = 0; Output = '302' }
function Invoke-LocalProductionProcess {
  param([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSeconds = 600, [hashtable]$Environment = @{})
  $script:calls.Add([pscustomobject]@{ File = $FilePath; Arguments = $Arguments; Environment = $Environment })
  $command = $Arguments -join ' '
  if ($FilePath -eq 'curl.exe') { return $script:curlResult }
  if ($FilePath -eq 'docker' -and $script:dockerMissing) { return @{ ExitCode = 127; Output = 'SECRET-CANARY daemon diagnostic' } }
  if ($command -eq 'compose version' -and -not $script:plugin) { return @{ ExitCode = 1; Output = 'SECRET-CANARY' } }
  if ($script:failure -and $command.Contains($script:failure)) { return @{ ExitCode = 17; Output = 'SECRET-CANARY process failure' } }
  if ($Arguments -contains 'ps') { return @{ ExitCode = 0; Output = '[{"Service":"app","State":"running","Health":"healthy","ExitCode":0,"Command":"SECRET-CANARY","Name":"SECRET-CANARY","Labels":"SECRET-CANARY"},{"Service":"migrate","State":"exited","Health":"","ExitCode":17}]' } }
  return @{ ExitCode = 0; Output = 'SECRET-CANARY successful process output' }
}
function Test-LocalProductionReady { $script:probeCount++; return $script:ready }
function Start-Sleep { param([int]$Seconds) }

$originalLocalAppData = $env:LOCALAPPDATA
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('petcare-controller-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  $env:LOCALAPPDATA = $temporaryRoot
  Assert-True (-not (& $realReadyProbe)) 'HTTPS redirect must not count as readiness'
  $script:curlResult = @{ ExitCode = 0; Output = '200' }
  Assert-True (& $realReadyProbe) 'HTTPS 200 counts as readiness'
  $script:curlResult = @{ ExitCode = 17; Output = '200' }
  Assert-True (-not (& $realReadyProbe)) 'Failed transport cannot count as readiness'
  $script:calls.Clear()
  $target = Join-Path $temporaryRoot 'NanjingPetCare'
  $output = @(Invoke-LocalProduction -Action start) -join "`n"
  Assert-True (-not $output.Contains('SECRET-CANARY')) 'Start must suppress raw process output'
  Assert-True ($output.Contains('https://petcare.localhost')) 'Start reports public origin'
  Assert-True ($output.Contains('system')) 'Start explains scoped TLS trust without installing a system CA'
  Assert-True ($script:calls[0].Arguments -contains 'local-production-secrets.ps1' -or ($script:calls[0].Arguments -join ' ').Contains('local-production-secrets.ps1')) 'Start generates secrets first'
  $composeCalls = @($script:calls | Where-Object { $_.Arguments -contains '--project-name' })
  Assert-True ($composeCalls.Count -ge 6) 'Start must build and run all initialization stages'
  foreach ($call in $composeCalls) {
    Assert-True ($call.Arguments -contains 'nanjing-petcare-local-production') 'Every Compose call names the project'
    Assert-True ($call.Arguments -contains (Join-Path $target 'local-production.env')) 'Every Compose call selects the env file as one argument'
    Assert-True (($call.Arguments -join ' ').Contains('compose.local-production.yml')) 'Every Compose call selects the compose file'
    Assert-True ($call.Environment.LOCAL_PRODUCTION_SECRET_DIR -eq $target) 'Compose gets the exact secret directory'
  }
  $commands = @($script:calls | ForEach-Object { $_.Arguments -join ' ' })
  foreach ($job in @('minio-init', 'migrate', 'admin-init')) {
    Assert-True (@($commands | Where-Object { $_.Contains("--exit-code-from $job $job") }).Count -eq 1) "Start must enforce the $job exit code"
  }
  Assert-True (@($commands | Where-Object { $_.StartsWith('build ') }).Count -eq 2) 'Build both images without requiring Compose buildx'
  Assert-True ($script:probeCount -eq 1) 'Start checks HTTPS readiness'

  # Status/stop require existing safe secret files but must never create or print values.
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'local-production-secrets.ps1') -Destination $target | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) 'Create actual restricted test fixture'
  $script:calls.Clear()
  $script:plugin = $false
  $status = @(Invoke-LocalProduction -Action status) -join "`n"
  Assert-True ($status.Contains('app: running (healthy)')) 'Status shows only service health'
  Assert-True ($status.Contains('migrate: exited (no healthcheck), exit 17')) 'Status exposes a failed init exit code safely'
  Assert-True (-not $status.Contains('SECRET-CANARY')) 'Status suppresses arbitrary container fields'
  Assert-True ($status.Contains('https://storage.petcare.localhost')) 'Status reports storage origin'
  Assert-True ($script:calls[1].Arguments -join ' ' -eq 'compose version') 'Probe plugin first'
  Assert-True ($script:calls[2].File -eq 'docker-compose') 'Fall back to standalone Compose'
  $script:calls.Clear()
  $null = Invoke-LocalProduction -Action stop
  Assert-True ($script:calls[-1].Arguments[-1] -eq 'stop') 'Stop preserves containers and volumes'
  Assert-True (-not (($script:calls | ForEach-Object { $_.Arguments -join ' ' }) -join ' ').Contains('down')) 'Never implicitly bring down volumes'

  $script:dockerMissing = $true
  Assert-Fails { Invoke-LocalProduction -Action status } 'Docker is unavailable; install/start Docker Desktop'
  $script:dockerMissing = $false
  $script:failure = 'ps --all'
  Assert-Fails { Invoke-LocalProduction -Action status } 'status failed (exit 17)'
  $script:failure = '--exit-code-from migrate'
  $script:calls.Clear()
  Assert-Fails { Invoke-LocalProduction -Action start } 'migrate failed (exit 17)'
  Assert-True (@($script:calls | Where-Object { $_.Arguments -contains 'admin-init' -or $_.Arguments -contains 'waf' }).Count -eq 0) 'Failed migration blocks admin and ingress startup'
  $script:failure = 'local-production-secrets.ps1'
  $script:calls.Clear()
  Assert-Fails { Invoke-LocalProduction -Action start } 'secret generation failed (exit 17)'
  Assert-True ($script:calls.Count -eq 1) 'Failed secrets block all Docker work'
  $script:failure = ''
  $script:ready = $false
  $script:probeCount = 0
  Assert-Fails { Invoke-LocalProduction -Action start -ReadinessAttempts 3 } 'HTTPS readiness timed out'
  Assert-True ($script:probeCount -eq 3) 'HTTPS retries are bounded'
  Assert-Fails { Invoke-LocalProduction -Action destroy } 'Unsupported action'
  Assert-Fails { Invoke-LocalProduction -Action start -SecretDirectory '.\secrets' } 'absolute path'
  Assert-Fails { Invoke-LocalProduction -Action start -SecretDirectory $PSScriptRoot } 'outside the repository and Vault'
  Assert-Fails { Invoke-LocalProduction -Action start -SecretDirectory $temporaryRoot } 'absent leaf directory or an owned'
  $safeOverride = Join-Path $temporaryRoot 'safe override'
  $script:ready = $true
  $script:calls.Clear()
  $null = Invoke-LocalProduction -Action start -SecretDirectory $safeOverride
  Assert-True ($script:calls[0].Arguments[-1] -eq $safeOverride) 'Safe override with spaces remains a single argument'
  Assert-True ($script:calls[-1].Environment.LOCAL_PRODUCTION_SECRET_DIR -eq $safeOverride) 'Override reaches the admin-secret mount'

  $verifyPath = Join-Path $PSScriptRoot 'verify-local-production.mjs'
  if (-not (Test-Path -LiteralPath $verifyPath)) {
    Assert-Fails { Invoke-LocalProduction -Action verify } 'verify-local-production.mjs is not available'
  }
  $package = Get-Content -Raw (Join-Path $PSScriptRoot '../package.json') | ConvertFrom-Json
  foreach ($action in @('start', 'status', 'stop', 'verify')) {
    Assert-True ($package.scripts."local-production:$action" -eq "pwsh -NoProfile -File scripts/local-production.ps1 $action") "Package exposes $action"
  }
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  $resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
  if ($resolvedTemporaryRoot.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemporaryRoot).StartsWith('petcare-controller-')) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}
Write-Output "$script:passed lifecycle assertions passed"
