$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'release\win-unpacked\Garfield Chat.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Packaged executable not found: $exe" }
$runtime = Join-Path $root '.build\packaged-smoke'; New-Item -ItemType Directory -Force $runtime | Out-Null
$oldAppData=$env:APPDATA; $oldLocal=$env:LOCALAPPDATA; $oldPath=$env:PATH
try {
  $env:APPDATA=Join-Path $runtime 'Roaming'; $env:LOCALAPPDATA=Join-Path $runtime 'Local'
  New-Item -ItemType Directory -Force $env:APPDATA,$env:LOCALAPPDATA | Out-Null
  $env:PATH="$env:SystemRoot\System32;$env:SystemRoot"
  $before=@(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $process=Start-Process -FilePath $exe -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 0){throw "Packaged smoke test exited with $($process.ExitCode)"}
  Start-Sleep -Milliseconds 500
  $residual=@(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue | Where-Object {$before -notcontains $_.Id})
  if($residual.Count){throw "Sidecar remained after Electron exit: $($residual.Id -join ', ')"}
} finally { $env:APPDATA=$oldAppData; $env:LOCALAPPDATA=$oldLocal; $env:PATH=$oldPath }
Write-Output 'Packaged Electron smoke test passed without system Python or residual Sidecar.'