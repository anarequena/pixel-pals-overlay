' Pixel Pals Overlay - silent launcher.
' Double-click this file (or a shortcut to it) to start the overlay without a
' terminal window. No need to run "npm start". It launches the bundled Electron
' runtime directly from this folder.
Option Explicit

Dim fso, shell, appDir, electronExe

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = appDir & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electronExe) Then
  MsgBox "Couldn't find Electron at:" & vbCrLf & electronExe & vbCrLf & vbCrLf & _
         "Run 'npm install' in this folder once, then try again.", _
         vbExclamation, "Pixel Pals Overlay"
  WScript.Quit 1
End If

shell.CurrentDirectory = appDir
' 0 = hidden window (Electron has no console UI anyway); False = don't wait.
shell.Run """" & electronExe & """ """ & appDir & """", 0, False
