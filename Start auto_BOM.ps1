param([switch]$NoBrowser)

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://localhost:4173"
$listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$isReady = $false

if ($listener) {
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -Uri "$appUrl/api/status" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) { $isReady = $true; break }
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }

  if (-not $isReady) {
    throw "Port 4173 is already in use by another program. Close that program and start auto_BOM again."
  }
}

if (-not $isReady) {
  $node = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1

  if (-not $node) {
    $node = Join-Path $env:ProgramFiles "nodejs\node.exe"
  }

  if (-not (Test-Path -LiteralPath $node)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("auto_BOM needs Node.js LTS. Install it from nodejs.org, then try again.", "auto_BOM") | Out-Null
    exit 1
  }

  Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $projectDirectory -WindowStyle Hidden

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri "$appUrl/api/status" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) { break }
    } catch {
      if ($attempt -eq 39) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("auto_BOM could not start. Make sure Node.js is installed.", "auto_BOM") | Out-Null
        exit 1
      }
    }
  }
}

if (-not $NoBrowser) { Start-Process $appUrl }
