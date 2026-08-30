param(
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ExpectedNoticePath,
  [Parameter(Mandatory=$true)][string]$InstallDirectory
)

$ErrorActionPreference = 'Stop'

function Get-VeilSendUninstallEntries {
  @(
    Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |
      Where-Object { $_.DisplayName -like 'VeilSend*' }
  )
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$expectedNotice = (Resolve-Path -LiteralPath $ExpectedNoticePath).Path
$installDirectory = [System.IO.Path]::GetFullPath($InstallDirectory)
$installParent = [System.IO.Path]::GetDirectoryName($installDirectory)
if (-not (Test-Path -LiteralPath $installParent -PathType Container)) {
  throw "Install directory parent does not exist: $installParent"
}
if (Test-Path -LiteralPath $installDirectory) {
  throw "Refusing to use an existing install directory: $installDirectory"
}

$startMenuDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\VeilSend'
if (Test-Path -LiteralPath $startMenuDirectory) {
  throw "Refusing to alter an existing VeilSend Start Menu directory: $startMenuDirectory"
}
if ((Get-VeilSendUninstallEntries).Count -ne 0) {
  throw 'Refusing to run while a VeilSend current-user uninstall entry already exists.'
}

$uninstaller = $null
$installed = $false
try {
  $installResult = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru -WindowStyle Hidden
  if ($installResult.ExitCode -ne 0) {
    throw "Installer failed with exit code $($installResult.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $installDirectory -PathType Container)) {
    throw "Installer did not create the requested directory: $installDirectory"
  }
  $installed = $true

  $installedNotices = @(Get-ChildItem -LiteralPath $installDirectory -Recurse -File -Filter 'THIRD_PARTY_LICENSES.md')
  if ($installedNotices.Count -ne 1) {
    throw "Expected exactly one installed THIRD_PARTY_LICENSES.md, found $($installedNotices.Count)"
  }
  $installedNotice = $installedNotices[0].FullName
  $expectedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $expectedNotice).Hash
  $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedNotice).Hash
  if ($expectedHash -ne $installedHash) {
    throw "Installed notice SHA-256 mismatch: expected $expectedHash, got $installedHash"
  }
  $expectedBytes = [System.IO.File]::ReadAllBytes($expectedNotice)
  $installedBytes = [System.IO.File]::ReadAllBytes($installedNotice)
  if (-not [System.Security.Cryptography.CryptographicOperations]::FixedTimeEquals($expectedBytes, $installedBytes)) {
    throw 'Installed notice bytes differ despite matching SHA-256.'
  }

  $uninstallers = @(Get-ChildItem -LiteralPath $installDirectory -Recurse -File -Filter 'uninstall.exe')
  if ($uninstallers.Count -ne 1) {
    throw "Expected exactly one installed uninstaller, found $($uninstallers.Count)"
  }
  $uninstaller = $uninstallers[0].FullName
  Write-Output "Verified installed notice: $installedNotice"
} finally {
  if ($installed -and $null -ne $uninstaller -and (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    $uninstallResult = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDirectory") -Wait -PassThru -WindowStyle Hidden
    if ($uninstallResult.ExitCode -ne 0) {
      throw "Uninstaller failed with exit code $($uninstallResult.ExitCode)"
    }
  }
  if (Test-Path -LiteralPath $installDirectory) {
    Remove-Item -LiteralPath $installDirectory -Recurse -Force
  }
  if (Test-Path -LiteralPath $startMenuDirectory) {
    Remove-Item -LiteralPath $startMenuDirectory -Recurse -Force
  }
  if ((Get-VeilSendUninstallEntries).Count -ne 0) {
    throw 'VeilSend current-user uninstall entry remained after cleanup.'
  }
}
