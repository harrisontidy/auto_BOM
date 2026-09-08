param([switch]$NoBrowser)

$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://localhost:4173"
$listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $listener) {
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $projectDirectory -WindowStyle Hidden

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri "$appUrl/api/status" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) { break }
    } catch {
      if ($attempt -eq 19) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("auto_BOM could not start. Make sure Node.js is installed.", "auto_BOM") | Out-Null
        exit 1
      }
    }
  }
}

if (-not $NoBrowser) { Start-Process $appUrl }
