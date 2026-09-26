param([string]$UnsignedExecutable)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$temporaryBase = Join-Path $workspace 'tmp'
New-Item -ItemType Directory -Force -Path $temporaryBase | Out-Null
$fixture = Join-Path $temporaryBase ('release-verifier-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$assets = Join-Path $fixture 'assets'
$verifier = Join-Path $PSScriptRoot 'verify-release-assets.ps1'
$names = @('VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe', 'VeilSend_0.2.0-beta.1_x64-portable-UNSIGNED.zip', 'veilsend-0.2.0-beta.1-sbom.cdx.json', 'SHA256SUMS.txt')
$members = @('VeilSend.exe', 'LICENSE', 'RELEASE_NOTES.md', 'THIRD_PARTY_LICENSES.md')
$ciBefore = $env:CI
$passed = 0

function Write-Checksums {
  $lines = foreach ($name in $names[0..2]) { '{0}  {1}' -f (Get-FileHash -LiteralPath (Join-Path $assets $name)).Hash.ToLowerInvariant(), $name }
  [IO.File]::WriteAllLines((Join-Path $assets $names[3]), [string[]]$lines)
}

function Write-Portable([string]$Variant = 'normal') {
  $zipPath = Join-Path $assets $names[1]
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
  $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $entryNames = @($members)
    switch ($Variant) {
      'nested' { $entryNames[1] = 'nested/LICENSE' }
      'traversal' { $entryNames[1] = '../escaped.txt' }
      'backslash' { $entryNames[1] = '..\escaped.txt' }
      'absolute' { $entryNames[1] = '/LICENSE' }
      'ads' { $entryNames[1] = 'LICENSE:payload' }
      'case' { $entryNames[1] = 'license' }
      'duplicate' { $entryNames[1] = 'VeilSend.exe' }
      'directory' { $entryNames += 'nested/' }
      'extra' { $entryNames += 'extra.txt' }
      'missing' { $entryNames = $entryNames[0..2] }
    }
    foreach ($name in $entryNames) {
      $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::NoCompression)
      if ($name -ceq 'LICENSE' -and $Variant -eq 'symlink') { $entry.ExternalAttributes = [int](-1577058304) } # Unix 0120777
      if ($name -ceq 'LICENSE' -and $Variant -eq 'directory-attribute') { $entry.ExternalAttributes = 0x10 }
      if ($name -ceq 'LICENSE' -and $Variant -eq 'reparse-attribute') { $entry.ExternalAttributes = 0x400 }
      $stream = $entry.Open()
      try {
        if ($name -ceq 'VeilSend.exe') {
          $executableSource = if ($Variant -eq 'signed-portable') { Join-Path $PSHOME 'pwsh.exe' } else { Join-Path $fixture 'unsigned.exe' }
          $inputStream = [IO.File]::OpenRead($executableSource)
          try { $inputStream.CopyTo($stream) } finally { $inputStream.Dispose() }
        } else {
          $text = if ($name -ceq 'RELEASE_NOTES.md') {
            if ($Variant -eq 'false-notes') { 'VeilSend is Authenticode signed and safe.' }
            else { Get-Content -Raw -LiteralPath (Join-Path $workspace 'RELEASE_NOTES.md') }
          } else { 'synthetic notice fixture' }
          $bytes = [Text.Encoding]::UTF8.GetBytes($text)
          if ($Variant -eq 'oversize' -and $name -ceq 'LICENSE') { $bytes = [byte[]]::new(8MB + 1) }
          if ($Variant -eq 'empty' -and $name -ceq 'LICENSE') { $bytes = [byte[]]::new(0) }
          $stream.Write($bytes, 0, $bytes.Length)
        }
      } finally { $stream.Dispose() }
    }
  } finally { $zip.Dispose() }
}

function Reset-Assets {
  if (Test-Path -LiteralPath $assets) {
    if ([IO.Path]::GetDirectoryName($assets) -ne $fixture) { throw 'Unsafe fixture assets cleanup.' }
    Remove-Item -LiteralPath $assets -Recurse -Force
  }
  New-Item -ItemType Directory -Path $assets | Out-Null
  Copy-Item -LiteralPath (Join-Path $fixture 'unsigned.exe') -Destination (Join-Path $assets $names[0])
  [IO.File]::WriteAllText((Join-Path $assets $names[2]), '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1}')
  Write-Portable
  Write-Checksums
}

function Get-AssetSnapshot {
  @(Get-ChildItem -LiteralPath $assets -Recurse -File -Force | Sort-Object FullName | ForEach-Object { "$($_.FullName)=$((Get-FileHash -LiteralPath $_.FullName).Hash)" }) -join "`n"
}

