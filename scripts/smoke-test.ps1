$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'release\win-unpacked\Garfield Chat.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Packaged executable not found: $exe"
}

$before = @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like '*backend.app.main*'
} | Select-Object -ExpandProperty ProcessId)

$process = Start-Process -FilePath $exe -ArgumentList '--smoke-test' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) {
    throw "Packaged smoke test exited with code $($process.ExitCode)"
}

Start-Sleep -Seconds 1
$after = @(Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like '*backend.app.main*'
} | Select-Object -ExpandProperty ProcessId)
$residual = @($after | Where-Object { $before -notcontains $_ })
if ($residual.Count -gt 0) {
    throw "Sidecar process remained after Electron exit: $($residual -join ', ')"
}

Write-Output 'Packaged Electron smoke test passed with no residual sidecar process.'
