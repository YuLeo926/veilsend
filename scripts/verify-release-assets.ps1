param(
  [Parameter(Mandatory=$true)][string]$AssetsDirectory,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
  [switch]$SkipAttestation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($SkipAttestation -and ($env:CI -and $env:CI -notin @('false', '0'))) {
  throw 'Attestation checks cannot be skipped in CI.'
}
$root = (Resolve-Path -LiteralPath $AssetsDirectory).Path
$expected = @(
  'VeilSend_0.2.0-beta.1_x64-setup-UNSIGNED.exe',
  'VeilSend_0.2.0-beta.1_x64-portable-UNSIGNED.zip',
  'veilsend-0.2.0-beta.1-sbom.cdx.json',
  'SHA256SUMS.txt'
)

function Assert-OrdinaryPath([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  while ($null -ne $item) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse points are not allowed: $($item.FullName)" }
    $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
  }
}

if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'AssetsDirectory must be a directory.' }
Assert-OrdinaryPath $root
foreach ($name in $expected) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)) { throw "Missing expected release asset: $name" }
}
$children = @(Get-ChildItem -LiteralPath $root -Force)
foreach ($child in $children) {
  if ($child.PSIsContainer -or $child.Name -cnotin $expected) { throw "Unexpected release assets: $($child.Name)" }
  Assert-OrdinaryPath $child.FullName
}
if ($children.Count -ne $expected.Count) { throw 'Unexpected release asset count.' }