function Assert-Verification([string]$Name, [string]$ExpectedError = '', [switch]$MockProvenance) {
  $before = Get-AssetSnapshot
  $failure = ''
  $output = ''
  try { $output = (& $verifier -AssetsDirectory $assets -Repository YuLeo926/veilsend -SkipAttestation:(-not $MockProvenance) | Out-String) }
  catch { $failure = $_.Exception.Message }
  if ($ExpectedError) {
    if ($failure -notmatch $ExpectedError) { throw "${Name}: expected '$ExpectedError', got '$failure'" }
  } elseif ($MockProvenance) {
    if ($failure -or $output -notmatch 'including GitHub provenance') { throw "${Name}: mocked CLI branch failed: $failure$output" }
  } elseif ($failure -or $output -notmatch 'PARTIAL LOCAL CHECK ONLY' -or $output -notmatch 'provenance NOT verified') {
    throw "${Name}: expected explicit partial local pass, got '$failure$output'"
  }
  if ((Get-AssetSnapshot) -cne $before) { throw "${Name}: caller assets were modified." }
  if (Test-Path -LiteralPath (Join-Path $assets '.veilsend-portable-inspection-v0.2.0-beta.1')) { throw "${Name}: inspection directory leaked." }
  $script:passed++
  Write-Output "PASS $Name"
}

