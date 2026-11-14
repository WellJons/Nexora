$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version=(Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$compiler=Get-Command ISCC.exe -ErrorAction SilentlyContinue
if($compiler){$iscc=$compiler.Source}else{$iscc=Join-Path "${env:ProgramFiles(x86)}" 'Inno Setup 6\ISCC.exe'}
if(!(Test-Path $iscc)){throw 'Inno Setup 6.6+ is required to build the installer'}
& $iscc "/DAppVersion=$version" (Join-Path $root 'installer\Nexora.iss')
if($LASTEXITCODE -ne 0){throw "Installer compilation failed ($LASTEXITCODE)"}
$exe=Join-Path $root "dist\installer\Nexora-Setup-$version-x64.exe"
if(!(Test-Path $exe)){throw 'Setup output missing'}
(Get-FileHash $exe -Algorithm SHA256).Hash.ToLower() + '  ' + [IO.Path]::GetFileName($exe) | Set-Content -Encoding ascii "$exe.sha256"
