param([string]$Version = '3.12.10')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.build\python312'
$python = Join-Path $target 'python.exe'
if (Test-Path -LiteralPath $python) {
  $actual = (& $python -c "import platform; print(platform.python_version())").Trim()
  if ($actual -eq $Version) { Write-Output "Python $Version build runtime is ready."; exit 0 }
  throw "Unexpected isolated Python version: $actual"
}
$downloads = Join-Path $root '.build\downloads'
New-Item -ItemType Directory -Force $downloads | Out-Null
$installer = Join-Path $downloads "python-$Version-amd64.exe"
$url = "https://www.python.org/ftp/python/$Version/python-$Version-amd64.exe"
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
  throw "Python installer signature validation failed: $($signature.Status)"
}
$args = @('/quiet','InstallAllUsers=0',"TargetDir=$target",'Include_pip=1','Include_launcher=0','Include_test=0','Include_doc=0','Include_tcltk=0','PrependPath=0','Shortcuts=0')
$process = Start-Process -FilePath $installer -ArgumentList $args -PassThru -Wait -WindowStyle Hidden
if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $python)) { throw "Python installer failed with exit code $($process.ExitCode)" }
$actual = (& $python -c "import platform; print(platform.python_version())").Trim()
if ($actual -ne $Version) { throw "Installed Python version mismatch: $actual" }
Write-Output "Installed isolated official Python $Version x64 runtime."