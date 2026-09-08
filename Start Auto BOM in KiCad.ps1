param(
  [string]$Schematic,
  [string]$KiCadSource = (Join-Path $env:USERPROFILE "source\auto-bom-kicad")
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildDirectory = Join-Path $KiCadSource "build\auto-bom-release"
$eeschema = Join-Path $buildDirectory "eeschema\eeschema.exe"
$stockData = Join-Path $env:LOCALAPPDATA "Programs\KiCad\10.0\share\kicad"

$requiredFiles = @(
  $eeschema,
  (Join-Path $buildDirectory "pcbnew\pcbnew.exe"),
  (Join-Path $buildDirectory "pcbnew\_pcbnew.dll"),
  (Join-Path $buildDirectory "resources\images.tar.gz"),
  (Join-Path $buildDirectory "schemas\api.v1.schema.json")
)

$missing = $requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_) }

if ($missing) {
  throw "The custom KiCad build is incomplete. Run integrations\kicad-native\Build custom KiCad.ps1 first."
}

& (Join-Path $projectDirectory "Start auto_BOM.ps1") -NoBrowser

$env:KICAD_RUN_FROM_BUILD_DIR = "1"
$env:KICAD_STOCK_DATA_HOME = $stockData
$env:KICAD10_SYMBOL_DIR = Join-Path $stockData "symbols"
$env:KICAD10_FOOTPRINT_DIR = Join-Path $stockData "footprints"
$env:KICAD10_3DMODEL_DIR = Join-Path $stockData "3dmodels"
$env:KICAD10_TEMPLATE_DIR = Join-Path $stockData "template"
$runtimePaths = @(
  "C:\msys64\ucrt64\bin",
  (Join-Path $buildDirectory "common"),
  (Join-Path $buildDirectory "api"),
  (Join-Path $buildDirectory "common\gal"),
  (Join-Path $buildDirectory "3d-viewer"),
  (Join-Path $buildDirectory "3d-viewer\3d_cache"),
  (Join-Path $buildDirectory "3d-viewer\3d_cache\sg"),
  (Join-Path $buildDirectory "eeschema"),
  (Join-Path $buildDirectory "pcbnew")
)
$env:PATH = ($runtimePaths -join ";") + ";$env:PATH"

$arguments = @()

if ($Schematic) {
  $resolvedSchematic = (Resolve-Path -LiteralPath $Schematic).Path
  $arguments += "`"$resolvedSchematic`""
}

Start-Process -FilePath $eeschema -ArgumentList $arguments -WorkingDirectory $buildDirectory
