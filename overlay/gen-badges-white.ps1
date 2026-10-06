# gen-badges-white.ps1 — generate overlay digit icons for the attention patch.
# Three semantic sets (white disc, colored digit, grey ring) + legacy bundle:
#   badges\b1-b64.json       waiting-approval (white bg, red digit)
#   badges\b2-b64.json       waiting-answer   (white bg, amber digit)
#   badges\b3-b64.json       completion       (white bg, green digit)
#   badges\badges-b64.json   legacy v2 white/black bundle (rollback compat)
# Run with Windows PowerShell 5.1 (System.Drawing / GDI+):
#   powershell -NoProfile -ExecutionPolicy Bypass -File gen-badges-white.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bd = Join-Path $here 'badges'
New-Item -ItemType Directory $bd -Force | Out-Null

function New-Badge([string]$text, $bg, $fg) {
  $size = 64
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  $ringPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 130, 130, 130), 3)
  $g.FillEllipse($bgBrush, 4, 4, 56, 56)
  $g.DrawEllipse($ringPen, 4, 1.5, 56, 56)
  $px = 32
  if ($text -eq '9+') { $px = 22 }
  $font = New-Object System.Drawing.Font('Segoe UI', $px, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, -1, $size, $size)
  $fgBrush = New-Object System.Drawing.SolidBrush($fg)
  $g.DrawString($text, $font, $fgBrush, $rect, $format)
  $g.Dispose()
  return $bmp
}

$WHITE = [System.Drawing.Color]::White
$KINDS = [ordered]@{
  alert  = [System.Drawing.Color]::FromArgb(255, 209, 44, 37)
  answer = [System.Drawing.Color]::FromArgb(255, 176, 108, 0)
  done   = [System.Drawing.Color]::FromArgb(255, 15, 157, 88)
  legacy = [System.Drawing.Color]::Black
}

function Get-Bundle($fg) {
  $map = [ordered]@{}
  $labels = @('1','2','3','4','5','6','7','8','9','9+')
  foreach ($lab in $labels) {
    $pngLab = if ($lab -eq '9+') { '9+' } else { $lab }
    $b = New-Badge $pngLab $WHITE $fg
    $ms = New-Object System.IO.MemoryStream
    $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b.Dispose()
    $map[$lab] = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose()
  }
  return $map
}

$bundles = [ordered]@{
  'b1-b64.json'     = Get-Bundle $KINDS['alert']
  'b2-b64.json'     = Get-Bundle $KINDS['answer']
  'b3-b64.json'     = Get-Bundle $KINDS['done']
  'badges-b64.json' = Get-Bundle $KINDS['legacy']
}
foreach ($name in $bundles.Keys) {
  [IO.File]::WriteAllText((Join-Path $bd $name), ($bundles[$name] | ConvertTo-Json -Compress))
}
'bundles written:'
foreach ($name in $bundles.Keys) { "  $name  $((Get-Item (Join-Path $bd $name)).Length)B" }