try {
  # Rebuildable, genuine unsigned managed PE: the compiler emits it, but no
  # fixture code is ever run. The payload is not a VeilSend functional build.
  # An optional built VeilSend PE can replace it for additional local coverage.
  if ($UnsignedExecutable) {
    Copy-Item -LiteralPath $UnsignedExecutable -Destination (Join-Path $fixture 'unsigned.exe')
  } else {
    $typeName = 'VeilSendFixture' + [guid]::NewGuid().ToString('N')
    Add-Type -TypeDefinition "public static class $typeName { public static void Main() {} }" -OutputAssembly (Join-Path $fixture 'unsigned.exe') -OutputType Library
  }
  if ((Get-AuthenticodeSignature -LiteralPath (Join-Path $fixture 'unsigned.exe')).Status -ne 'NotSigned') { throw 'Fixture requires a valid unsigned PE.' }
  $env:CI = 'false'
  New-Item -ItemType Directory -Path $assets | Out-Null
  Assert-Verification 'empty-directory' 'Missing expected release asset'
  Reset-Assets
  Assert-Verification 'valid-real-PE-local-fixture'
  foreach ($name in $names) {
    Reset-Assets
    Remove-Item -LiteralPath (Join-Path $assets $name)
    Assert-Verification "missing-$name" 'Missing expected release asset'
  }
  Reset-Assets
  [IO.File]::WriteAllText((Join-Path $assets 'unexpected.txt'), 'unexpected')
  Assert-Verification 'extra-root-asset' 'Unexpected release assets'
  Reset-Assets
  New-Item -ItemType Directory -Path (Join-Path $assets 'unexpected-directory') | Out-Null
  Assert-Verification 'extra-root-directory' 'Unexpected release assets'
  Reset-Assets
  [IO.File]::AppendAllText((Join-Path $assets $names[0]), 'corruption')
  Assert-Verification 'changed-byte' 'Checksum mismatch'
  foreach ($variant in @('duplicate', 'missing', 'extra', 'traversal', 'hash', 'blank', 'case')) {
    Reset-Assets
    $manifest = @(Get-Content -LiteralPath (Join-Path $assets $names[3]))
    switch ($variant) {
      'duplicate' { $manifest += $manifest[0] }
      'missing' { $manifest = $manifest[0..1] }
      'extra' { $manifest += ('0' * 64 + '  unknown.exe') }
      'traversal' { $manifest += ('0' * 64 + '  ../outside.exe') }
      'hash' { $manifest[0] = 'not-a-hash  ' + $names[0] }
      'blank' { $manifest += '' }
      'case' { $manifest[0] = $manifest[0].Replace('VeilSend', 'veilsend') }
    }
    [IO.File]::WriteAllLines((Join-Path $assets $names[3]), [string[]]$manifest)
    Assert-Verification "manifest-$variant" 'checksum|checksummed'
  }
  foreach ($variant in @('nested', 'traversal', 'backslash', 'absolute', 'ads', 'case', 'duplicate', 'directory', 'extra', 'missing', 'symlink', 'directory-attribute', 'reparse-attribute', 'oversize', 'empty', 'false-notes')) {
    Reset-Assets
    Write-Portable $variant
    Write-Checksums
    Assert-Verification "zip-$variant" 'portable contents|Non-regular ZIP|size limits|accurately disclose'
    if (Test-Path -LiteralPath (Join-Path $assets 'escaped.txt')) { throw 'ZIP traversal escaped inspection.' }
  }
  Reset-Assets
  [IO.File]::WriteAllText((Join-Path $assets $names[1]), 'not a ZIP')
  Write-Checksums
  Assert-Verification 'invalid-zip' 'Central Directory|archive'
  foreach ($invalidSbom in @('{"bomFormat":"SPDX"}', '[]', 'null', '{invalid')) {
    Reset-Assets
    [IO.File]::WriteAllText((Join-Path $assets $names[2]), $invalidSbom)
    Write-Checksums
    Assert-Verification 'invalid-sbom' 'CycloneDX|JSON'
  }
  Reset-Assets
  Copy-Item -LiteralPath (Join-Path $PSHOME 'pwsh.exe') -Destination (Join-Path $assets $names[0]) -Force
  Write-Checksums
  if ((Get-AuthenticodeSignature -LiteralPath (Join-Path $assets $names[0])).Status -eq 'NotSigned') { throw 'Expected signed PowerShell fixture for installer signature rejection.' }
  Assert-Verification 'signed-installer' 'signature state'
  Reset-Assets
  Write-Portable 'signed-portable'
  Write-Checksums
  Assert-Verification 'signed-portable' 'signature state'

  # A PATH-scoped external gh test double exercises invocation policy and exit
  # propagation without changing any production signature or attestation code.
  # This is NOT cryptographic evidence and never contacts GitHub.
  Reset-Assets
  $fakeBin = Join-Path $fixture 'fake-bin'
  New-Item -ItemType Directory -Path $fakeBin | Out-Null
  $fakeScript = Join-Path $fakeBin 'fake-gh.ps1'
  [IO.File]::WriteAllText($fakeScript, @'
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$required = @(
  'attestation', 'verify', $Arguments[2],
  '--repo', 'YuLeo926/veilsend',
  '--signer-workflow', 'YuLeo926/veilsend/.github/workflows/release.yml',
  '--cert-identity', 'https://github.com/YuLeo926/veilsend/.github/workflows/release.yml@refs/tags/v0.2.0-beta.1',
  '--source-ref', 'refs/tags/v0.2.0-beta.1',
  '--predicate-type', 'https://slsa.dev/provenance/v1', '--deny-self-hosted-runners'
)
if (($Arguments -join '|') -cne ($required -join '|')) { throw 'Incorrect provenance identity policy.' }
if ($Arguments[2] -notlike '*\.veilsend-portable-inspection-v0.2.0-beta.1\*') { throw 'CLI did not receive the inspected snapshot.' }
[IO.File]::AppendAllText($env:VEILSEND_TEST_GH_LOG, [IO.Path]::GetFileName($Arguments[2]) + "`n")
if ($env:VEILSEND_TEST_GH_FAIL -eq [IO.Path]::GetFileName($Arguments[2])) { exit 17 }
exit 0
'@)
  [IO.File]::WriteAllText((Join-Path $fakeBin 'gh.cmd'), "@echo off`r`n`"$(Join-Path $PSHOME 'pwsh.exe')`" -NoProfile -File `"$fakeScript`" %*`r`nexit /b %errorlevel%`r`n")
  $pathBefore = $env:PATH
  $logBefore = $env:VEILSEND_TEST_GH_LOG
  $failBefore = $env:VEILSEND_TEST_GH_FAIL
  try {
    $env:PATH = "$fakeBin;$pathBefore"
    $env:VEILSEND_TEST_GH_LOG = Join-Path $fixture 'gh-calls.txt'
    $env:VEILSEND_TEST_GH_FAIL = ''
    Assert-Verification 'mock-gh-four-artifact-policy' -MockProvenance
    $calls = @(Get-Content -LiteralPath $env:VEILSEND_TEST_GH_LOG)
    if (($calls -join '|') -cne ($names -join '|')) { throw 'Expected gh verification of all four exact assets.' }
    foreach ($name in $names) {
      $env:VEILSEND_TEST_GH_FAIL = $name
      Assert-Verification "mock-gh-reject-$name" 'Attestation verification failed' -MockProvenance
    }
  } finally {
    $env:PATH = $pathBefore
    $env:VEILSEND_TEST_GH_LOG = $logBefore
    $env:VEILSEND_TEST_GH_FAIL = $failBefore
  }
  Reset-Assets
  foreach ($ciValue in @('true', 'TRUE', '1')) {
    $env:CI = $ciValue
    Assert-Verification "no-attestation-bypass-CI-$ciValue" 'cannot be skipped in CI'
  }
  $env:CI = 'false'
  Reset-Assets
  $existingInspection = Join-Path $assets '.veilsend-portable-inspection-v0.2.0-beta.1'
  New-Item -ItemType Directory -Path $existingInspection | Out-Null
  $sentinel = Join-Path $existingInspection 'keep.txt'
  [IO.File]::WriteAllText($sentinel, 'caller-owned')
  try { & $verifier -AssetsDirectory $assets -Repository YuLeo926/veilsend -SkipAttestation; throw 'Expected existing-directory rejection.' }
  catch { if ($_.Exception.Message -notmatch 'Unexpected release assets|already exists') { throw } }
  if ((Get-Content -Raw -LiteralPath $sentinel) -cne 'caller-owned') { throw 'Existing inspection directory was altered.' }
  $passed++
  Write-Output 'PASS caller-owned-inspection-preserved'
  Write-Output "$passed asset verifier fixture tests passed; no packaged executable was run and no live attestation was requested."
} finally {
  $env:CI = $ciBefore
  $resolvedFixture = (Resolve-Path -LiteralPath $fixture).Path
  if ([IO.Path]::GetDirectoryName($resolvedFixture) -ne $temporaryBase -or [IO.Path]::GetFileName($resolvedFixture) -notmatch '^release-verifier-fixture-[0-9a-f]{32}$') { throw 'Unsafe fixture cleanup path.' }
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
