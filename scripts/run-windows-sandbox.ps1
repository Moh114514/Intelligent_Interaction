$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$sandboxExe='C:\Windows\System32\WindowsSandbox.exe'
if(-not (Test-Path -LiteralPath $sandboxExe)){throw 'Windows Sandbox is not available'}
$release=Join-Path $root 'release'; $upgrade=Join-Path $root '.build\upgrade-release'; $harness=Join-Path $root '.build\sandbox-harness'
foreach($path in @((Join-Path $release 'Garfield-Chat-1.0.0-win-x64-setup.exe'),(Join-Path $release 'Garfield-Chat-1.0.0-win-x64-portable.exe'),(Join-Path $upgrade 'Garfield-Chat-0.9.0-upgrade-fixture.exe'))){if(-not (Test-Path -LiteralPath $path)){throw "Sandbox input missing: $path"}}
if(Test-Path -LiteralPath $harness){$full=[IO.Path]::GetFullPath($harness); if(-not $full.StartsWith([IO.Path]::GetFullPath((Join-Path $root '.build')))){throw 'Unsafe harness path'}; Remove-Item -LiteralPath $harness -Recurse -Force}
New-Item -ItemType Directory -Force (Join-Path $harness 'results') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts\sandbox-test.ps1') -Destination (Join-Path $harness 'run.ps1')
function Xml([string]$value){return [Security.SecurityElement]::Escape($value)}
$config=@"
<Configuration>
  <MappedFolders>
    <MappedFolder><HostFolder>$(Xml $release)</HostFolder><SandboxFolder>C:\Release</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(Xml $upgrade)</HostFolder><SandboxFolder>C:\Upgrade</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(Xml $harness)</HostFolder><SandboxFolder>C:\Harness</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Harness\run.ps1</Command></LogonCommand>
  <Networking>Disable</Networking>
  <ProtectedClient>Disable</ProtectedClient>
  <ClipboardRedirection>Disable</ClipboardRedirection>
</Configuration>
"@
$utf8=New-Object Text.UTF8Encoding($false); $wsb=Join-Path $harness 'garfield-v1.wsb'; [IO.File]::WriteAllText($wsb,$config,$utf8)
$process=Start-Process -FilePath $sandboxExe -ArgumentList $wsb -PassThru
$result=Join-Path $harness 'results\sandbox-results.json'
$deadline=(Get-Date).AddMinutes(10)
do {
  if(Test-Path -LiteralPath $result){break}
  if($process.HasExited){throw 'Windows Sandbox exited without returning a result'}
  Start-Sleep -Milliseconds 500
} while((Get-Date)-lt $deadline)
if(-not (Test-Path -LiteralPath $result)){if(-not $process.HasExited){Stop-Process -Id $process.Id -Force}; throw 'Windows Sandbox acceptance timed out'}
Start-Sleep -Milliseconds 500
if(-not $process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
$data=Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
Copy-Item -LiteralPath (Join-Path $harness 'results\sandbox-results.json') -Destination (Join-Path $release 'sandbox-results.json') -Force
Copy-Item -LiteralPath (Join-Path $harness 'results\sandbox-results.md') -Destination (Join-Path $release 'sandbox-results.md') -Force
$manifestPath=Join-Path $release 'release-manifest.json'
if(Test-Path -LiteralPath $manifestPath){
  $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $manifest.tests | Add-Member -NotePropertyName windows_sandbox -NotePropertyValue ([bool]$data.passed) -Force
  $manifest | Add-Member -NotePropertyName sandbox_report -NotePropertyValue 'sandbox-results.json' -Force
  if(-not $data.passed){$manifest.channel='blocked-candidate'; $manifest | Add-Member -NotePropertyName sandbox_blocker -NotePropertyValue $data.failure -Force}
  $utf8=New-Object Text.UTF8Encoding($false); [IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 8),$utf8)
}
if(-not $data.passed){throw "Windows Sandbox acceptance failed: $($data.failure)"}
Write-Output 'Windows Sandbox V1.0 acceptance passed.'