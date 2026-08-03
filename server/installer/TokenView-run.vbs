' TokenView launcher - run hidden without console window
' Launches TokenView.exe with data dir under %LOCALAPPDATA%\TokenView\data
' --log enables file logging (visible only via %LOCALAPPDATA%\TokenView\logs)
Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
exeDir = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\TokenView\data"
cmd = """" & exeDir & "\TokenView.exe"" --log --data-dir """ & dataDir & """"
ws.Run cmd, 0, False
