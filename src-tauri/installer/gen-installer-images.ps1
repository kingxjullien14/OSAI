# Generates the branded NSIS installer artwork from the OSAI dark palette.
# Run from anywhere: powershell -ExecutionPolicy Bypass -File gen-installer-images.ps1
# Outputs (24-bit BMP, what NSIS Modern UI wants):
#   sidebar.bmp  164x314  — welcome / finish left panel
#   header.bmp   150x57   — interior-page header banner
#
# Kept deliberately version-agnostic (no "v1.0.0" baked in) so cutting a release
# never means regenerating these. Echoes the in-app welcome: dark vertical
# gradient, a faint dot grid, an accent-gradient OSAI wordmark.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$accent     = [System.Drawing.Color]::FromArgb(232, 115, 44)   # brand orange
$accentLite = [System.Drawing.Color]::FromArgb(255, 168, 92)   # lighter tint (gradient top)
$bgTop      = [System.Drawing.Color]::FromArgb(18, 18, 24)
$bgBot      = [System.Drawing.Color]::FromArgb(8, 8, 10)
$muted      = [System.Drawing.Color]::FromArgb(150, 150, 160)
$faint      = [System.Drawing.Color]::FromArgb(96, 96, 108)

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgTop, $bgBot, 90)
  $g.FillRectangle($grad, $rect)
  return @($bmp, $g)
}

function Add-Glow($g, [int]$cx, [int]$cy, [int]$r, [int]$alpha) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
  $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $pgb.CenterColor = [System.Drawing.Color]::FromArgb($alpha, 232, 115, 44)
  $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 232, 115, 44))
  $g.FillPath($pgb, $path)
}

# Faint dot grid — the BMP echo of the in-app DotPattern. Very low alpha so it
# reads as texture, not noise, over the dark gradient.
function Add-DotGrid($g, [int]$w, [int]$h) {
  $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 150, 150, 160))
  for ($y = 14; $y -lt $h; $y += 17) {
    for ($x = 14; $x -lt $w; $x += 17) {
      $g.FillEllipse($dot, $x, $y, 2, 2)
    }
  }
  $dot.Dispose()
}

# Draw text with a horizontal accent gradient (lighter -> brand).
function Add-GradientWord($g, [string]$text, $font, [single]$x, [single]$y, [single]$wordW, [single]$wordH) {
  $rect = New-Object System.Drawing.RectangleF($x, $y, $wordW, $wordH)
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $accentLite, $accent, 35)
  $g.DrawString($text, $font, $br, (New-Object System.Drawing.PointF($x, $y)))
  $br.Dispose()
}

# ── sidebar 164x314 ──────────────────────────────────────────────────────────
$res = New-Canvas 164 314
$bmp = $res[0]; $g = $res[1]
Add-DotGrid $g 164 314
Add-Glow $g 20 30 175 82
Add-Glow $g 150 300 120 36
$wordFont = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Bold)
Add-GradientWord $g "OSAI" $wordFont 13 192 140 52
$rulePen = New-Object System.Drawing.Pen($accent, 2)
$g.DrawLine($rulePen, 17, 240, 58, 240)
$subFont = New-Object System.Drawing.Font("Segoe UI", 10)
$g.DrawString("command deck", $subFont, (New-Object System.Drawing.SolidBrush($muted)), (New-Object System.Drawing.PointF(16, 247)))
$footFont = New-Object System.Drawing.Font("Segoe UI", 8)
$g.DrawString("Jul.Nazz", $footFont, (New-Object System.Drawing.SolidBrush($faint)), (New-Object System.Drawing.PointF(17, 291)))
$g.Dispose()
$bmp.Save((Join-Path $PSScriptRoot "sidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

# ── header 150x57 ────────────────────────────────────────────────────────────
$res = New-Canvas 150 57
$bmp = $res[0]; $g = $res[1]
Add-Glow $g 8 8 70 50
$hFont = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
Add-GradientWord $g "OSAI" $hFont 11 16 62 26
$g.FillEllipse((New-Object System.Drawing.SolidBrush($accent)), 70, 25, 6, 6)
$g.Dispose()
$bmp.Save((Join-Path $PSScriptRoot "header.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

Write-Output "wrote sidebar.bmp + header.bmp"
