param([string]$Python)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Python) { $Python = Join-Path $env:LOCALAPPDATA 'Programs/KiCad/10.0/bin/python.exe' }
if (-not (Test-Path -LiteralPath $Python)) { throw 'Supply -Python with a Python 3.10+ executable path.' }
$runtimeDirectory = Join-Path $projectDirectory '.runtime/easyeda'
& $Python -m venv $runtimeDirectory
if ($LASTEXITCODE) { throw 'Could not create the EasyEDA environment.' }
& (Join-Path $runtimeDirectory 'Scripts/python.exe') -m pip install -r (Join-Path $projectDirectory 'requirements-easyeda.txt')
if ($LASTEXITCODE) { throw 'Could not install the EasyEDA converter.' }