# Fixed child name, no force/reuse; only a directory created by this invocation
# may be deleted. Caller-owned assets are never modified or extracted in place.
$inspection = [IO.Path]::GetFullPath((Join-Path $root '.veilsend-portable-inspection-v0.2.0-beta.1'))
if ([IO.Path]::GetDirectoryName($inspection) -ne $root.TrimEnd([IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe inspection directory.' }
if (Test-Path -LiteralPath $inspection) { throw 'Portable inspection directory already exists; choose a clean asset directory.' }
$created = $false
try {
  New-Item -ItemType Directory -Path $inspection -ErrorAction Stop | Out-Null
  $created = $true
  Assert-OrdinaryPath $inspection
  $limits = @(256MB, 512MB, 64MB, 4096)
  for ($i = 0; $i -lt $expected.Count; $i++) {
    $source = Join-Path $root $expected[$i]
    # Hold a non-writable/non-deletable source handle while copying a bounded
    # snapshot. All subsequent checks (including gh) use these same bytes.
    $inputStream = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      if ($inputStream.Length -le 0 -or $inputStream.Length -gt $limits[$i]) { throw "Release asset size outside inspection limits: $($expected[$i])" }
      $outputStream = [IO.File]::Open((Join-Path $inspection $expected[$i]), [IO.FileMode]::CreateNew)
      try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }

  $lines = @(Get-Content -LiteralPath (Join-Path $inspection $expected[3]))
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($line in $lines) {
    if ($line -cnotmatch '^([0-9a-f]{64})  (.+)$') { throw 'Malformed checksum line: expected lowercase SHA-256, two spaces, and an exact asset name.' }
    $hash = $Matches[1]
    $name = $Matches[2]
    if ($name -cnotin $expected[0..2]) { throw "Unexpected checksummed asset: $name" }
    if (-not $seen.Add($name)) { throw "Duplicate checksum for $name" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $inspection $name)).Hash.ToLowerInvariant()
    if ($actual -cne $hash) { throw "Checksum mismatch for $name" }
  }
  foreach ($name in $expected[0..2]) {
    if (-not $seen.Contains($name)) { throw "Missing checksum for $name" }
  }

  $sbom = Get-Content -Raw -LiteralPath (Join-Path $inspection $expected[2]) | ConvertFrom-Json -AsHashtable
  if ($sbom -isnot [Collections.IDictionary] -or $sbom['bomFormat'] -cne 'CycloneDX') { throw 'SBOM is not CycloneDX.' }

  $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $inspection $expected[1]))
  try {
    $members = @('VeilSend.exe', 'LICENSE', 'RELEASE_NOTES.md', 'THIRD_PARTY_LICENSES.md')
    $zipSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    if ($zip.Entries.Count -ne $members.Count) { throw 'Unexpected portable contents: expected exactly four root files.' }
    $total = 0L
    foreach ($entry in $zip.Entries) {
      # Exact ordinal names reject directories, absolute paths, traversal,
      # backslashes, alternate streams, aliases, and case collisions.
      if ($entry.FullName -cnotin $members -or -not $zipSeen.Add($entry.FullName)) { throw "Unexpected portable contents: $($entry.FullName)" }
      $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000
      if ($unixType -notin @(0, 0x8000) -or ($entry.ExternalAttributes -band 0x410)) { throw "Non-regular ZIP entry: $($entry.FullName)" }
      $limit = if ($entry.FullName -ceq 'VeilSend.exe') { 256MB } else { 8MB }
      $total += $entry.Length
      if ($entry.Length -le 0 -or $entry.Length -gt $limit -or $total -gt 280MB) { throw 'Portable contents exceed inspection size limits.' }
    }
    # Only after ALL entries pass validation may anything be extracted.
    $portable = Join-Path $inspection 'portable'
    New-Item -ItemType Directory -Path $portable | Out-Null
    foreach ($entry in $zip.Entries) {
      $inputStream = $entry.Open()
      try {
        $outputStream = [IO.File]::Open((Join-Path $portable $entry.FullName), [IO.FileMode]::CreateNew)
        try {
          $buffer = [byte[]]::new(65536)
          $written = 0L
          while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $written += $read
            if ($written -gt $entry.Length) { throw 'ZIP entry exceeds declared length.' }
            $outputStream.Write($buffer, 0, $read)
          }
          if ($written -ne $entry.Length) { throw 'ZIP entry length mismatch.' }
        } finally { $outputStream.Dispose() }
      } finally { $inputStream.Dispose() }
    }
  } finally { $zip.Dispose() }

  foreach ($executable in @((Join-Path $inspection $expected[0]), (Join-Path $portable 'VeilSend.exe'))) {
    if ((Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $executable).Status -ne 'NotSigned') {
      throw 'Executable signature state does not match the UNSIGNED asset contract.'
    }
  }
  $notes = Get-Content -Raw -LiteralPath (Join-Path $portable 'RELEASE_NOTES.md')
  if ($notes -notmatch 'VeilSend 0\.2\.0-beta\.1 is an unsigned pre-release\.' -or
      $notes -notmatch 'It is not Authenticode signed\.' -or
      $notes -notmatch 'Microsoft SmartScreen may warn' -or
      $notes -match '\b(?:is|are)\s+(?:digitally\s+|Authenticode\s+)?signed\b') {
    throw 'Release notes must accurately disclose this unsigned beta and the SmartScreen warning.'
  }

  if (-not $SkipAttestation) {
    $gh = (Get-Command gh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    foreach ($asset in $expected) {
      & $gh attestation verify (Join-Path $inspection $asset) --repo $Repository `
        --signer-workflow "$Repository/.github/workflows/release.yml" `
        --cert-identity "https://github.com/$Repository/.github/workflows/release.yml@refs/tags/v0.2.0-beta.1" `
        --source-ref refs/tags/v0.2.0-beta.1 --predicate-type https://slsa.dev/provenance/v1 `
        --deny-self-hosted-runners | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Attestation verification failed for $asset" }
    }
  }
} finally {
  if ($created) {
    # Refuse cleanup if the owned child or any descendant was replaced with a
    # reparse point. Never recurse into caller-owned or redirected paths.
    if ([IO.Path]::GetDirectoryName($inspection) -ne $root.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        [IO.Path]::GetFileName($inspection) -cne '.veilsend-portable-inspection-v0.2.0-beta.1') { throw 'Unsafe cleanup path.' }
    Assert-OrdinaryPath $inspection
    foreach ($item in Get-ChildItem -LiteralPath $inspection -Recurse -Force) { Assert-OrdinaryPath $item.FullName }
    Remove-Item -LiteralPath $inspection -Recurse -Force
  }
}
if ($SkipAttestation) {
  Write-Output 'PARTIAL LOCAL CHECK ONLY: structure, SHA-256 and unsigned disclosure passed; GitHub provenance NOT verified. Not release acceptance.'
} else {
  Write-Output 'VeilSend v0.2.0-beta.1 draft assets verified (including GitHub provenance).'
}
