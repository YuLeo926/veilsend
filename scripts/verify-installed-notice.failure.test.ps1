$ErrorActionPreference = 'Stop'

# This test intentionally dot-sources the production verifier and exercises its
# injectable process/registry boundary.  Before the cleanup refactor the script
# cannot be loaded as a library and this test fails.
. (Join-Path $PSScriptRoot 'verify-installed-notice.ps1') -Library

if (-not (Get-Command Invoke-VeilSendNoticeVerification -ErrorAction SilentlyContinue)) {
  throw 'Invoke-VeilSendNoticeVerification was not exported by the verifier.'
}

function Invoke-FailureCase([string]$uninstallMode) {
  $root = Join-Path ([IO.Path]::GetTempPath()) ("veilsend-verifier-test-" + [guid]::NewGuid())
  $install = Join-Path $root 'install'
  $startMenu = Join-Path $root 'start-menu'
  New-Item -ItemType Directory -Path $root | Out-Null
  $installer = Join-Path $root 'installer.exe'; $expected = Join-Path $root 'expected.md'
  [IO.File]::WriteAllText($installer, 'stub'); [IO.File]::WriteAllText($expected, 'expected')
  $entries = [Collections.Generic.List[object]]::new()
  $removed = [Collections.Generic.List[string]]::new()
  $deps = @{
    StartProcess = {
      param($file, $arguments)
      if ($file -eq $installer) {
        New-Item -ItemType Directory -Path $install -Force | Out-Null
        New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
        [IO.File]::WriteAllText((Join-Path $install 'THIRD_PARTY_LICENSES.md'), 'wrong')
        [IO.File]::WriteAllText((Join-Path $install 'uninstall.exe'), 'stub')
        $entries.Add([pscustomobject]@{ PSPath = 'generated'; DisplayName = 'VeilSend'; InstallLocation = $install; UninstallString = (Join-Path $install 'uninstall.exe') })
        $entries.Add([pscustomobject]@{ PSPath = 'unrelated'; DisplayName = 'VeilSend other'; InstallLocation = (Join-Path $root 'other'); UninstallString = (Join-Path $root 'other\uninstall.exe') })
        return [pscustomobject]@{ ExitCode = 0 }
      }
      if ($uninstallMode -eq 'throw') { throw 'stub uninstaller launch failure' }
      return [pscustomobject]@{ ExitCode = 9 }
    }
    GetUninstallEntries = { @($entries) }
    RemoveUninstallEntry = { param($entry) $removed.Add($entry.PSPath); [void]$entries.Remove($entry) }
  }
  try {
    $threw = $false
    try { Invoke-VeilSendNoticeVerification -InstallerPath $installer -ExpectedNoticePath $expected -InstallDirectory $install -StartMenuDirectory $startMenu -Dependencies $deps } catch { $threw = $true; if ($_.Exception.Message -notmatch 'SHA-256 mismatch') { throw } }
    if (-not $threw) { throw 'Expected notice mismatch to fail verification.' }
    if (Test-Path -LiteralPath $install) { throw 'Install directory was not cleaned after failure.' }
    if (Test-Path -LiteralPath $startMenu) { throw 'Start Menu directory was not cleaned after failure.' }
    if ($removed -notcontains 'generated') { throw 'Generated uninstall entry was not cleaned.' }
    if ($removed -contains 'unrelated' -or @($entries | Where-Object PSPath -eq 'unrelated').Count -ne 1) { throw 'An unrelated new entry was touched.' }
  } finally { if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force } }
}

Invoke-FailureCase 'nonzero'
Invoke-FailureCase 'throw'
Write-Output 'Failure-path verifier cleanup tests passed.'
