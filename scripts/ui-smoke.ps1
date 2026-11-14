$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exe=Join-Path $root 'dist\Nexora-win32-x64\Nexora.exe'
$before=@(Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Directory -Filter 'nexora-ui-smoke-*' | ForEach-Object FullName)
$env:NEXORA_UI_SMOKE='1'
try {
 $p=Start-Process -FilePath $exe -ArgumentList @('--nexora-ui-smoke') -WorkingDirectory $root -PassThru
 if(!$p.WaitForExit(90000)){$p.Kill();throw 'UI smoke timed out'}
 $dirs=@(Get-ChildItem -Path ([IO.Path]::GetTempPath()) -Directory -Filter 'nexora-ui-smoke-*' | Where-Object {$_.FullName -notin $before})
 if($dirs.Count -ne 1){throw 'Expected one isolated smoke profile'}
 $report=Join-Path $dirs[0].FullName 'ui-smoke.json'
 if(!(Test-Path $report)){throw "UI report missing (exit $($p.ExitCode))"}
 $raw=Get-Content $report -Raw;Write-Host $raw
 $result=$raw|ConvertFrom-Json
 if($p.ExitCode -ne 0 -or !$result.ok -or $result.pages.Count -ne 14){throw 'UI smoke failed'}
 Remove-Item $dirs[0].FullName -Recurse -Force
} finally { Remove-Item Env:NEXORA_UI_SMOKE -ErrorAction SilentlyContinue }
