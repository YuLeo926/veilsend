param(
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$ArtifactsDirectory
)

$ErrorActionPreference = 'Stop'

if ($Version -ne '0.2.0-beta.1') { throw "Unexpected release version: $Version" }

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$target = Join-Path $workspace 'target\release'
$artifacts = [System.IO.Path]::GetFullPath($ArtifactsDirectory)
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null

$installers = @(Get-ChildItem -LiteralPath (Join-Path $target 'bundle\nsis') -Filter '*-setup.exe' -File)
if ($installers.Count -ne 1) { throw "Expected exactly one NSIS installer, found $($installers.Count)" }

$app = Join-Path $target 'veilsend.exe'
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw 'Missing release executable' }

$installerName = "VeilSend_${Version}_x64-setup-UNSIGNED.exe"
$portableName = "VeilSend_${Version}_x64-portable-UNSIGNED.zip"
$installerDestination = Join-Path $artifacts $installerName
$portableDestination = Join-Path $artifacts $portableName
Remove-Item -LiteralPath $installerDestination -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $portableDestination -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $installers[0].FullName -Destination $installerDestination

$temporaryBase = if ($env:RUNNER_TEMP) { [System.IO.Path]::GetFullPath($env:RUNNER_TEMP) } else { Join-Path $workspace 'tmp' }
$portableRoot = Join-Path $temporaryBase 'veilsend-portable-v0.2.0-beta.1'
if (Test-Path -LiteralPath $portableRoot) { Remove-Item -LiteralPath $portableRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null

Copy-Item -LiteralPath $app -Destination (Join-Path $portableRoot 'VeilSend.exe')
Copy-Item -LiteralPath (Join-Path $workspace 'LICENSE') -Destination $portableRoot
Copy-Item -LiteralPath (Join-Path $workspace 'RELEASE_NOTES.md') -Destination $portableRoot
Copy-Item -LiteralPath (Join-Path $workspace 'THIRD_PARTY_LICENSES.md') -Destination $portableRoot
Compress-Archive -Path (Join-Path $portableRoot '*') -DestinationPath $portableDestination -CompressionLevel Optimal
Remove-Item -LiteralPath $portableRoot -Recurse -Force
