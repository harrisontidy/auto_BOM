param(
  [string]$Project,
  [string]$KiCadSource = (Join-Path $env:USERPROFILE "source\auto-bom-kicad")
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildDirectory = Join-Path $KiCadSource "build\auto-bom-release"
$kicad = Join-Path $buildDirectory "kicad\kicad.exe"
$buildScript = Join-Path $projectDirectory "integrations\kicad-native\Build custom KiCad.ps1"
$ucrtRuntime = "C:\msys64\ucrt64\bin"

function Show-LauncherError {
  param([string]$Message)

  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, "Auto BOM for KiCad") | Out-Null
  } catch {
    [Console]::Error.WriteLine($Message)
  }
}

$requiredRelativeFiles = @(
  "kicad\kicad.exe",
  "eeschema\eeschema.exe",
  "eeschema\_eeschema.dll",
  "pcbnew\pcbnew.exe",
  "pcbnew\_pcbnew.dll",
  "cvpcb\_cvpcb.dll",
  "gerbview\gerbview.exe",
  "gerbview\_gerbview.dll",
  "bitmap2component\bitmap2component.exe",
  "pcb_calculator\pcb_calculator.exe",
  "pcb_calculator\_pcb_calculator.dll",
  "pagelayout_editor\pl_editor.exe",
  "pagelayout_editor\_pl_editor.dll",
  "resources\images.tar.gz",
  "schemas\api.v1.schema.json",
  "schemas\pcm.v1.schema.json",
  "schemas\pcm.v2.schema.json"
)
$missingBuildFiles = @($requiredRelativeFiles | Where-Object {
  -not (Test-Path -LiteralPath (Join-Path $buildDirectory $_))
})

if ($missingBuildFiles.Count -gt 0) {
  $missingList = ($missingBuildFiles | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
  Show-LauncherError (
    "The integrated KiCad build is incomplete." + [Environment]::NewLine +
    [Environment]::NewLine + "Missing:" + [Environment]::NewLine + $missingList +
    [Environment]::NewLine + [Environment]::NewLine +
    "Close KiCad, then run:" + [Environment]::NewLine + $buildScript
  )
  exit 1
}

if (-not (Test-Path -LiteralPath $ucrtRuntime)) {
  Show-LauncherError (
    "The MSYS2 UCRT64 runtime was not found at $ucrtRuntime." + [Environment]::NewLine +
    "Install the build prerequisites described in integrations\kicad-native\README.md."
  )
  exit 1
}

$stockDataCandidates = @()
if ($env:LOCALAPPDATA) {
  $stockDataCandidates += Join-Path $env:LOCALAPPDATA "Programs\KiCad\10.0\share\kicad"
}
if ($env:ProgramFiles) {
  $stockDataCandidates += Join-Path $env:ProgramFiles "KiCad\10.0\share\kicad"
}
$stockData = $stockDataCandidates | Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1

if (-not $stockData) {
  Show-LauncherError (
    "KiCad 10 library data was not found. Install the official KiCad 10 symbol, footprint, " +
    "and 3D model libraries, then launch Auto BOM for KiCad again."
  )
  exit 1
}

$missingLibraryFolders = @("symbols", "footprints", "3dmodels") | Where-Object {
  -not (Test-Path -LiteralPath (Join-Path $stockData $_))
}

if ($missingLibraryFolders) {
  Show-LauncherError (
    "The KiCad 10 library installation is missing: $($missingLibraryFolders -join ', '). " +
    "Install those libraries before using component placement."
  )
  exit 1
}

# The local service resolves symbols, footprints, and 3D models from these paths,
# so set them before the service process is created.
$env:KICAD_STOCK_DATA_HOME = $stockData
$env:KICAD10_SYMBOL_DIR = Join-Path $stockData "symbols"
$env:KICAD10_FOOTPRINT_DIR = Join-Path $stockData "footprints"
$env:KICAD10_3DMODEL_DIR = Join-Path $stockData "3dmodels"
$env:KICAD10_TEMPLATE_DIR = Join-Path $stockData "template"

$conflictingProcesses = @(Get-Process -Name kicad, eeschema, pcbnew -ErrorAction SilentlyContinue |
  Where-Object {
    try {
      $_.Path -and -not $_.Path.StartsWith(
        $buildDirectory,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      $false
    }
  })

if ($conflictingProcesses.Count -gt 0) {
  $processNames = ($conflictingProcesses.ProcessName | Sort-Object -Unique) -join ", "
  Show-LauncherError (
    "A regular KiCad process is already open ($processNames). Close it first, then use this " +
    "launcher so KiCad loads the integrated Component Finder."
  )
  exit 1
}

try {
  & (Join-Path $projectDirectory "Start auto_BOM.ps1") -NoBrowser
} catch {
  # Start auto_BOM.ps1 already displays a useful desktop error.
  exit 1
}

$env:KICAD_RUN_FROM_BUILD_DIR = "1"
$runtimePaths = @(
  $ucrtRuntime,
  (Join-Path $buildDirectory "kicad"),
  (Join-Path $buildDirectory "common"),
  (Join-Path $buildDirectory "api"),
  (Join-Path $buildDirectory "common\gal"),
  (Join-Path $buildDirectory "3d-viewer"),
  (Join-Path $buildDirectory "3d-viewer\3d_cache"),
  (Join-Path $buildDirectory "3d-viewer\3d_cache\sg"),
  (Join-Path $buildDirectory "eeschema"),
  (Join-Path $buildDirectory "pcbnew"),
  (Join-Path $buildDirectory "gerbview"),
  (Join-Path $buildDirectory "bitmap2component"),
  (Join-Path $buildDirectory "pcb_calculator"),
  (Join-Path $buildDirectory "pagelayout_editor"),
  (Join-Path $buildDirectory "cvpcb")
)
$env:PATH = ($runtimePaths -join ";") + ";$env:PATH"

$launchOptions = @{ FilePath = $kicad; WorkingDirectory = $buildDirectory; PassThru = $true }
if ($Project) {
  if (-not (Test-Path -LiteralPath $Project)) {
    Show-LauncherError "The KiCad project does not exist: $Project"
    exit 1
  }

  $launchOptions.ArgumentList = @("`"$((Resolve-Path -LiteralPath $Project).Path)`"")
}

try {
  $process = Start-Process @launchOptions
} catch {
  Show-LauncherError "The integrated KiCad application could not start: $($_.Exception.Message)"
  exit 1
}

Start-Sleep -Seconds 2
if ($process.HasExited -and $process.ExitCode -ne 0) {
  Show-LauncherError "The integrated KiCad application could not start (exit code $($process.ExitCode))."
  exit $process.ExitCode
}
