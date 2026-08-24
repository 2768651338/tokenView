; TokenView 桌面版安装脚本（Inno Setup 6，per-user 免管理员）
; 与旧版（无窗口服务 + 浏览器）共用 AppId：原地升级替换，保留用户数据
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
OutputDir=..\release
OutputBaseFilename=TokenView-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=TokenView
UninstallDisplayIcon={app}\TokenView.exe
CloseApplications=no
SetupIconFile=..\assets\tokenview.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; 安装前结束正在运行的实例，避免文件占用导致升级失败
[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM TokenView.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;

// 清理旧版（服务形态）遗留的 VBS 启动脚本；不动 data/（用户数据）
[InstallDelete]
Type: files; Name: "{app}\TokenView-run.vbs"

[Files]
Source: "..\release\TokenView-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\TokenView"; Filename: "{app}\TokenView.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\TokenView"; Filename: "{app}\TokenView.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\TokenView.exe"; Flags: nowait postinstall skipifsilent; Description: "启动 TokenView"

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM TokenView.exe"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{localappdata}\TokenView\data"
Type: filesandordirs; Name: "{localappdata}\TokenView\logs"
