param(
  [string]$KiCadSource = (Join-Path $env:USERPROFILE "source\auto-bom-kicad"),
  [int]$ParallelJobs = 8
)

$ErrorActionPreference = "Stop"
$bash = "C:\msys64\usr\bin\bash.exe"

if (-not (Test-Path -LiteralPath $bash)) {
  throw "MSYS2 was not found at $bash. See integrations/kicad-native/README.md."
}

if (-not (Test-Path -LiteralPath (Join-Path $KiCadSource "CMakeLists.txt"))) {
  throw "KiCad source was not found at $KiCadSource. See integrations/kicad-native/README.md."
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

  & $bash -lc "cmake --build build/auto-bom-release --target eeschema pcbnew bitmap_archive_build api_schema_build_copy remote_provider_schema_build_copy --parallel $ParallelJobs"

  if ($LASTEXITCODE -ne 0) { throw "KiCad build failed." }
} finally {
  Pop-Location
}

Write-Host "Custom Eeschema build is ready." -ForegroundColor Green
