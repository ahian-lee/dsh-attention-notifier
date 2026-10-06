# apply-attention-overlay.ps1 — Shadow app dir + overlay patch for DeepSeek Harness
# ============================================================================
# What it does (all reversible):
#   1. Full-extracts resources\app.asar into resources\app.new  (unpacked merged in)
#   2. Appends the attention-overlay patch to lib\main.js and lib\preload-app.cjs
#      -> main process gains setOverlayIcon (taskbar digit) + flashFrame + native toasts
#      -> renderer gets window.dshAttentionLocal
#   3. Swaps: renames app.asar -> app.asar.orig (ORIGINAL, never modified), app.new -> app
#   Electron loads resources\app\ first when it exists; fuses confirmed:
#   asar integrity OFF, onlyLoadAppFromAsar OFF.
#
# RUN ONLY AFTER FULLY QUITTING DeepSeek Harness (system tray too).
# Usage:  powershell -File apply-attention-overlay.ps1 [-AppRoot "D:\DeepSeek Harness"] [-Node "path\to\node.exe"]
# Rollback: restore-attention-overlay.ps1
# ============================================================================
param(
  [string]$AppRoot = '',
  [string]$Node = ''
)
$ErrorActionPreference = 'Stop'
$kit = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- locate the installed app -------------------------------------------------
if (-not $AppRoot) {
  $candidates = @(
    'C:\Program Files\DeepSeek Harness',
    'C:\Program Files (x86)\DeepSeek Harness',
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'),
    'E:\dshdesktop'
  )
  $AppRoot = $candidates | Where-Object { Test-Path (Join-Path $_ 'resources\app.asar') } | Select-Object -First 1
}
if (-not $AppRoot -or -not (Test-Path (Join-Path $AppRoot 'resources\app.asar'))) {
  Write-Host '[abort] could not locate the app. Re-run with: -AppRoot "C:\path\to\DeepSeek Harness"' -ForegroundColor Red
  exit 1
}
$res      = Join-Path $AppRoot 'resources'
$asar     = Join-Path $res 'app.asar'
$asarOrig = Join-Path $res 'app.asar.orig'
$appNew   = Join-Path $res 'app.new'
$appDir   = Join-Path $res 'app'

if (-not $Node) {
  $bundled = Join-Path $res 'runtime\primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path $bundled) { $Node = $bundled }
  else { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
}
if (-not $Node -or -not (Test-Path $Node)) {
  Write-Host '[abort] node.exe not found (bundled runtime absent and not on PATH). Re-run with: -Node "C:\path\to\node.exe"' -ForegroundColor Red
  exit 1
}

# --- safety gates -------------------------------------------------------------
if (Get-Process | Where-Object { $_.ProcessName -like '*DeepSeek Harness*' }) {
  Write-Host '[abort] DeepSeek Harness is still running. Quit it completely (tray -> Quit), then rerun.' -ForegroundColor Red
  exit 1
}
if (Test-Path $asarOrig) { Write-Host '[abort] app.asar.orig exists — a patch is already applied (or leftovers). Run restore first.' -ForegroundColor Red; exit 1 }
if (Test-Path $appDir)   { Write-Host '[abort] resources\app already exists — refusing to touch it. Move it away first.' -ForegroundColor Red; exit 1 }
if (Test-Path $appNew)   { Remove-Item -Recurse -Force $appNew }

Write-Host "[info] AppRoot = $AppRoot" -ForegroundColor DarkGray
Write-Host "[info] node    = $Node" -ForegroundColor DarkGray

Write-Host '[1/4] extracting app.asar (full tree incl. unpacked merge, ~1-3 min)...' -ForegroundColor Cyan
& $node (Join-Path $kit 'asar-extract.mjs') $asar $appNew
if ($LASTEXITCODE -ne 0) { Write-Host '[abort] extraction failed; nothing moved.' -ForegroundColor Red; exit 1 }

Write-Host '[2/4] generating injections + patching lib\main.js + lib\preload-app.cjs...' -ForegroundColor Cyan
& $node (Join-Path $kit 'make-injections.mjs')
if ($LASTEXITCODE -ne 0) { Write-Host '[abort] injection generation failed; nothing moved.' -ForegroundColor Red; exit 1 }
& $node (Join-Path $kit 'patch-app-dir.mjs') $appNew
if ($LASTEXITCODE -ne 0) { Write-Host '[abort] patch failed; nothing moved.' -ForegroundColor Red; exit 1 }

Write-Host '[3/4] syntax-checking patched files...' -ForegroundColor Cyan
& $node --check (Join-Path $appNew 'lib\preload-app.cjs')
if ($LASTEXITCODE -ne 0) { Write-Host '[abort] patched preload-app.cjs does not parse.' -ForegroundColor Red; exit 1 }
# main.js is ESM: check via a temporary .mjs copy (extension forces module parsing).
$mainMjs = Join-Path $env:TEMP 'attention-overlay-main-check.mjs'
Copy-Item (Join-Path $appNew 'lib\main.js') $mainMjs -Force
& $node --check $mainMjs
$mainOk = $LASTEXITCODE -eq 0
Remove-Item $mainMjs -Force -ErrorAction SilentlyContinue
if (-not $mainOk) { Write-Host '[abort] patched lib/main.js does not parse as ESM.' -ForegroundColor Red; exit 1 }

Write-Host '[4/4] swapping: app.asar -> app.asar.orig ; app.new -> app ...' -ForegroundColor Cyan
Rename-Item $asar 'app.asar.orig'
Rename-Item $appNew 'app'
# NOTE: plain concatenation on purpose — the -f operator chokes on literal '{' in JSON.
$markerJson = '{"patch":"dsh-attention-overlay","version":2,"appliedUtc":"' + [DateTime]::UtcNow.ToString('o') + '"}'
Set-Content -Path (Join-Path $appDir '.attention-overlay.json') -Value $markerJson -NoNewline
Write-Host ''
Write-Host 'PATCH APPLIED. Start DeepSeek Harness.' -ForegroundColor Green
Write-Host '  - taskbar digit (white disc, black digit) appears when sessions wait or complete while you are away'
Write-Host '  - toasts now come from the native main-process channel'
Write-Host '  - rollback any time: quit app, run restore-attention-overlay.ps1'
Write-Host '  - CAVEAT: an app auto-update replaces app.asar but does NOT remove resources\app — after updating, run restore first if the app seems stuck on the old version.'
