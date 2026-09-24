param([Parameter(Mandatory=$true)][string]$ArchivePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
    if ($archive.Entries.Count -gt 100) { throw 'Too many files in CAD archive' }
    $result = @()
    $total = 0
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '\.(kicad_sym|kicad_mod)$|(^|/)License\.txt$') { continue }
        $total += $entry.Length
        if ($total -gt 10000000) { throw 'CAD archive exceeds size limit' }
        # Read data only. Never extract or execute archive paths.
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $result += @{ name = $entry.FullName; text = $reader.ReadToEnd() } }
        finally { $reader.Dispose() }
    }
    ConvertTo-Json -InputObject @($result) -Compress
} finally { $archive.Dispose() }
