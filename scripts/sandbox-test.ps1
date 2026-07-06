$ErrorActionPreference='Stop'
$results=[ordered]@{started_at=(Get-Date).ToUniversalTime().ToString('o');machine=$env:COMPUTERNAME;steps=@();passed=$false}
function Run-Step([string]$name,[scriptblock]$action){
  $start=Get-Date
  try { & $action; $results.steps += [ordered]@{name=$name;status='passed';duration_ms=[int]((Get-Date)-$start).TotalMilliseconds} }
  catch { $results.steps += [ordered]@{name=$name;status='failed';duration_ms=[int]((Get-Date)-$start).TotalMilliseconds;error=$_.Exception.Message}; throw }
}
function Wait-ProcessName([string]$name,[int]$timeoutSeconds,[int[]]$exclude=@()){
  $deadline=(Get-Date).AddSeconds($timeoutSeconds)
  do { $found=@(Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {$exclude -notcontains $_.Id}); if($found.Count){return $found[0]}; Start-Sleep -Milliseconds 250 } while((Get-Date)-lt $deadline)
  throw "Timed out waiting for process: $name"
}
$release='C:\Release'; $upgrade='C:\Upgrade'; $install='C:\GarfieldChat'; $resultDir='C:\Harness\results'; $work='C:\GarfieldAcceptance'
New-Item -ItemType Directory -Force $resultDir,$work | Out-Null
Copy-Item -LiteralPath (Join-Path $release 'Garfield-Chat-1.0.0-win-x64-portable.exe') -Destination $work
Copy-Item -LiteralPath (Join-Path $release 'Garfield-Chat-1.0.0-win-x64-setup.exe') -Destination $work
Copy-Item -LiteralPath (Join-Path $upgrade 'Garfield-Chat-0.9.0-upgrade-fixture.exe') -Destination $work
Get-ChildItem -LiteralPath $work -File | Unblock-File
try {
  Run-Step 'clean_environment' {
    if(Get-Command node -ErrorAction SilentlyContinue){throw 'Node is unexpectedly installed'}
    if(Get-Command python -ErrorAction SilentlyContinue){throw 'Python is unexpectedly installed'}
  }
  $portable=Join-Path $work 'Garfield-Chat-1.0.0-win-x64-portable.exe'
  $setup=Join-Path $work 'Garfield-Chat-1.0.0-win-x64-setup.exe'
  $fixture=Join-Path $work 'Garfield-Chat-0.9.0-upgrade-fixture.exe'
  Run-Step 'portable_smoke' {
    $process=Start-Process -FilePath $portable -ArgumentList '--smoke-test' -PassThru -Wait
    if($process.ExitCode -ne 0){throw "Portable exited with $($process.ExitCode)"}
    if(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue){throw 'Portable left a Sidecar process'}
  }
  Run-Step 'install_upgrade_fixture' {
    $process=Start-Process -FilePath $fixture -ArgumentList @('/S',"/D=$install") -PassThru -Wait
    if($process.ExitCode -ne 0){throw "Fixture installer exited with $($process.ExitCode)"}
    if(-not (Test-Path -LiteralPath (Join-Path $install 'Garfield Chat.exe'))){throw 'Fixture application was not installed'}
    $data=Join-Path $env:APPDATA 'Garfield Chat'; New-Item -ItemType Directory -Force $data | Out-Null
    Set-Content -LiteralPath (Join-Path $data 'sandbox-upgrade-marker.txt') -Value 'preserve-me' -Encoding ascii
  }
  Run-Step 'upgrade_to_v1' {
    $process=Start-Process -FilePath $setup -ArgumentList @('/S',"/D=$install") -PassThru -Wait
    if($process.ExitCode -ne 0){throw "V1 installer exited with $($process.ExitCode)"}
    $app=Join-Path $install 'Garfield Chat.exe'
    $process=Start-Process -FilePath $app -ArgumentList '--smoke-test' -PassThru -Wait
    if($process.ExitCode -ne 0){throw "Installed smoke exited with $($process.ExitCode)"}
    if(-not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Garfield Chat\sandbox-upgrade-marker.txt'))){throw 'AppData marker did not survive upgrade'}
  }
  Run-Step 'sidecar_crash_restart' {
    $app=Start-Process -FilePath (Join-Path $install 'Garfield Chat.exe') -PassThru
    $first=Wait-ProcessName 'agent-backend' 30
    Stop-Process -Id $first.Id -Force
    $second=Wait-ProcessName 'agent-backend' 30 @($first.Id)
    if($second.Id -eq $first.Id){throw 'Sidecar did not restart with a new process'}
    $null=$app.CloseMainWindow(); if(-not $app.WaitForExit(10000)){Stop-Process -Id $app.Id -Force}
    Start-Sleep -Seconds 2
    if(Get-Process -Name 'agent-backend' -ErrorAction SilentlyContinue){throw 'Sidecar remained after Electron exit'}
  }
  Run-Step 'uninstall_preserves_appdata' {
    $uninstaller=Get-ChildItem -LiteralPath $install -Filter 'Uninstall*.exe' | Select-Object -First 1
    if(-not $uninstaller){throw 'Uninstaller was not found'}
    $process=Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -PassThru -Wait
    if($process.ExitCode -ne 0){throw "Uninstaller exited with $($process.ExitCode)"}
    if(Test-Path -LiteralPath (Join-Path $install 'Garfield Chat.exe')){throw 'Application remained after uninstall'}
    if(-not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Garfield Chat\sandbox-upgrade-marker.txt'))){throw 'AppData was removed by uninstall'}
  }
  $results.passed=$true
} catch { $results.failure=$_.Exception.Message } finally {
  $results.finished_at=(Get-Date).ToUniversalTime().ToString('o')
  $json=$results | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath (Join-Path $resultDir 'sandbox-results.json') -Value $json -Encoding utf8
  $lines=@('# Windows Sandbox V1.0 acceptance','',"Overall: **$(if($results.passed){'PASSED'}else{'FAILED'})**",'')
  foreach($step in $results.steps){$lines += "- $($step.name): $($step.status) ($($step.duration_ms) ms)$(if($step.error){' - '+$step.error}else{''})"}
  Set-Content -LiteralPath (Join-Path $resultDir 'sandbox-results.md') -Value $lines -Encoding utf8
  Start-Process shutdown.exe -ArgumentList '/s','/t','0' -WindowStyle Hidden
}