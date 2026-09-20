param([ValidateSet('protect','unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputData = [Console]::In.ReadToEnd()
if ($Mode -eq 'protect') {
    $bytes = [Text.Encoding]::UTF8.GetBytes($inputData)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Write([Convert]::ToBase64String($protected))
} else {
    $bytes = [Convert]::FromBase64String($inputData)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Write([Text.Encoding]::UTF8.GetString($plain))
}
