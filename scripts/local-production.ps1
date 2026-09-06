param(
  [Parameter(Position = 0)][string]$Action = 'status',
  [string]$SecretDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'local-production-secrets.ps1')

function Invoke-LocalProductionProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$Arguments = @(),
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600,
    [hashtable]$Environment = @{}
  )
  $process = [Diagnostics.Process]::new()
  try {
    $command = Get-Command $FilePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $process.StartInfo = [Diagnostics.ProcessStartInfo]::new()
    $process.StartInfo.FileName = $command.Source
    $process.StartInfo.WorkingDirectory = Get-NormalizedPath (Join-Path $PSScriptRoot '..')
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $process.StartInfo.ArgumentList.Add($argument) }
    foreach ($name in $Environment.Keys) { $process.StartInfo.Environment[$name] = [string]$Environment[$name] }
    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $process.Kill($true)
      $process.WaitForExit()
      return @{ ExitCode = 124; Output = '' }
    }
    return @{ ExitCode = $process.ExitCode; Output = ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()) }
  } catch {
    # Neither command diagnostics nor exception text is safe for console output.
    return @{ ExitCode = 127; Output = '' }
  } finally {
    $process.Dispose()
  }
}

function Assert-LocalProductionResult {
  param([Parameter(Mandatory)]$Result, [Parameter(Mandatory)][string]$Stage)
  if ($Result.ExitCode -ne 0) { throw "$Stage failed (exit $($Result.ExitCode)); inspect the local container state without sharing credentials." }
}

function Get-LocalProductionCompose {
  $docker = Invoke-LocalProductionProcess -FilePath docker -Arguments @('info', '--format', '{{.ServerVersion}}') -TimeoutSeconds 30
  if ($docker.ExitCode -ne 0) { throw 'Docker is unavailable; install/start Docker Desktop and retry.' }
  $plugin = Invoke-LocalProductionProcess -FilePath docker -Arguments @('compose', 'version') -TimeoutSeconds 30
  if ($plugin.ExitCode -eq 0) { return @{ File = 'docker'; Prefix = @('compose') } }
  $standalone = Invoke-LocalProductionProcess -FilePath docker-compose -Arguments @('version') -TimeoutSeconds 30
  if ($standalone.ExitCode -ne 0) { throw 'Docker Compose is unavailable; install the Compose plugin or docker-compose and retry.' }
  return @{ File = 'docker-compose'; Prefix = @() }
}

function Invoke-LocalProductionCompose {
  param($Compose, [string]$Target, [string[]]$Arguments, [string]$Stage, [int]$TimeoutSeconds = 300)
  $composeFile = Join-Path $PSScriptRoot '../deploy/compose.local-production.yml'
  $options = @('--project-name', 'nanjing-petcare-local-production', '--env-file', (Join-Path $Target 'local-production.env'), '--file', ([IO.Path]::GetFullPath($composeFile)))
  $result = Invoke-LocalProductionProcess -FilePath $Compose.File -Arguments @($Compose.Prefix + $options + $Arguments) -TimeoutSeconds $TimeoutSeconds -Environment @{ LOCAL_PRODUCTION_SECRET_DIR = $Target }
  Assert-LocalProductionResult $result $Stage
  return $result
}

function Test-LocalProductionReady {
  # Scope the self-signed certificate exception to this loopback HTTPS probe only.
  $result = Invoke-LocalProductionProcess -FilePath curl.exe -Arguments @('--silent', '--fail', '--insecure', '--noproxy', '*', '--resolve', 'petcare.localhost:443:127.0.0.1', '--max-time', '5', '--output', 'NUL', '--write-out', '%{http_code}', 'https://petcare.localhost/health/ready') -TimeoutSeconds 10
  return $result.ExitCode -eq 0 -and $result.Output -eq '200'
}

