param(
  [string]$KiCadSource = (Join-Path $env:USERPROFILE "source\auto-bom-kicad"),
  [int]$ParallelJobs = 8
)

$ErrorActionPreference = "Stop"
$bash = "C:\msys64\usr\bin\bash.exe"
$ucrtCmake = "C:\msys64\ucrt64\bin\cmake.exe"
$buildDirectory = Join-Path $KiCadSource "build\auto-bom-release"

if ($ParallelJobs -lt 1) {
  throw "ParallelJobs must be at least 1."
}

if (-not (Test-Path -LiteralPath $bash)) {
  throw "MSYS2 was not found at $bash. See integrations/kicad-native/README.md."
}

if (-not (Test-Path -LiteralPath $ucrtCmake)) {
  throw "The MSYS2 UCRT64 toolchain was not found. Install the build prerequisites described in integrations/kicad-native/README.md."
}

if (-not (Test-Path -LiteralPath (Join-Path $KiCadSource "CMakeLists.txt"))) {
  throw "KiCad source was not found at $KiCadSource. See integrations/kicad-native/README.md."
}

$runningBuildApps = @(Get-Process -Name kicad, eeschema, pcbnew, gerbview, pl_editor, pcb_calculator -ErrorAction SilentlyContinue |
  Where-Object {
    try {
      $_.Path -and $_.Path.StartsWith(
        $buildDirectory,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      $false
    }
  })

if ($runningBuildApps.Count -gt 0) {
  $names = ($runningBuildApps.ProcessName | Sort-Object -Unique) -join ", "
  throw "Close the integrated KiCad application before rebuilding. These processes are using build files: $names."
}

$env:MSYSTEM = "UCRT64"
$env:CHERE_INVOKING = "1"

Push-Location $KiCadSource
try {
  if (-not (Test-Path -LiteralPath "build\auto-bom-release\build.ninja")) {
    & $bash -lc "cmake -S . -B build/auto-bom-release -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=/ucrt64 -DCMAKE_INSTALL_PREFIX=/ucrt64 -DDEFAULT_INSTALL_PATH=/ucrt64 -DOCC_INCLUDE_DIR=/ucrt64/include/opencascade -DKICAD_BUILD_I18N=OFF -DKICAD_SCRIPTING_WXPYTHON=OFF -DKICAD_WIN32_DPI_AWARE=ON"

    if ($LASTEXITCODE -ne 0) { throw "KiCad configuration failed." }
  }

  & $bash -lc "cmake -S . -B build/auto-bom-release -DKICAD_WIN32_DPI_AWARE=ON"

  if ($LASTEXITCODE -ne 0) { throw "KiCad DPI configuration failed." }

  & $bash -lc "cmake --build build/auto-bom-release --target kicad eeschema pcbnew cvpcb_kiface gerbview bitmap2component pcb_calculator pl_editor bitmap_archive_build api_schema_build_copy remote_provider_schema_build_copy schema_build_copy --parallel $ParallelJobs"

  if ($LASTEXITCODE -ne 0) { throw "KiCad build failed." }
} finally {
  Pop-Location
}

$requiredOutputs = @(
  "kicad\kicad.exe",
  "eeschema\eeschema.exe",
  "eeschema\_eeschema.dll",
  "pcbnew\pcbnew.exe",
  "pcbnew\_pcbnew.dll",
  "cvpcb\_cvpcb.dll",
  "resources\images.tar.gz",
  "schemas\api.v1.schema.json",
  "schemas\pcm.v1.schema.json",
  "schemas\pcm.v2.schema.json"
)
$missingOutputs = @($requiredOutputs | Where-Object {
  -not (Test-Path -LiteralPath (Join-Path $buildDirectory $_))
})

if ($missingOutputs.Count -gt 0) {
  throw "The build command finished, but required runtime files are missing: $($missingOutputs -join ', ')."
}

Write-Host "Custom KiCad build is ready." -ForegroundColor Green
