$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$output=Join-Path $root '.build\upgrade-release'
if(Test-Path -LiteralPath $output){$full=[IO.Path]::GetFullPath($output); if(-not $full.StartsWith([IO.Path]::GetFullPath((Join-Path $root '.build')))){throw 'Unsafe fixture path'}; Remove-Item -LiteralPath $output -Recurse -Force}
& (Join-Path $root 'node_modules\.bin\electron-builder.cmd') --win nsis --x64 --config.directories.output=.build/upgrade-release --config.extraMetadata.version=0.9.0 --config.nsis.artifactName=Garfield-Chat-0.9.0-upgrade-fixture.exe
if($LASTEXITCODE -ne 0){throw 'Upgrade fixture build failed'}
if(-not (Test-Path -LiteralPath (Join-Path $output 'Garfield-Chat-0.9.0-upgrade-fixture.exe'))){throw 'Upgrade fixture missing'}
Write-Output 'Upgrade fixture built.'