$ErrorActionPreference = 'Stop'

# This test intentionally dot-sources the production verifier and exercises its
# injectable process/registry boundary.  Before the cleanup refactor the script
# cannot be loaded as a library and this test fails.
. (Join-Path $PSScriptRoot 'verify-installed-notice.ps1') -Library

if (-not (Get-Command Invoke-VeilSendNoticeVerification -ErrorAction SilentlyContinue)) {
  throw 'Invoke-VeilSendNoticeVerification was not exported by the verifier.'
}

function Test-UninstallCommandParsing {
  $install = 'C:\Temp\veil-test'
  foreach ($command in @(
    'C:\Temp\veil-test\uninstall.exe /S',
    '"C:\Temp\veil-test\uninstall.exe" /S',
    'C:\Temp\veil-test\subdir\..\uninstall.exe /S',
    '"C:\Temp\veil-test\subdir\..\uninstall.exe" /S /D=C:\Temp'
  )) {
    if (-not (Test-UninstallEntryTargetsDirectory -Entry ([pscustomobject]@{ InstallLocation = $null; UninstallString = $command }) -InstallDirectory $install)) { throw "Rejected valid uninstall command: $command" }
  }
  foreach ($command in @(
    'C:\Temp\veil-test\uninstall.exe.evil',
    '"C:\Temp\veil-test\uninstall.exe.evil" /S',
    'C:\Temp\veil-test-evil\uninstall.exe /S',
    '"C:\Temp\veil-test-evil\uninstall.exe" /S',
    'C:\Temp\veil-test\..\veil-test-evil\uninstall.exe /S',
    '"C:\Temp\veil-test\..\veil-test-evil\uninstall.exe" /S',
    'prefix C:\Temp\veil-test\uninstall.exe',
    '"C:\Temp\veil-test\uninstall.exe /S'
  )) {
    if (Test-UninstallEntryTargetsDirectory -Entry ([pscustomobject]@{ InstallLocation = $null; UninstallString = $command }) -InstallDirectory $install) { throw "Accepted unsafe uninstall command: $command" }
  }
}

Test-UninstallCommandParsing

