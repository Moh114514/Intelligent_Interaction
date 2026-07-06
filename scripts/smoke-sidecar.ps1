$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'build\backend-sidecar\agent-backend.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Sidecar executable missing: $exe" }
$selfTest = & $exe --self-test | ConvertFrom-Json
Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'garfield-sidecar-self-test-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0 -or $selfTest.status -ne 'ok' -or $selfTest.python -notlike '3.12.*' -or -not $selfTest.certificate_bundle) { throw 'Frozen Sidecar self-test failed' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start(); $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop()
$tokenBytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes); $token = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })
$runtime = Join-Path $root '.build\sidecar-smoke'; New-Item -ItemType Directory -Force $runtime | Out-Null
$old = @{}; foreach($name in @('AGENT_HOST','AGENT_PORT','AGENT_AUTH_TOKEN','AGENT_LOG_DIR','AGENT_DATA_DIR','AGENT_ENV_FILE')){$old[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try {
  $env:AGENT_HOST='127.0.0.1'; $env:AGENT_PORT=[string]$port; $env:AGENT_AUTH_TOKEN=$token
  $env:AGENT_LOG_DIR=(Join-Path $runtime 'logs'); $env:AGENT_DATA_DIR=(Join-Path $runtime 'data'); $env:AGENT_ENV_FILE=(Join-Path $runtime 'missing.env')
  $process = Start-Process -FilePath $exe -ArgumentList @('--host','127.0.0.1','--port',[string]$port) -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Hidden -PassThru
  $ready=$false; $deadline=(Get-Date).AddSeconds(30)
  while((Get-Date) -lt $deadline -and -not $process.HasExited){
    try { $response=Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Headers @{Authorization="Bearer $token"} -TimeoutSec 1; if($response.status -eq 'ok'){$ready=$true; break} } catch { Start-Sleep -Milliseconds 200 }
  }
  if(-not $ready){throw 'Frozen Sidecar health check timed out'}
  $version=Invoke-RestMethod -Uri "http://127.0.0.1:$port/version" -Headers @{Authorization="Bearer $token"} -TimeoutSec 2
  if($version.protocol_version -ne '1.0'){throw 'Frozen Sidecar protocol mismatch'}
} finally {
  if($process -and -not $process.HasExited){Stop-Process -Id $process.Id -Force; $process.WaitForExit(5000) | Out-Null}
  foreach($name in $old.Keys){[Environment]::SetEnvironmentVariable($name,$old[$name],'Process')}
}
if(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue){throw 'Frozen Sidecar process remained after smoke test'}
Write-Output 'Frozen Sidecar smoke test passed.'