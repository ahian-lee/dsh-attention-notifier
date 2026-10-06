# restore-attention-overlay.ps1 — undo apply-attention-overlay.ps1
# Fully returns the install to pristine: deletes the shadow resources\app\ tree
# created by the apply script (marker-verified) and renames app.asar.orig back
# to app.asar. The original app.asar was never modified.
# RUN AFTER FULLY QUITTING DeepSeek Harness (system tray too).
# Usage: powershell -File restore-attention-overlay.ps1 [-AppRoot "D:\DeepSeek Harness"]
param([string]$AppRoot = '')
$ErrorActionPreference = 'Stop'

if (-not $AppRoot) {
  $candidates = @(
    'C:\Program Files\DeepSeek Harness',
    'C:\Program Files (x86)\DeepSeek Harness',
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
    'E:\dshdesktop'
  )
  $AppRoot = $candidates | Where-Object { Test-Path (Join-Path $_ 'resources') } | Select-Object -First 1
}
if (-not $AppRoot) { Write-Host '[abort] could not locate the app. Re-run with: -AppRoot "C:\path\to\DeepSeek Harness"' -ForegroundColor Red; exit 1 }

$res      = Join-Path $AppRoot 'resources'
$asar     = Join-Path $res 'app.asar'
$asarOrig = Join-Path $res 'app.asar.orig'
$appDir   = Join-Path $res 'app'

if (Get-Process | Where-Object { $_.ProcessName -like '*DeepSeek Harness*' }) {
  Write-Host '[abort] DeepSeek Harness is still running. Quit it completely first.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $asarOrig)) {
  Write-Host '[nothing to do] app.asar.orig not found — patch not applied.' -ForegroundColor Yellow
  exit 0
}
if (Test-Path $asar) {
  Write-Host '[abort] both app.asar AND app.asar.orig exist — unexpected state; inspect manually before deleting anything.' -ForegroundColor Red
  exit 1
}
if (Test-Path $appDir) {
  if (-not (Test-Path (Join-Path $appDir '.attention-overlay.json'))) {
    Write-Host '[abort] resources\app has no .attention-overlay.json marker — refusing to delete a tree we did not create.' -ForegroundColor Red
    exit 1
  }
  Write-Host '[1/2] deleting shadow resources\app ...' -ForegroundColor Cyan
  Remove-Item -Recurse -Force $appDir
} else {
  Write-Host '[1/2] resources\app already absent' -ForegroundColor Yellow
}
Write-Host '[2/2] renaming app.asar.orig -> app.asar ...' -ForegroundColor Cyan
Rename-Item $asarOrig 'app.asar'
Write-Host 'RESTORED. Start DeepSeek Harness for the stock app.' -ForegroundColor Green
