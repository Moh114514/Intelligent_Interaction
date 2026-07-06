$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$portable=Join-Path $root 'release\Garfield-Chat-1.0.0-win-x64-portable.exe'
$setup=Join-Path $root 'release\Garfield-Chat-1.0.0-win-x64-setup.exe'
$runtime=Join-Path $root '.build\local-release-smoke'
$install=Join-Path $runtime 'install'
foreach($path in @($portable,$setup)){if(-not (Test-Path -LiteralPath $path)){throw "Release artifact missing: $path"}}
if(Test-Path -LiteralPath $runtime){$full=[IO.Path]::GetFullPath($runtime); if(-not $full.StartsWith([IO.Path]::GetFullPath((Join-Path $root '.build')))){throw 'Unsafe smoke path'}; Remove-Item -LiteralPath $runtime -Recurse -Force}
New-Item -ItemType Directory -Force $runtime | Out-Null
$oldAppData=$env:APPDATA; $oldLocal=$env:LOCALAPPDATA; $oldPath=$env:PATH
$before=@(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
try {
  $env:APPDATA=Join-Path $runtime 'Roaming'; $env:LOCALAPPDATA=Join-Path $runtime 'Local'; $env:PATH="$env:SystemRoot\System32;$env:SystemRoot"
  New-Item -ItemType Directory -Force $env:APPDATA,$env:LOCALAPPDATA | Out-Null
  $process=Start-Process -FilePath $portable -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 0){throw "Portable smoke exited with $($process.ExitCode)"}
  $process=Start-Process -FilePath $setup -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 0){throw "Installer exited with $($process.ExitCode)"}
  $app=Join-Path $install 'Garfield Chat.exe'; if(-not (Test-Path -LiteralPath $app)){throw 'Installed application is missing'}
  $process=Start-Process -FilePath $app -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 0){throw "Installed smoke exited with $($process.ExitCode)"}
  $data=Join-Path $env:APPDATA 'Garfield Chat'; New-Item -ItemType Directory -Force $data | Out-Null
  $marker=Join-Path $data 'uninstall-preserve-marker.txt'; [IO.File]::WriteAllText($marker,'preserve-me',[Text.Encoding]::ASCII)
  $uninstaller=Get-ChildItem -LiteralPath $install -Filter 'Uninstall*.exe' | Select-Object -First 1
  if(-not $uninstaller){throw 'Uninstaller is missing'}
  $process=Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if($process.ExitCode -ne 0){throw "Uninstaller exited with $($process.ExitCode)"}
  $deadline=(Get-Date).AddSeconds(20); while((Test-Path -LiteralPath $app) -and (Get-Date)-lt $deadline){Start-Sleep -Milliseconds 250}
  if(Test-Path -LiteralPath $app){throw 'Application remained after uninstall'}
  if(-not (Test-Path -LiteralPath $marker)){throw 'Uninstall removed AppData'}
  Start-Sleep -Milliseconds 500
  $residual=@(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue | Where-Object {$before -notcontains $_.Id})
  if($residual.Count){throw "Release smoke left Sidecar processes: $($residual.Id -join ', ')"}
} finally {
  $env:APPDATA=$oldAppData; $env:LOCALAPPDATA=$oldLocal; $env:PATH=$oldPath
}
Write-Output 'Portable, NSIS install, installed startup, uninstall and AppData retention smoke passed.'