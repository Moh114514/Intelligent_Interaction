$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'release'
$artifacts = @(
  'Garfield-Chat-1.0.0-win-x64-setup.exe',
  'Garfield-Chat-1.0.0-win-x64-portable.exe'
)
$entries=@()
foreach($name in $artifacts){
  $path=Join-Path $release $name
  if(-not (Test-Path -LiteralPath $path)){throw "Release artifact missing: $name"}
  $size=(Get-Item -LiteralPath $path).Length
  if($size -gt 250MB){throw "Release artifact exceeds 250 MiB: $name"}
  $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $entries += [ordered]@{name=$name;size_bytes=$size;sha256=$hash}
}
$manifest=[ordered]@{
  product='Garfield Chat';version='1.0.0';channel='candidate';platform='windows';architecture='x64';unsigned=$true
  built_at_utc=(Get-Date).ToUniversalTime().ToString('o');python='3.12.10';pyinstaller='6.21.0'
  data_root='%APPDATA%\Garfield Chat';tests=[ordered]@{verify_m6_5=$true;sidecar_smoke=$true;packaged_smoke=$true;nsis_portable_smoke=$true;windows_sandbox='pending'};artifacts=$entries
}
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $release 'release-manifest.json'),($manifest | ConvertTo-Json -Depth 8),$utf8)
$lines=$entries | ForEach-Object { "$($_.sha256)  $($_.name)" }
[IO.File]::WriteAllText((Join-Path $release 'SHA256SUMS.txt'),(($lines -join "`n")+"`n"),$utf8)
Write-Output 'Release manifest and SHA-256 checksums created.'