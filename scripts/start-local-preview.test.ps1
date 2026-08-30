$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'start-local-preview.ps1')

$script:passed = 0

function Assert-Equal {
  param([object]$Actual, [object]$Expected, [string]$Name)
  if ($Actual -ne $Expected) {
    throw "$Name failed: expected '$Expected', received '$Actual'"
  }
  $script:passed++
}

function Assert-Throws {
  param([scriptblock]$Action, [string]$ExpectedMessage, [string]$Name)
  try {
    & $Action
  } catch {
    if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
      throw "$Name failed: expected error containing '$ExpectedMessage', received '$($_.Exception.Message)'"
    }
    $script:passed++
    return
  }
  throw "$Name failed: expected an exception"
}

$preferred = Get-FirstAvailablePort -StartPort 51800 -EndPort 51802 -Probe {
  param($port)
  return $port -eq 51800
}
Assert-Equal $preferred 51800 'preferred port'

$fallback = Get-FirstAvailablePort -StartPort 51800 -EndPort 51802 -Probe {
  param($port)
  return $port -eq 51802
}
Assert-Equal $fallback 51802 'fallback port'

Assert-Throws {
  Get-FirstAvailablePort -StartPort 51800 -EndPort 51801 -Probe { return $false }
} 'No loopback port is available' 'port exhaustion'

$localAppData = 'C:\Users\Example\AppData\Local'
$accepted = Assert-LocalStatePath `
  -Path 'C:\Users\Example\AppData\Local\NanjingPetCare\state.json' `
  -LocalAppData $localAppData
Assert-Equal $accepted 'C:\Users\Example\AppData\Local\NanjingPetCare\state.json' 'state path allowlist'

Assert-Throws {
  Assert-LocalStatePath `
    -Path 'C:\Users\Example\AppData\Local\NanjingPetCare-Evil\state.json' `
    -LocalAppData $localAppData
} 'outside the local application directory' 'state path sibling rejection'

Write-Output "$script:passed launcher helper tests passed"
