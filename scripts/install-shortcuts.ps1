<#
  install-shortcuts.ps1 — Pixel Pals Overlay

  Creates click-to-launch shortcuts so you never have to run "npm start":
    • Desktop                 → "Pixel Pals Overlay"
    • Start Menu (Programs)   → "Pixel Pals Overlay"

  Both point at the silent launcher (Launch Pixel Pals.vbs), so the app starts
  with no terminal window. Run this once:

      powershell -ExecutionPolicy Bypass -File .\scripts\install-shortcuts.ps1

  To remove the shortcuts later, pass -Uninstall.
#>
param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

# Repo root is the parent of this script's folder.
$appDir   = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $appDir 'Launch Pixel Pals.vbs'
$iconExe  = Join-Path $appDir 'node_modules\electron\dist\electron.exe'

$desktop   = [Environment]::GetFolderPath('Desktop')
$startMenu = [Environment]::GetFolderPath('Programs')

$targets = @(
  (Join-Path $desktop   'Pixel Pals Overlay.lnk'),
  (Join-Path $startMenu 'Pixel Pals Overlay.lnk')
)

if ($Uninstall) {
  foreach ($lnk in $targets) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Removed $lnk" }
  }
  Write-Host "Shortcuts removed." -ForegroundColor Green
  return
}

if (-not (Test-Path $launcher)) {
  throw "Launcher not found at $launcher"
}

$wsh = New-Object -ComObject WScript.Shell

foreach ($lnk in $targets) {
  $sc = $wsh.CreateShortcut($lnk)
  # Run the .vbs silently via wscript so no console window appears.
  $sc.TargetPath       = Join-Path $env:WINDIR 'System32\wscript.exe'
  $sc.Arguments        = '"' + $launcher + '"'
  $sc.WorkingDirectory = $appDir
  $sc.Description       = 'Pixel Pals Overlay - daily plan, to-dos, Pomodoro & lofi'
  if (Test-Path $iconExe) { $sc.IconLocation = "$iconExe,0" }
  $sc.Save()
  Write-Host "Created $lnk"
}

Write-Host ""
Write-Host "Done! Launch it from your Desktop or Start Menu - no 'npm start' needed." -ForegroundColor Green
Write-Host "Tip: in the tray menu, enable 'Start with Windows' to auto-launch at login." -ForegroundColor Cyan
