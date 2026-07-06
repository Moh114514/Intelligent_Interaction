param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.build\python312\python.exe'
if (-not (Test-Path -LiteralPath $python)) { & (Join-Path $PSScriptRoot 'bootstrap-python312.ps1') }
$venv = Join-Path $root '.build\sidecar-venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$dist = Join-Path $root 'build\backend-sidecar'
$work = Join-Path $root 'build\pyinstaller-work'
if (-not (Test-Path -LiteralPath $python)) { throw 'Python 3.12 build runtime is missing at .build\python312\python.exe' }
$version = & $python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($version.Trim() -ne '3.12') { throw "Python 3.12 is required, found $version" }
if (-not (Test-Path -LiteralPath $venvPython)) { & $python -m venv $venv }
if (-not $SkipInstall) {
  & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $root 'backend\requirements-release.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Release dependency installation failed' }
  & $venvPython -m pip check
  if ($LASTEXITCODE -ne 0) { throw 'Release dependency check failed' }
}
foreach ($target in @($dist, $work)) {
  $resolvedParent = [IO.Path]::GetFullPath((Split-Path -Parent $target))
  if (-not $resolvedParent.StartsWith([IO.Path]::GetFullPath($root), [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe build path: $target" }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
& $venvPython -m PyInstaller --noconfirm --clean --distpath (Join-Path $root 'build') --workpath $work (Join-Path $root 'backend\agent-backend.spec')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
$exe = Join-Path $dist 'agent-backend.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Sidecar executable missing: $exe" }
$bytes = (Get-ChildItem -LiteralPath $dist -Recurse -File | Measure-Object Length -Sum).Sum
if ($bytes -gt 300MB) { throw "Sidecar exceeds 300 MiB: $bytes bytes" }
Write-Output "Sidecar built: $exe ($([math]::Round($bytes / 1MB, 2)) MiB)"