Option Explicit
Dim shell, files, root, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File " & Chr(34) & root & "\Start KiCad.ps1" & Chr(34)
shell.Run command, 0, False