function Write-LocalProductionStatus {
  param([string]$Json)
  if ([string]::IsNullOrWhiteSpace($Json)) { Write-Output 'No local production containers exist.'; return }
  try {
    # Compose versions emit either a JSON array or one JSON object per line.
    $rows = if ($Json.TrimStart().StartsWith('[')) { @($Json | ConvertFrom-Json) } else {
      @($Json -split '\r?\n' | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
    }
    foreach ($row in $rows) {
      if ($row.Service -notin @('postgres', 'minio', 'minio-init', 'migrate', 'admin-init', 'app', 'waf')) { continue }
      $state = if ($row.State -in @('running', 'exited', 'created', 'restarting', 'paused', 'removing', 'dead')) { $row.State } else { 'unknown' }
      $health = if ($row.Health -in @('healthy', 'unhealthy', 'starting')) { $row.Health } else { 'no healthcheck' }
      $exitStatus = if ($state -eq 'exited' -and [string]$row.ExitCode -match '^\d{1,3}$') { ", exit $($row.ExitCode)" } else { '' }
      Write-Output "$($row.Service): $state ($health)$exitStatus"
    }
  } catch { throw 'Container status response is invalid; no raw output was displayed.' }
}

function Invoke-LocalProduction {
  param(
    [string]$Action = 'status',
    [string]$SecretDirectory,
    [ValidateRange(1, 120)][int]$ReadinessAttempts = 30
  )
  if ($Action -notin @('start', 'status', 'stop', 'verify')) { throw 'Unsupported action; use start, status, stop, or verify.' }
  $repositoryRoot = Get-NormalizedPath (Join-Path $PSScriptRoot '..')
  $target = Get-LocalProductionSecretTarget -Destination $SecretDirectory -RepositoryRoot $repositoryRoot
  if ($Action -eq 'start') {
    Write-Output 'Generating or validating protected local production secrets...'
    $result = Invoke-LocalProductionProcess -FilePath pwsh -Arguments @('-NoProfile', '-File', (Join-Path $PSScriptRoot 'local-production-secrets.ps1'), '-Destination', $target)
    Assert-LocalProductionResult $result 'secret generation'
  } elseif ($Action -eq 'verify') {
    $verifyScript = Join-Path $PSScriptRoot 'verify-local-production.mjs'
    if (-not (Test-Path -LiteralPath $verifyScript -PathType Leaf)) { throw 'verify-local-production.mjs is not available; complete the security and browser acceptance setup first.' }
    $result = Invoke-LocalProductionProcess -FilePath node -Arguments @($verifyScript) -Environment @{ LOCAL_PRODUCTION_SECRET_DIR = $target } -TimeoutSeconds 900
    Assert-LocalProductionResult $result 'security and browser acceptance'
    Write-Output 'Local production security and browser acceptance passed.'
    return
  } else {
    $environmentPath = Join-Path $target 'local-production.env'
    $adminPasswordPath = Join-Path $target 'admin-password'
    if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
      Write-Output 'Local production is not initialized; run pnpm local-production:start.'
      Write-Output 'Application: https://petcare.localhost | Storage: https://storage.petcare.localhost'
      return
    }
    Assert-NoReparsePoint $environmentPath
    Assert-NoReparsePoint $adminPasswordPath
    Assert-ExistingSecretsAreValid -EnvironmentPath $environmentPath -AdminPasswordPath $adminPasswordPath
  }
  $compose = Get-LocalProductionCompose
  switch ($Action) {
    'start' {
      Write-Output 'Building application and WAF images...'
      $result = Invoke-LocalProductionProcess -FilePath docker -Arguments @('build', '--file', (Join-Path $repositoryRoot 'Dockerfile'), '--tag', 'nanjing-petcare:local', $repositoryRoot) -TimeoutSeconds 1800
      Assert-LocalProductionResult $result 'application build'
      $result = Invoke-LocalProductionProcess -FilePath docker -Arguments @('build', '--file', (Join-Path $repositoryRoot 'deploy/local-production/Dockerfile.waf'), '--tag', 'nanjing-petcare-waf:local', (Join-Path $repositoryRoot 'deploy')) -TimeoutSeconds 1800
      Assert-LocalProductionResult $result 'WAF build'
      Write-Output 'Starting dependencies and running storage, migration, and administrator initialization...'
      $null = Invoke-LocalProductionCompose $compose $target @('up', '--detach', '--no-build', '--wait', '--wait-timeout', '120', 'postgres', 'minio') 'dependencies'
      foreach ($job in @('minio-init', 'migrate', 'admin-init')) {
        $null = Invoke-LocalProductionCompose $compose $target @('up', '--no-build', '--no-deps', '--force-recreate', '--abort-on-container-exit', '--exit-code-from', $job, $job) $job
      }
      $null = Invoke-LocalProductionCompose $compose $target @('up', '--detach', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'app') 'application startup'
      $null = Invoke-LocalProductionCompose $compose $target @('up', '--detach', '--no-build', '--no-deps', 'waf') 'WAF startup'
      Write-Output 'TLS trust is scoped to this rehearsal probe and browser automation; no system root certificate is installed.'
      for ($attempt = 1; $attempt -le $ReadinessAttempts; $attempt++) {
        if (Test-LocalProductionReady) {
          Write-Output 'Ready: https://petcare.localhost | Storage: https://storage.petcare.localhost'
          return
        }
        if ($attempt -lt $ReadinessAttempts) { Start-Sleep -Seconds 2 }
      }
      throw 'HTTPS readiness timed out; run pnpm local-production:status to inspect service health.'
    }
    'status' {
      $result = Invoke-LocalProductionCompose $compose $target @('ps', '--all', '--format', 'json') 'status'
      Write-LocalProductionStatus $result.Output
      Write-Output 'Application: https://petcare.localhost | Storage: https://storage.petcare.localhost'
    }
    'stop' {
      $null = Invoke-LocalProductionCompose $compose $target @('stop') 'stop'
      Write-Output 'Local production containers stopped; all volumes and secrets were preserved.'
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  try { Invoke-LocalProduction -Action $Action -SecretDirectory $SecretDirectory } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}
