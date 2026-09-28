# Read-only helper. Paths are for local use; do not paste them into public issues.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host 'VeilSend installation lookup (read-only). No files or settings will be changed.'
Write-Host 'Results may contain your Windows username. Keep them on this computer.'

$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$found = $false
foreach ($registryRoot in $uninstallRoots) {
  if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
  foreach ($entry in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) {
    $record = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $record) { continue }
    $displayName = $record.PSObject.Properties['DisplayName']
    if ($null -eq $displayName -or $displayName.Value -cne 'VeilSend') { continue }
    $found = $true
    Write-Host 'Windows has an installed-app entry for VeilSend:'
    foreach ($field in @('DisplayVersion', 'InstallLocation', 'UninstallString')) {
      $value = $record.PSObject.Properties[$field]
      if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value.Value)) {
        Write-Host ('  {0}: {1}' -f $field, $value.Value)
      }
    }
  }
}

foreach ($process in @(Get-Process -Name 'veilsend' -ErrorAction SilentlyContinue)) {
  try {
    if (-not [string]::IsNullOrWhiteSpace($process.Path)) {
      $found = $true
      Write-Host ('Running executable (may be a portable or development copy): {0}' -f $process.Path)
    }
  } catch {
    Write-Host 'A VeilSend process exists but its path is not readable. No elevation was attempted.'
  }
}

if (-not $found) {
  Write-Host 'No matching installed-app entry or readable running process was found.'
  Write-Host 'This does not prove the app is absent. Check the Start menu shortcut Properties > Target.'
}
Write-Host 'To uninstall an installed copy, use Windows Settings > Apps, or Win+R > appwiz.cpl.'
Write-Host 'Do not execute a copied registry command blindly or delete a guessed program folder.'
