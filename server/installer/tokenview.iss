; TokenView 安装脚本（Inno Setup 6，per-user 免管理员）
#define AppName "TokenView"
#define AppVersion "1.0.0"
#define AppPublisher "TokenView"

[Setup]
AppId={{8E3F2A11-9C4D-4B7E-9A55-2D1F6B8C4A31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\TokenView
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=TokenView-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=TokenView
UninstallDisplayIcon={app}\TokenView.exe
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\TokenView.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "TokenView-run.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\TokenView"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\TokenView-run.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\TokenView.exe"
Name: "{autodesktop}\TokenView"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\TokenView-run.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\TokenView.exe"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\TokenView-run.vbs"""; Flags: nowait skipifsilent; Description: "立即启动 TokenView"

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM TokenView.exe"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\TokenView\data"
Type: filesandordirs; Name: "{localappdata}\TokenView\logs"
