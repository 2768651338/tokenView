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
WizardStyle=dark
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
// 安装向导整体重排：左侧品牌栏（logo + 名称 + 版权）+ 右侧内容区
// 配色与应用内终端风一致：#0d1117 底 / #161b22 面板 / #e6edf3 主文字 / #9198a1 次要文字
// 注意：TColor 为 0x00BBGGRR 字节序
const
  BRAND_W = 200;

procedure ShiftControl(C: TControl; X, W: Integer);
begin
  C.Left := X;
  C.Width := W;
end;

procedure InitializeWizard();
var
  Bmp: TBitmap;
  LogoImg, LogoImg2: TBitmapImage;
  VerLabel, CopyLabel: TLabel;
  L1, L2: TLabel;
  BrandPanel, SepLine: TPanel;
  SW, SH, CX, CW: Integer;
begin
  WizardForm.Color := $17110D;                 // #0d1117
  WizardForm.InnerPage.Color := $17110D;

  // 固定窗口尺寸，保证自定义布局稳定
  WizardForm.Position := poScreenCenter;
  WizardForm.ClientWidth := ScaleX(860);
  WizardForm.ClientHeight := ScaleY(560);
  SW := WizardForm.ClientWidth;
  SH := WizardForm.ClientHeight;
  CX := ScaleX(BRAND_W + 24);                  // 内容区起始 X
  CW := SW - CX - ScaleX(24);                  // 内容区宽度

  // 隐藏 Inno 默认插画（欢迎页大图 + 内页/完成页小图）与分隔线
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.WizardSmallBitmapImage.Visible := False;
  WizardForm.Bevel.Visible := False;

  // ---- 左侧品牌栏 ----
  BrandPanel := TPanel.Create(WizardForm);
  BrandPanel.Parent := WizardForm;
  BrandPanel.Left := 0;
  BrandPanel.Top := 0;
  BrandPanel.Width := ScaleX(BRAND_W);
  BrandPanel.Height := SH;
  BrandPanel.Color := $221B16;                 // #161b22
  BrandPanel.BevelOuter := bvNone;

  ExtractTemporaryFile('installer-logo.bmp');
  Bmp := TBitmap.Create;
  Bmp.LoadFromFile(ExpandConstant('{tmp}\installer-logo.bmp'));
  LogoImg := TBitmapImage.Create(WizardForm);
  LogoImg.Parent := BrandPanel;
  LogoImg.Bitmap := Bmp;
  LogoImg.Left := ScaleX(52);
  LogoImg.Top := ScaleY(56);
  LogoImg.Width := ScaleX(96);
  LogoImg.Height := ScaleY(96);
  LogoImg.Stretch := True;

  L1 := TLabel.Create(WizardForm);
  L1.Parent := BrandPanel;
  L1.AutoSize := False;
  L1.Left := 0;
  L1.Top := ScaleY(176);
  L1.Width := ScaleX(BRAND_W);
  L1.Height := ScaleY(30);
  L1.Alignment := taCenter;
  L1.Caption := 'TokenView';
  L1.Font.Name := 'Microsoft YaHei';
  L1.Font.Size := 13;
  L1.Font.Style := [fsBold];
  L1.Font.Color := $F3EDE6;

  L2 := TLabel.Create(WizardForm);
  L2.Parent := BrandPanel;
  L2.AutoSize := False;
  L2.Left := 0;
  L2.Top := ScaleY(210);
  L2.Width := ScaleX(BRAND_W);
  L2.Height := ScaleY(20);
  L2.Alignment := taCenter;
  L2.Caption := '多渠道 Token 消耗监控中心';
  L2.Font.Name := 'Microsoft YaHei';
  L2.Font.Size := 9;
  L2.Font.Color := $A19891;

  VerLabel := TLabel.Create(WizardForm);
  VerLabel.Parent := BrandPanel;
  VerLabel.AutoSize := False;
  VerLabel.Left := 0;
  VerLabel.Top := ScaleY(236);
  VerLabel.Width := ScaleX(BRAND_W);
  VerLabel.Height := ScaleY(20);
  VerLabel.Alignment := taCenter;
  VerLabel.Caption := 'V {#AppVersion}';
  VerLabel.Font.Name := 'Microsoft YaHei';
  VerLabel.Font.Size := 9;
  VerLabel.Font.Color := $81766E;

  CopyLabel := TLabel.Create(WizardForm);
  CopyLabel.Parent := BrandPanel;
  CopyLabel.AutoSize := False;
  CopyLabel.Left := 0;
  CopyLabel.Top := SH - ScaleY(72);
  CopyLabel.Width := ScaleX(BRAND_W);
  CopyLabel.Height := ScaleY(48);
  CopyLabel.Alignment := taCenter;
  CopyLabel.Caption := '© 田小橙' #13#10 'QQ 2768651338';
  CopyLabel.Font.Name := 'Microsoft YaHei';
  CopyLabel.Font.Size := 9;
  CopyLabel.Font.Color := $81766E;

  // 页脚分隔线
  SepLine := TPanel.Create(WizardForm);
  SepLine.Parent := WizardForm;
  SepLine.Left := ScaleX(BRAND_W);
  SepLine.Top := SH - ScaleY(56);
  SepLine.Width := SW - ScaleX(BRAND_W);
  SepLine.Height := ScaleY(1);
  SepLine.Color := $3D3630;
  SepLine.BevelOuter := bvNone;

  // ---- 内容区右移：外层笔记本整体右移（InnerPage 为对齐布局，须移其父容器） ----
  WizardForm.OuterNotebook.Left := CX - ScaleX(12);
  WizardForm.OuterNotebook.Width := CW + ScaleX(24);
  WizardForm.OuterNotebook.Height := SH - ScaleY(56) - WizardForm.OuterNotebook.Top;

  ShiftControl(WizardForm.PageNameLabel, CX, CW);
  ShiftControl(WizardForm.PageDescriptionLabel, CX, CW);
  ShiftControl(WizardForm.StatusLabel, CX, CW);
  ShiftControl(WizardForm.FilenameLabel, CX, CW);
  ShiftControl(WizardForm.ProgressGauge, CX, CW);
  // 页内标签相对页面定位（Welcome/Ready 页）
  ShiftControl(WizardForm.WelcomeLabel1, ScaleX(12), WizardForm.OuterNotebook.Width - ScaleX(24));
  ShiftControl(WizardForm.WelcomeLabel2, ScaleX(12), WizardForm.OuterNotebook.Width - ScaleX(24));
  ShiftControl(WizardForm.ReadyLabel, ScaleX(12), WizardForm.OuterNotebook.Width - ScaleX(24));
  WizardForm.WelcomeLabel1.Top := ScaleY(96);
  WizardForm.WelcomeLabel2.Top := ScaleY(150);
  WizardForm.FinishedHeadingLabel.Left := ScaleX(165);
  WizardForm.FinishedLabel.Left := ScaleX(165);
  WizardForm.FinishedHeadingLabel.Top := ScaleY(96);
  WizardForm.FinishedLabel.Top := ScaleY(150);

  // 欢迎/完成页为绝对定位，手动撑满并统一底色；完成页左位补品牌 logo
  WizardForm.WelcomePage.Color := $17110D;
  WizardForm.WelcomePage.Width := WizardForm.OuterNotebook.Width;
  WizardForm.WelcomePage.Height := WizardForm.OuterNotebook.Height;
  WizardForm.FinishedPage.Color := $17110D;
  WizardForm.FinishedPage.Width := WizardForm.OuterNotebook.Width;
  WizardForm.FinishedPage.Height := WizardForm.OuterNotebook.Height;

  LogoImg2 := TBitmapImage.Create(WizardForm);
  LogoImg2.Parent := WizardForm.FinishedPage;
  LogoImg2.Bitmap := Bmp;
  LogoImg2.Left := ScaleX(24);
  LogoImg2.Top := ScaleY(96);
  LogoImg2.Width := ScaleX(96);
  LogoImg2.Height := ScaleY(96);
  LogoImg2.Stretch := True;

  WizardForm.PageNameLabel.Font.Color := $F3EDE6;        // #e6edf3
  WizardForm.PageDescriptionLabel.Font.Color := $A19891; // #9198a1
  WizardForm.WelcomeLabel1.Font.Color := $F3EDE6;
  WizardForm.WelcomeLabel2.Font.Color := $A19891;
  WizardForm.StatusLabel.Font.Color := $A19891;
  WizardForm.FilenameLabel.Font.Color := $A19891;
  WizardForm.ReadyLabel.Font.Color := $A19891;
end;

// Inno 切页时会重新显示默认插画，每次切页后强制隐藏
procedure CurPageChanged(CurPageID: Integer);
begin
  WizardForm.WizardSmallBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage.Visible := False;
end;

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
Source: "..\assets\installer-logo.bmp"; DestDir: "{tmp}"; Flags: dontcopy
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
