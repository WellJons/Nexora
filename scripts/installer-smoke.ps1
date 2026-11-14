$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version=(Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$setup=Join-Path $root "dist\installer\Nexora-Setup-$version-x64.exe"
$base=Join-Path $env:RUNNER_TEMP ("nexora-install-test-"+[Guid]::NewGuid().ToString('N'))
$install=Join-Path $base 'application';$mods=Join-Path $base 'mods';$data=Join-Path $env:APPDATA 'Nexora'
if(Test-Path $data){throw 'CI test requires a clean Nexora profile'}
New-Item -ItemType Directory -Path $base,$mods | Out-Null
function Assert([bool]$ok,[string]$message){if(!$ok){throw $message}}
$p=Start-Process -FilePath $setup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-',"/DIR=`"$install`"","/LOG=`"$base\setup.log`"") -Wait -PassThru
Assert ($p.ExitCode -eq 0) 'Setup failed'
Assert (Test-Path (Join-Path $install 'Nexora.exe')) 'Installed executable missing'
$un=Join-Path $install 'unins000.exe';Assert (Test-Path $un) 'Uninstaller missing'
New-Item -ItemType Directory -Path (Join-Path $data 'translation-models'),(Join-Path $data 'Cache'),(Join-Path $data 'scratch'),(Join-Path $data 'backups\save-test\files') -Force | Out-Null
Set-Content (Join-Path $data 'translation-models\test.onnx') 'model'
Set-Content (Join-Path $data 'Cache\test.bin') 'cache'
Set-Content (Join-Path $data 'scratch\test.tmp') 'temporary'
Set-Content (Join-Path $data 'backups\save-test\files\save.dat') 'save'
Set-Content (Join-Path $mods 'test.jar') 'mod'
@{installedMods=@(@{folder=$mods});backups=@(@{id='test';path=(Join-Path $data 'backups\save-test\files')})}|ConvertTo-Json -Depth 4|Set-Content -Encoding utf8NoBOM (Join-Path $data 'library.json')
$p=Start-Process -FilePath $un -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',"/LOG=`"$base\uninstall.log`"") -Wait -PassThru
Assert ($p.ExitCode -eq 0) 'Uninstall failed'
Assert (!(Test-Path (Join-Path $install 'Nexora.exe'))) 'Executable remains'
foreach($name in @('translation-models','Cache','scratch','library.json')){Assert (!(Test-Path (Join-Path $data $name))) "Unexpected data remains: $name"}
Assert (Test-Path (Join-Path $data 'backup-index.json')) 'Backup index lost'
Assert (Test-Path (Join-Path $data 'backups\save-test\files\save.dat')) 'Backup lost'
Assert (Test-Path (Join-Path $mods 'test.jar')) 'External mod lost'
Write-Host 'Installer and uninstaller preservation smoke test passed.'
