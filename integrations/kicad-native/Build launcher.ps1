param([string]$OutputPath)

$ErrorActionPreference = "Stop"
$rootDirectory = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
  throw "The .NET Framework C# compiler was not found at $compiler."
}
$launcherOutput = if ($OutputPath) { [System.IO.Path]::GetFullPath($OutputPath) } else { Join-Path $rootDirectory 'KiCad-AutoBOM-Launcher.exe' }
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll "/out:$launcherOutput" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
Write-Host "Built $launcherOutput"