function Invoke-FailureCase([string]$mode) {
  $root = Join-Path ([IO.Path]::GetTempPath()) ("veilsend-verifier-test-" + [guid]::NewGuid())
  $install = Join-Path $root 'install'
  $startMenu = Join-Path $root 'start-menu'
  New-Item -ItemType Directory -Path $root | Out-Null
  $installer = Join-Path $root 'installer.exe'; $expected = Join-Path $root 'expected.md'
  [IO.File]::WriteAllText($installer, 'stub'); [IO.File]::WriteAllText($expected, 'expected')
  $entries = [Collections.Generic.List[object]]::new()
  $removed = [Collections.Generic.List[string]]::new()
  $script:productKey = $null
  $script:uninstallerCalls = 0
  $deps = @{
    StartProcess = {
      param($file, $arguments)
      if ($file -eq $installer) {
        New-Item -ItemType Directory -Path $install -Force | Out-Null
        New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $install 'THIRD_PARTY_LICENSES.md'), 'wrong')
        [IO.File]::WriteAllText((Join-Path $install 'uninstall.exe'), 'stub')
        # The generated uninstall key intentionally has no DisplayName: it models
        # NSIS failing between creating the key and writing Add/Remove metadata.
        $entries.Add([pscustomobject]@{ PSPath = 'generated-partial'; InstallLocation = $install; UninstallString = (Join-Path $install 'uninstall.exe') })
        $entries.Add([pscustomobject]@{ PSPath = 'unrelated'; InstallLocation = $null; UninstallString = ('"' + (Join-Path $install 'uninstall.exe.evil') + '" /S') })
        $script:productKey = [pscustomobject]@{ '(default)' = $install }
        return [pscustomobject]@{ ExitCode = $(if ($mode -eq 'installer-nonzero') { 17 } else { 0 }) }
      }
      $script:uninstallerCalls++
      if ($mode -eq 'throw') { throw 'stub uninstaller launch failure' }
      return [pscustomobject]@{ ExitCode = 9 }
    }
    GetUninstallEntries = { @($entries) }
    RemoveUninstallEntry = { param($entry) $removed.Add($entry.PSPath); [void]$entries.Remove($entry) }
    GetProductKey = { $script:productKey }
    RemoveProductKey = { $script:productKey = $null }
  }
  try {
    $threw = $false
    $message = ''
    try { Invoke-VeilSendNoticeVerification -InstallerPath $installer -ExpectedNoticePath $expected -InstallDirectory $install -StartMenuDirectory $startMenu -Dependencies $deps } catch { $threw = $true; $message = $_.Exception.Message }
    if (-not $threw) { throw 'Expected notice mismatch to fail verification.' }
    if ($message -notmatch 'SHA-256 mismatch') { throw "Expected aggregated notice error, got: $message" }
    if ($message -notmatch 'Unexpected new uninstall entry was not removed: unrelated') { throw 'Unsafe unrelated uninstall key was not reported as pollution.' }
    if ($mode -eq 'installer-nonzero' -and $message -notmatch 'Installer failed with exit code 17') { throw 'Installer partial failure was not reported.' }
    if ($mode -eq 'throw' -and $message -notmatch 'stub uninstaller launch failure') { throw 'Uninstaller launch failure was not reported.' }
    if ($mode -eq 'nonzero' -and $message -notmatch 'Uninstaller failed with exit code 9') { throw 'Uninstaller non-zero failure was not reported.' }
    if ($script:uninstallerCalls -ne 1) { throw "Expected exactly one uninstaller invocation, got $script:uninstallerCalls." }
    if (Test-Path -LiteralPath $install) { throw 'Install directory was not cleaned after failure.' }
    if (Test-Path -LiteralPath $startMenu) { throw 'Start Menu directory was not cleaned after failure.' }
    if ($removed -notcontains 'generated-partial') { throw 'Generated partial uninstall entry was not cleaned.' }
    if ($removed -contains 'unrelated' -or @($entries | Where-Object PSPath -eq 'unrelated').Count -ne 1) { throw 'An unrelated new entry was touched.' }
    if ($null -ne $script:productKey) { throw 'Generated product key was not cleaned.' }
  } finally { if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force } }
}

Invoke-FailureCase 'nonzero'
Invoke-FailureCase 'throw'
Invoke-FailureCase 'installer-nonzero'

function Test-ExistingProductKeyIsProtected {
  $root = Join-Path ([IO.Path]::GetTempPath()) ("veilsend-verifier-preflight-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $root | Out-Null
  $installer = Join-Path $root 'installer.exe'; $expected = Join-Path $root 'expected.md'; $install = Join-Path $root 'install'
  [IO.File]::WriteAllText($installer, 'stub'); [IO.File]::WriteAllText($expected, 'expected')
  $script:started = $false; $existing = [pscustomobject]@{ '(default)' = (Join-Path $root 'real-install') }
  try {
    try { Invoke-VeilSendNoticeVerification -InstallerPath $installer -ExpectedNoticePath $expected -InstallDirectory $install -StartMenuDirectory (Join-Path $root 'start-menu') -Dependencies @{ StartProcess = { $script:started = $true }; GetUninstallEntries = { @() }; GetProductKey = { $existing }; RemoveProductKey = { throw 'must not remove pre-existing key' } }; throw 'Expected product-key preflight rejection.' } catch { if ($_.Exception.Message -notmatch 'product key already exists') { throw } }
    if ($script:started) { throw 'Verifier launched an installer despite a pre-existing product key.' }
  } finally { if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force } }
}

Test-ExistingProductKeyIsProtected
Write-Output 'Failure-path verifier cleanup tests passed.'
