# Generates the app icon and tray icons (Windows PowerShell, System.Drawing).
# Usage:  powershell -ExecutionPolicy Bypass -File build\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Canvas([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

# App icon — gradient tile with three stacked bars (a "stack" of items)
function Draw-AppIcon([int]$size, [string]$out, [float]$pad) {
  $bmp, $g = New-Canvas $size
  $s = [float]$size
  $x0 = $s * $pad; $w = $s - 2 * $x0
  $bg = RoundRect $x0 $x0 $w $w ($w * 0.235)
  $c1 = [System.Drawing.Color]::FromArgb(255, 160, 107, 255)
  $c2 = [System.Drawing.Color]::FromArgb(255, 90, 56, 255)
  $rect = New-Object System.Drawing.RectangleF($x0, $x0, $w, $w)
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
  $g.FillPath($br, $bg)
  $alphas = @(255, 205, 140)
  $dot = [System.Drawing.Color]::FromArgb(255, 106, 69, 255)
  for ($i = 0; $i -lt 3; $i++) {
    $bx = $x0 + $w * 0.2; $bw = $w * 0.6; $bh = $w * 0.155
    $by = $x0 + $w * (0.235 + $i * 0.2)
    $bar = RoundRect $bx $by $bw $bh ($bh / 2)
    $wb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alphas[$i], 255, 255, 255))
    $g.FillPath($wb, $bar)
    $dr = $bh * 0.24
    $db = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]($alphas[$i] * 0.95), $dot.R, $dot.G, $dot.B))
    $g.FillEllipse($db, $bx + $bw - $bh * 0.5 - $dr, $by + $bh / 2 - $dr, $dr * 2, $dr * 2)
  }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

# Tray (monochrome template for macOS: black + alpha)
function Draw-Template([int]$size, [string]$out) {
  $bmp, $g = New-Canvas $size
  $s = [float]$size
  $alphas = @(255, 200, 140)
  for ($i = 0; $i -lt 3; $i++) {
    $bh = $s * 0.2; $by = $s * (0.12 + $i * 0.27)
    $bar = RoundRect ($s * 0.08) $by ($s * 0.84) $bh ($bh / 2)
    $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alphas[$i], 0, 0, 0))
    $g.FillPath($b, $bar)
  }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Item -ItemType Directory -Force (Join-Path $root 'assets') | Out-Null
Draw-AppIcon 1024 (Join-Path $root 'build\icon.png') 0.08
Draw-AppIcon 256 (Join-Path $root 'assets\icon.png') 0.04
Draw-AppIcon 32 (Join-Path $root 'assets\tray.png') 0.0
Draw-Template 16 (Join-Path $root 'assets\trayTemplate.png')
Draw-Template 32 (Join-Path $root 'assets\trayTemplate@2x.png')
Write-Output 'icons written'
