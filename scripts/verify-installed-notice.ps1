param(
  [string]$InstallerPath,
  [string]$ExpectedNoticePath,
  [string]$InstallDirectory,
  [switch]$Library
)

$ErrorActionPreference = 'Stop'

function Get-VeilSendUninstallEntries {
  @(
    Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
      Where-Object { $_.DisplayName -like 'VeilSend*' }
  )
}

function Test-UninstallEntryTargetsDirectory {
  param([object]$Entry, [string]$InstallDirectory)
  $target = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  foreach ($candidate in @($Entry.InstallLocation, $Entry.UninstallString)) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate)) { continue }
    $raw = ([string]$candidate).Trim()
    $match = [regex]::Match($raw, '(?i)^\s*"?(?<path>[A-Za-z]:.*?\\uninstall\.exe)"?')
    $path = if ($match.Success) { $match.Groups['path'].Value } else { $raw.Trim('"') }
    if ($path -match '(?i)uninstall\.exe$') { $path = Split-Path -Parent $path }
    try { if ([IO.Path]::GetFullPath($path).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) -eq $target) { return $true } } catch { }
  }
  return $false
}

function Invoke-VeilSendNoticeVerification {
  param(
    [Parameter(Mandatory=$true)][string]$InstallerPath,
    [Parameter(Mandatory=$true)][string]$ExpectedNoticePath,
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [string]$StartMenuDirectory = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\VeilSend'),
    [hashtable]$Dependencies = @{}
  )
  $startProcess = if ($Dependencies.ContainsKey('StartProcess')) { $Dependencies.StartProcess } else { { param($file, $arguments) Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden } }
  $getEntries = if ($Dependencies.ContainsKey('GetUninstallEntries')) { $Dependencies.GetUninstallEntries } else { ${function:Get-VeilSendUninstallEntries} }
  $removeEntry = if ($Dependencies.ContainsKey('RemoveUninstallEntry')) { $Dependencies.RemoveUninstallEntry } else { { param($entry) Remove-Item -LiteralPath $entry.PSPath -Recurse -Force } }
  $installer = (Resolve-Path -LiteralPath $InstallerPath).Path
  $expectedNotice = (Resolve-Path -LiteralPath $ExpectedNoticePath).Path
  $installDirectory = [IO.Path]::GetFullPath($InstallDirectory)
  $startMenuDirectory = [IO.Path]::GetFullPath($StartMenuDirectory)
  $installParent = [IO.Path]::GetDirectoryName($installDirectory)
  if (-not (Test-Path -LiteralPath $installParent -PathType Container)) { throw "Install directory parent does not exist: $installParent" }
  if (Test-Path -LiteralPath $installDirectory) { throw "Refusing to use an existing install directory: $installDirectory" }
  if (Test-Path -LiteralPath $startMenuDirectory) { throw "Refusing to alter an existing VeilSend Start Menu directory: $startMenuDirectory" }
  $initialEntries = @(& $getEntries)
  if ($initialEntries.Count -ne 0) { throw 'Refusing to run while a VeilSend current-user uninstall entry already exists.' }
  $initialEntryPaths = @($initialEntries | ForEach-Object { [string]$_.PSPath })
  $failures = [Collections.Generic.List[string]]::new(); $installAttempted = $false; $uninstaller = $null
  try {
    $installAttempted = $true
    try { $result = & $startProcess $installer @('/S', "/D=$installDirectory"); if ($null -eq $result -or $result.ExitCode -ne 0) { throw "Installer failed with exit code $($result.ExitCode)" } } catch { $failures.Add("Installer: $($_.Exception.Message)") }
    if (-not (Test-Path -LiteralPath $installDirectory -PathType Container)) { $failures.Add("Installer did not create the requested directory: $installDirectory") }
    else {
      $uninstallers = @(Get-ChildItem -LiteralPath $installDirectory -Recurse -File -Filter 'uninstall.exe' -ErrorAction SilentlyContinue)
      if ($uninstallers.Count -eq 1) { $uninstaller = $uninstallers[0].FullName } else { $failures.Add("Expected exactly one installed uninstaller, found $($uninstallers.Count)") }
      $notices = @(Get-ChildItem -LiteralPath $installDirectory -Recurse -File -Filter 'THIRD_PARTY_LICENSES.md' -ErrorAction SilentlyContinue)
      if ($notices.Count -ne 1) { $failures.Add("Expected exactly one installed THIRD_PARTY_LICENSES.md, found $($notices.Count)") }
      else { $expectedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $expectedNotice).Hash; $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $notices[0].FullName).Hash; if ($expectedHash -ne $actualHash) { $failures.Add("Installed notice SHA-256 mismatch: expected $expectedHash, got $actualHash") } elseif (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals([IO.File]::ReadAllBytes($expectedNotice), [IO.File]::ReadAllBytes($notices[0].FullName))) { $failures.Add('Installed notice bytes differ despite matching SHA-256.') } else { Write-Output "Verified installed notice: $($notices[0].FullName)" } }
    }
  } finally {
    if ($installAttempted -and $null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { try { $result = & $startProcess $uninstaller @('/S', "_?=$installDirectory"); if ($null -eq $result -or $result.ExitCode -ne 0) { throw "Uninstaller failed with exit code $($result.ExitCode)" } } catch { $failures.Add("Uninstaller: $($_.Exception.Message)") } }
    foreach ($directory in @($installDirectory, $startMenuDirectory)) { try { if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force } } catch { $failures.Add("Cleanup directory ${directory}: $($_.Exception.Message)") } }
    try { $newEntries = @(& $getEntries | Where-Object { $initialEntryPaths -notcontains [string]$_.PSPath }); foreach ($entry in $newEntries) { if (Test-UninstallEntryTargetsDirectory -Entry $entry -InstallDirectory $installDirectory) { try { & $removeEntry $entry } catch { $failures.Add("Cleanup uninstall entry $($entry.PSPath): $($_.Exception.Message)") } } else { $failures.Add("Unexpected new VeilSend uninstall entry was not removed: $($entry.PSPath)") } }; $remaining = @(& $getEntries | Where-Object { $initialEntryPaths -notcontains [string]$_.PSPath }); if ($remaining.Count -ne 0) { $failures.Add('VeilSend current-user uninstall entry remained after cleanup.') } } catch { $failures.Add("Cleanup uninstall registry: $($_.Exception.Message)") }
  }
  if ($failures.Count -ne 0) { throw ($failures -join [Environment]::NewLine) }
}

if (-not $Library) { Invoke-VeilSendNoticeVerification -InstallerPath $InstallerPath -ExpectedNoticePath $ExpectedNoticePath -InstallDirectory $InstallDirectory }
