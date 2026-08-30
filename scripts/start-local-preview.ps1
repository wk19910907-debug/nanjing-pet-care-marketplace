param(
  [switch]$NoBrowser,
  [ValidateRange(1, 65436)][int]$PreferredAppPort = 51800
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FirstAvailablePort {
  param(
    [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$StartPort,
    [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$EndPort,
    [Parameter(Mandatory)][scriptblock]$Probe
  )

  if ($EndPort -lt $StartPort) { throw 'EndPort must not be lower than StartPort' }
  for ($port = $StartPort; $port -le $EndPort; $port++) {
    if (& $Probe $port) { return $port }
  }
  throw "No loopback port is available from $StartPort through $EndPort"
}

function Assert-LocalStatePath {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$LocalAppData
  )

  $applicationRoot = [IO.Path]::GetFullPath((Join-Path $LocalAppData 'NanjingPetCare'))
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  $rootPrefix = $applicationRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) `
    + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Path is outside the local application directory'
  }
  return $resolvedPath
}

function Test-LoopbackPort {
  param([Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port)

  $listener = $null
  try {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $listener) { $listener.Stop() }
  }
}

function New-ProtectedSecret {
  param([ValidateRange(16, 128)][int]$ByteCount = 32)

  $plainText = [Convert]::ToBase64String(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes($ByteCount)
  )
  return ConvertFrom-SecureString (ConvertTo-SecureString $plainText -AsPlainText -Force)
}

function Unprotect-LocalSecret {
  param([Parameter(Mandatory)][string]$ProtectedValue)

  $secure = ConvertTo-SecureString $ProtectedValue
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)][string]$Command,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

function Test-PreviewReady {
  param([Parameter(Mandatory)][int]$Port)

  try {
    $response = Invoke-RestMethod "http://127.0.0.1:$Port/health/ready" -TimeoutSec 2
    return $response.ready -eq $true -and $response.database -eq $true
  } catch {
    return $false
  }
}

function Start-LocalPreview {
  param(
    [switch]$NoBrowser,
    [ValidateRange(1, 65436)][int]$PreferredAppPort = 51800
  )

  if (-not $IsWindows) { throw 'The one-click launcher currently requires Windows' }
  if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable' }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is required' }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm 10 is required' }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 is required' }

  $nodeVersion = (& node --version).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') {
    throw "Node.js 22 is required; detected '$nodeVersion'"
  }

  if (Test-PreviewReady -Port $PreferredAppPort) {
    $existingUrl = "http://127.0.0.1:$PreferredAppPort/"
    Write-Output "南京安心宠已经运行：$existingUrl"
    if (-not $NoBrowser) { Start-Process $existingUrl }
    return
  }

  $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $applicationRoot = Assert-LocalStatePath `
    -Path (Join-Path $env:LOCALAPPDATA 'NanjingPetCare\runtime') `
    -LocalAppData $env:LOCALAPPDATA
  $statePath = Assert-LocalStatePath `
    -Path (Join-Path $env:LOCALAPPDATA 'NanjingPetCare\runtime\state.json') `
    -LocalAppData $env:LOCALAPPDATA
  $evidencePath = Assert-LocalStatePath `
    -Path (Join-Path $env:LOCALAPPDATA 'NanjingPetCare\runtime\evidence') `
    -LocalAppData $env:LOCALAPPDATA
  $containerName = 'nanjing-petcare-local-postgres'
  $volumeName = 'nanjing-petcare-local-postgres-data'
  $containerExists = $false

  docker inspect $containerName *> $null
  if ($LASTEXITCODE -eq 0) { $containerExists = $true }

  if (-not (Test-Path -LiteralPath $statePath)) {
    if ($containerExists) {
      throw 'The local database container exists but its protected state is missing; nothing was changed'
    }
    New-Item -ItemType Directory -Path $applicationRoot -Force | Out-Null
    $databasePort = Get-FirstAvailablePort -StartPort 55432 -EndPort 55499 -Probe {
      param($candidate)
      Test-LoopbackPort -Port $candidate
    }
    $state = [ordered]@{
      formatVersion = 1
      databasePort = $databasePort
      databasePassword = New-ProtectedSecret -ByteCount 24
      fieldEncryptionKey = New-ProtectedSecret -ByteCount 32
      authPepper = New-ProtectedSecret -ByteCount 32
    }
    [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  }

  try {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
  } catch {
    throw 'The protected local runtime state is unreadable; nothing was changed'
  }
  $parsedDatabasePort = 0
  if ($state.formatVersion -ne 1 `
    -or -not [int]::TryParse([string]$state.databasePort, [ref]$parsedDatabasePort) `
    -or $parsedDatabasePort -lt 1 `
    -or $parsedDatabasePort -gt 65535 `
    -or -not $state.databasePassword `
    -or -not $state.fieldEncryptionKey `
    -or -not $state.authPepper) {
    throw 'The protected local runtime state has an unsupported format; nothing was changed'
  }

  $databasePassword = Unprotect-LocalSecret $state.databasePassword
  $fieldEncryptionKey = Unprotect-LocalSecret $state.fieldEncryptionKey
  $authPepper = Unprotect-LocalSecret $state.authPepper
  $databasePort = $parsedDatabasePort

  if (-not $containerExists) {
    Invoke-CheckedCommand docker @(
      'run', '--detach', '--name', $containerName,
      '--publish', "127.0.0.1:${databasePort}:5432",
      '--env', 'POSTGRES_USER=petcare',
      '--env', "POSTGRES_PASSWORD=$databasePassword",
      '--env', 'POSTGRES_DB=petcare',
      '--volume', "${volumeName}:/var/lib/postgresql/data",
      'postgres:16-alpine'
    )
    $containerExists = $true
  } else {
    $image = (& docker inspect --format '{{.Config.Image}}' $containerName).Trim()
    $binding = (& docker port $containerName '5432/tcp').Trim()
    if ($LASTEXITCODE -ne 0 `
      -or $image -ne 'postgres:16-alpine' `
      -or $binding -ne "127.0.0.1:$databasePort") {
      throw 'The existing local database container does not match the protected runtime state'
    }
    $running = (& docker inspect --format '{{.State.Running}}' $containerName).Trim()
    if ($running -ne 'true') { Invoke-CheckedCommand docker @('start', $containerName) }
  }

  $databaseReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    docker exec $containerName pg_isready --username petcare --dbname petcare *> $null
    if ($LASTEXITCODE -eq 0) {
      $serverVersion = (& docker exec $containerName psql --username petcare --dbname petcare `
        --tuples-only --no-align --command 'SHOW server_version_num').Trim()
      if ($LASTEXITCODE -eq 0 -and $serverVersion.StartsWith('16')) {
        $databaseReady = $true
        break
      }
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $databaseReady) { throw 'PostgreSQL 16 did not become ready' }

  $appPort = Get-FirstAvailablePort `
    -StartPort $PreferredAppPort `
    -EndPort ($PreferredAppPort + 99) `
    -Probe { param($candidate) Test-LoopbackPort -Port $candidate }

  New-Item -ItemType Directory -Path $evidencePath -Force | Out-Null
  $escapedPassword = [Uri]::EscapeDataString($databasePassword)
  $env:NODE_ENV = 'development'
  $env:DATABASE_URL = "postgresql://petcare:$escapedPassword@127.0.0.1:$databasePort/petcare?schema=public"
  $env:FIELD_ENCRYPTION_KEY_V1 = $fieldEncryptionKey
  $env:PILOT_AUTH_PEPPER = $authPepper
  $env:PILOT_MODE = 'enabled'
  $env:PILOT_HOST = '127.0.0.1'
  $env:PILOT_PORT = [string]$appPort
  $env:PILOT_EVIDENCE_DIR = $evidencePath

  Push-Location $repositoryRoot
  try {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot 'node_modules'))) {
      Invoke-CheckedCommand pnpm @('install', '--frozen-lockfile')
    }
    Invoke-CheckedCommand pnpm @('exec', 'prisma', 'generate')
    Invoke-CheckedCommand pnpm @('exec', 'prisma', 'migrate', 'deploy')
    Invoke-CheckedCommand pnpm @('pilot:build')

    Write-Output ''
    Write-Output "南京安心宠正在启动：http://127.0.0.1:$appPort/"
    Write-Output '使用期间请保持此窗口开启；按 Ctrl+C 可停止服务。'
    Write-Output ''

    $server = Start-Process -FilePath 'pnpm.cmd' `
      -ArgumentList '--filter', '@pet/api', 'start:pilot' `
      -WorkingDirectory $repositoryRoot `
      -NoNewWindow `
      -PassThru
    try {
      $ready = $false
      for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($server.HasExited) { throw "The local server exited with code $($server.ExitCode)" }
        if (Test-PreviewReady -Port $appPort) {
          $ready = $true
          break
        }
        Start-Sleep -Milliseconds 250
      }
      if (-not $ready) { throw 'The local server did not become ready' }
      if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$appPort/" }
      $server.WaitForExit()
      if ($server.ExitCode -ne 0) { throw "The local server exited with code $($server.ExitCode)" }
    } finally {
      if ($null -ne $server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
      }
    }
  } finally {
    Pop-Location
    $databasePassword = $null
    $fieldEncryptionKey = $null
    $authPepper = $null
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Start-LocalPreview -NoBrowser:$NoBrowser -PreferredAppPort $PreferredAppPort
}
