# restore-patched.ps1 — re-enable the patched app dir WITHOUT touching it.
# Situation this fixes: app.asar was renamed back while resources\app (patched)
# still exists. Electron then loads app.asar (unpatched) and the overlay bridge
# disappears. This script hides app.asar again so the patched directory loads.
# Unlike restore-attention-overlay.ps1, it NEVER deletes resources\app.
param([string]$AppRoot = 'E:\dshdesktop')
$ErrorActionPreference = 'Stop'
$res  = Join-Path $AppRoot 'resources'
$asar = Join-Path $res 'app.asar'
$orig = Join-Path $res 'app.asar.orig'
$app  = Join-Path $res 'app'

Write-Host "[info] AppRoot = $AppRoot"

if (Get-Process | Where-Object { $_.ProcessName -like '*DeepSeek Harness*' }) {
  Write-Host '[abort] DeepSeek Harness is still running. Quit it (tray -> Quit), then rerun.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $app)) {
  Write-Host '[abort] resources\app (the patched dir) is missing — run apply-attention-overlay.cmd instead.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $orig)) {
  if (Test-Path $asar) { Rename-Item $asar 'app.asar.orig'; Write-Host '[ok] app.asar -> app.asar.orig' }
  else { Write-Host '[info] app.asar already absent — patched dir will load.' }
} else {
  Write-Host "[info] app.asar.orig already exists" -ForegroundColor DarkGray
  if (Test-Path $asar) {
    Write-Host '[warn] both app.asar and app.asar.orig exist; removing the stale app.asar (original is kept as .orig)' -ForegroundColor Yellow
    Remove-Item $asar -Force
  }
}
Write-Host '[ok] patched app dir will be used. Starting DeepSeek Harness...' -ForegroundColor Green
Start-Process (Join-Path $AppRoot 'DeepSeek Harness.exe')
Write-Host 'done.'
