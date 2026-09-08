param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:4173"
$listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$isReady = $false
$expectedProtocolVersion = 2

function Stop-AutoBom {
  param([string]$Message)

  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, "auto_BOM") | Out-Null
  } catch {
    [Console]::Error.WriteLine($Message)
  }

  throw $Message
}

function Get-AutoBomStatus {
  try {
    return Invoke-RestMethod -Uri "$appUrl/api/status" -TimeoutSec 1
  } catch {
    return $null
  }
}

function Test-AutoBomStatus {
  param($Status, [int]$ExpectedProcessId = 0)

  if (-not $Status -or $Status.service -ne "auto-bom" -or
      [int]$Status.protocolVersion -ne $expectedProtocolVersion) {
    return $false
  }

  if ($ExpectedProcessId -and [int]$Status.processId -ne $ExpectedProcessId) {
    return $false
  }

  try {
    $statusRoot = [System.IO.Path]::GetFullPath([string]$Status.projectRoot).TrimEnd('\')
    $expectedRoot = [System.IO.Path]::GetFullPath($projectDirectory).TrimEnd('\')
    if (-not $statusRoot.Equals($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }

    $startedAt = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Status.serverStartedAt).UtcDateTime
    $sourceFiles = @(
      Get-Item -LiteralPath (Join-Path $projectDirectory "server.js")
      Get-Item -LiteralPath (Join-Path $projectDirectory "config.js")
      Get-Item -LiteralPath (Join-Path $projectDirectory "parser.js")
      Get-ChildItem -LiteralPath (Join-Path $projectDirectory "services") -Filter "*.js" -File
    )
    if (($sourceFiles | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum -gt $startedAt) {
      return $false
    }

    if ($env:KICAD_STOCK_DATA_HOME -and
        -not ([string]$Status.kicadStockDataHome).Equals(
          $env:KICAD_STOCK_DATA_HOME,
          [System.StringComparison]::OrdinalIgnoreCase
        )) {
      return $false
    }
  } catch {
    return $false
  }

  return $true
}

if ($listener) {
  $status = $null
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    $status = Get-AutoBomStatus
    if (Test-AutoBomStatus $status $listener.OwningProcess) { $isReady = $true; break }
    Start-Sleep -Milliseconds 200
  }

  if (-not $isReady) {
    $expectedServerPath = Join-Path $projectDirectory "server.js"
    $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $legacyProjectServer = $listenerProcess -and $listenerProcess.Name -ieq "node.exe" -and
      $listenerProcess.CommandLine -and
      $listenerProcess.CommandLine.IndexOf(
        $expectedServerPath,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -ge 0
    $sameProjectServer = $status -and $status.service -eq "auto-bom" -and
      [int]$status.processId -eq $listener.OwningProcess -and
      ([System.IO.Path]::GetFullPath([string]$status.projectRoot).TrimEnd('\')).Equals(
        [System.IO.Path]::GetFullPath($projectDirectory).TrimEnd('\'),
        [System.StringComparison]::OrdinalIgnoreCase
      )

    if ($sameProjectServer -or $legacyProjectServer) {
      Stop-Process -Id $listener.OwningProcess -Force
      Start-Sleep -Milliseconds 300
      $listener = $null
    } else {
      Stop-AutoBom "Port 4173 is already in use by another program. Close that program and start auto_BOM again."
    }
  }
}

if (-not $isReady) {
  $nodeCandidates = @()
  if ($env:ProgramFiles) {
    $nodeCandidates += Join-Path $env:ProgramFiles "nodejs\node.exe"
  }
  $pathNode = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
  if ($pathNode) { $nodeCandidates += $pathNode }
  $node = $nodeCandidates | Select-Object -Unique |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

  if (-not $node) {
    Stop-AutoBom "auto_BOM needs Node.js LTS. Install it from nodejs.org, then try again."
  }

  $logDirectory = Join-Path $env:LOCALAPPDATA "auto_BOM\logs"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $serverProcess = Start-Process -FilePath $node `
    -ArgumentList @("`"$(Join-Path $projectDirectory 'server.js')`"") `
    -WorkingDirectory $projectDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory "server.log") `
    -RedirectStandardError (Join-Path $logDirectory "server-error.log") `
    -PassThru

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 250

    if (Test-AutoBomStatus (Get-AutoBomStatus) $serverProcess.Id) {
      $isReady = $true
      break
    }

    if ($serverProcess.HasExited) { break }
  }

  if (-not $isReady) {
    if ($serverProcess.HasExited) {
      Stop-AutoBom (
        "auto_BOM stopped before it became ready (exit code $($serverProcess.ExitCode)). " +
        "Check the .env file in $projectDirectory."
      )
    }

    Stop-AutoBom "auto_BOM did not become ready within 10 seconds. Check Node.js and the .env file."
  }
}

if (-not $NoBrowser) { Start-Process $appUrl }
