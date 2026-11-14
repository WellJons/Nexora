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
WizardStyle=modern dark hidebevels
WizardSizePercent=125,115
DisableStartupPrompt=yes
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
VersionInfoVersion={#AppVersion}
[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Messages]
BeveledLabel=NEXORA / PLAY YOUR WAY
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
russian.IntroTitle=Твоё игровое пространство
english.IntroTitle=Your gaming space
russian.IntroDesc=Один центр для игр, модов и локальных инструментов.
english.IntroDesc=One home for games, mods and local tools.
russian.Feature1=01   Библиотека и инструменты
english.Feature1=01   Library and tools
russian.Feature2=02   Модификации и Save Vault
english.Feature2=02   Mods and Save Vault
russian.Feature3=03   Локальный перевод и мониторинг
english.Feature3=03   Local translation and monitoring
russian.Feature4=Языковые пакеты скачиваются на выбор после установки. Подписка и аккаунт не нужны.
english.Feature4=Optional language packs are downloaded after installation. No subscription or account required.
russian.RemoveTitle=Удаление Nexora
english.RemoveTitle=Remove Nexora
russian.RemoveDesc=Служебные файлы, модели и кэш удаляются. Игры и моды остаются.
english.RemoveDesc=Application files, language packs and cache are removed. Games and mods stay.
russian.KeepTitle=Сохранить резервные копии (рекомендуется)
english.KeepTitle=Keep backups (recommended)
russian.PurgeTitle=Удалить внутренние резервные копии
english.PurgeTitle=Remove internal backup copies
russian.ConfirmPurge=Удалить внутренние копии Save Vault окончательно? Оригинальные сохранения вне хранилища остаются.
english.ConfirmPurge=Permanently remove internal Save Vault copies? Original saves outside the vault remain.
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
procedure InitializeWizard;
var
  Page: TWizardPage;
  L: TNewStaticText;
  I: Integer;
  Titles: array[0..2] of String;
begin
  Page := CreateCustomPage(wpWelcome, CustomMessage('IntroTitle'), CustomMessage('IntroDesc'));
  Titles[0] := CustomMessage('Feature1');
  Titles[1] := CustomMessage('Feature2');
  Titles[2] := CustomMessage('Feature3');
  for I := 0 to 2 do
  begin
    L := TNewStaticText.Create(Page);
    L.Parent := Page.Surface;
    L.Left := ScaleX(10);
    L.Top := ScaleY(12 + I * 37);
    L.Font.Style := [fsBold];
    L.Caption := Titles[I];
  end;
  L := TNewStaticText.Create(Page);
  L.Parent := Page.Surface;
  L.Left := ScaleX(10);
  L.Top := ScaleY(132);
  L.AutoSize := False;
  L.Width := Page.SurfaceWidth - ScaleX(20);
  L.WordWrap := True;
  L.Caption := CustomMessage('Feature4');
  L.AdjustHeight;
end;

procedure InitializeUninstallProgressForm;
begin
  UninstallProgressForm.PageNameLabel.Caption := CustomMessage('RemoveTitle');
  UninstallProgressForm.PageDescriptionLabel.Caption := CustomMessage('RemoveDesc');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  FindRec: TFindRec;
  Dir, DataDir: String;
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
  DataDir := AddBackslash(ExpandConstant('{userappdata}\Nexora'));
  if (CompareText(Copy(AddBackslash(Dir), 1, Length(DataDir)), DataDir) = 0) or
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
      if TaskDialogMsgBox(CustomMessage('RemoveTitle'), CustomMessage('RemoveDesc'), mbConfirmation, MB_YESNO, [CustomMessage('KeepTitle'), CustomMessage('PurgeTitle')], 0) = IDNO then
        if MsgBox(CustomMessage('ConfirmPurge'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
          Mode := 'purge-backups';
    Code := -1;
    Helper := ExpandConstant('{app}\resources\app\native-bin\Nexora.Memory.exe');
    if (not Exec(Helper, '--uninstall-cleanup ' + Mode, '', SW_HIDE, ewWaitUntilTerminated, Code)) or (Code <> 0) then
    begin
      Log('Nexora cleanup incomplete, code: ' + IntToStr(Code));
      if not UninstallSilent then MsgBox(CustomMessage('CleanupWarning'), mbInformation, MB_OK);
    end;
  end;
end;
