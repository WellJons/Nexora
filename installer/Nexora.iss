#ifndef AppVersion
  #define AppVersion "0.17.0"
#endif
[Setup]
AppId={{C246236C-7319-41E2-8D9A-8343799CE58F}
AppName=Nexora
AppVersion={#AppVersion}
AppPublisher=Nexora
AppPublisherURL=https://github.com/WellJons/Nexora
AppSupportURL=https://github.com/WellJons/Nexora/issues
DefaultDirName={localappdata}\Programs\Nexora
DefaultGroupName=Nexora
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern dark
WizardSizePercent=115,115
WizardResizable=yes
WizardImageFile=..\dist\branding\wizard.png
WizardSmallImageFile=..\dist\branding\small.png
SetupIconFile=..\dist\branding\nexora.ico
UninstallDisplayIcon={app}\Nexora.exe
OutputDir=..\dist\installer
OutputBaseFilename=Nexora-Setup-{#AppVersion}-x64
Compression=lzma2/fast
SolidCompression=yes
DisableWelcomePage=no
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
UninstallLogging=yes
VersionInfoVersion={#AppVersion}
[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[CustomMessages]
russian.Desktop=Создать ярлык на рабочем столе
english.Desktop=Create a desktop shortcut
russian.Launch=Запустить Nexora
english.Launch=Launch Nexora
russian.Purge=Удалить также резервные копии Save Vault?%n%nНет (рекомендуется): копии останутся в профиле Nexora. Игровые файлы, внешние сохранения и моды не удаляются.
english.Purge=Also remove Save Vault backups?%n%nNo (recommended): keep backup copies in the Nexora profile. Game files, external saves and mods are not removed.
russian.CleanupWarning=Не все служебные файлы удалось удалить безопасно. Проверьте папку %APPDATA%\Nexora; резервные копии, занятые файлы и неизвестные пользовательские файлы могли остаться.
english.CleanupWarning=Some application data could not safely be removed. Check %APPDATA%\Nexora; backups, locked files and unknown user files may remain.
russian.BadFolder=Выберите отдельную пустую папку Nexora или папку предыдущей установки.
english.BadFolder=Choose a separate empty Nexora folder or the previous installation folder.
[Tasks]
Name: "desktopicon"; Description: "{cm:Desktop}"; GroupDescription: "{cm:AdditionalIcons}"
[Files]
Source: "..\dist\Nexora-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installed.marker"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{autoprograms}\Nexora"; Filename: "{app}\Nexora.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Nexora"; Filename: "{app}\Nexora.exe"; WorkingDir: "{app}"; Tasks: desktopicon
[Run]
Filename: "{app}\Nexora.exe"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifsilent
[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  FindRec: TFindRec;
  Dir: String;
  NonEmpty: Boolean;
begin
  Result := '';
  Dir := ExpandConstant('{app}');
  NonEmpty := False;
  if FindFirst(AddBackslash(Dir) + '*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then NonEmpty := True;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
  if (CompareText(Dir, ExpandConstant('{userappdata}\Nexora')) = 0) or
     (NonEmpty and not FileExists(AddBackslash(Dir) + 'installed.marker')) then
    Result := CustomMessage('BadFolder');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Mode, Helper: String;
  Code: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Mode := 'keep';
    if not UninstallSilent then
      if MsgBox(CustomMessage('Purge'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        Mode := 'purge-backups';
    Helper := ExpandConstant('{app}\resources\app\native-bin\Nexora.Memory.exe');
    if (not Exec(Helper, '--uninstall-cleanup ' + Mode, '', SW_HIDE, ewWaitUntilTerminated, Code)) or (Code <> 0) then
    begin
      Log('Nexora cleanup incomplete, code: ' + IntToStr(Code));
      if not UninstallSilent then MsgBox(CustomMessage('CleanupWarning'), mbInformation, MB_OK);
    end;
  end;
end;
