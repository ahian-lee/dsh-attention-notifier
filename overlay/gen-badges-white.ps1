# gen-badges-white.ps1 — regenerate the 10 overlay digit PNGs as WHITE disc +
# BLACK bold digit (+ grey ring for light taskbars). Writes badges/badges-b64.json
# (old red set backed up once to badges-b64-red.bak.json). Run with Windows
# PowerShell 5.1 (System.Drawing): powershell -File gen-badges-white.ps1
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$badgesDir = Join-Path $here 'badges'
New-Item -ItemType Directory $badgesDir -Force | Out-Null

$jsonPath = Join-Path $badgesDir 'badges-b64.json'
$redBak = Join-Path $badgesDir 'badges-b64-red.bak.json'
if ((Test-Path $jsonPath) -and -not (Test-Path $redBak)) { Copy-Item $jsonPath $redBak }

$map = [ordered]@{}
$labels = @('1','2','3','4','5','6','7','8','9','9+')
foreach ($label in $labels) {
  $size = 64
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # white disc + grey ring (visible on light taskbars too)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 130, 130, 130), 3)
  $g.FillEllipse($brush, 4, 4, 56, 56)
  $g.DrawEllipse($pen, 4, 4, 56, 56)

  # bold black digit, centred; smaller font for the 2-char "9+"
  $fontSize = if ($label.Length -gt 1) { 22 } else { 32 }
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, -1, $size, $size)   # -1px optical nudge
  $g.DrawString($label, $font, [System.Drawing.Brushes]::Black, $rect, $sf)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $map[$label] = [Convert]::ToBase64String($ms.ToArray())
  $ms.Dispose(); $bmp.Dispose(); $font.Dispose(); $brush.Dispose(); $pen.Dispose()
}
[System.IO.File]::WriteAllText($jsonPath, ($map | ConvertTo-Json -Compress))
Write-Host "white badges written: $jsonPath ($((Get-Item $jsonPath).Length) B, red set backup: $(Test-Path $redBak))"
