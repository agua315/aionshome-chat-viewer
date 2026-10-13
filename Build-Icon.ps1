# 把查看器现有的绿色书本标志绘制为 Windows ICO。
# ICO 内含多个尺寸，桌面大小和任务栏大小都能保持清晰。
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot 'public'
$iconSizes = @(16, 24, 32, 48, 64, 128, 256)
$iconImages = @()

foreach ($iconSize in $iconSizes) {
    $iconBitmap = [System.Drawing.Bitmap]::new($iconSize, $iconSize)
    $iconGraphics = [System.Drawing.Graphics]::FromImage($iconBitmap)
    $iconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $iconGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $iconGraphics.Clear([System.Drawing.Color]::Transparent)
    $iconGraphics.ScaleTransform(($iconSize / 64.0), ($iconSize / 64.0))
    $iconGreen = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#246b56'))
    $iconWhite = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#f8f8ef'))

    # 圆角底色保持透明外缘，不使用系统的默认问号图标。
    $tilePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $tilePath.AddArc(0, 0, 30, 30, 180, 90)
    $tilePath.AddArc(34, 0, 30, 30, 270, 90)
    $tilePath.AddArc(34, 34, 30, 30, 0, 90)
    $tilePath.AddArc(0, 34, 30, 30, 90, 90)
    $tilePath.CloseFigure()
    $iconGraphics.FillPath($iconGreen, $tilePath)

    # 书页和书脊使用与网页标志一致的轮廓。
    $bookPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $bookPath.AddLine(17, 16, 42, 16)
    $bookPath.AddBezier(42, 16, 45.3, 16, 48, 18.7, 48, 22)
    $bookPath.AddLine(48, 22, 48, 44)
    $bookPath.AddLine(48, 44, 23, 44)
    $bookPath.AddBezier(23, 44, 19.7, 44, 17, 46, 17, 48)
    $bookPath.AddLine(17, 48, 17, 16)
    $bookPath.CloseFigure()
    $iconGraphics.FillPath($iconWhite, $bookPath)
    $spinePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $spinePath.AddBezier(17, 48, 17, 44.7, 19.7, 42, 23, 42)
    $spinePath.AddLine(23, 42, 48, 42)
    $spinePath.AddLine(48, 42, 48, 49)
    $spinePath.AddLine(48, 49, 23, 49)
    $spinePath.AddBezier(23, 49, 19.7, 49, 17, 48.8, 17, 48)
    $spinePath.CloseFigure()
    $iconGraphics.FillPath($iconWhite, $spinePath)
    $linePen = [System.Drawing.Pen]::new($iconGreen, 3)
    $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $iconGraphics.DrawLine($linePen, 25, 25, 40, 25)
    $iconGraphics.DrawLine($linePen, 25, 32, 36, 32)
    $spinePen = [System.Drawing.Pen]::new($iconGreen, 1.3)
    $iconGraphics.DrawLine($spinePen, 23, 43, 48, 43)

    $pngStream = [System.IO.MemoryStream]::new()
    $iconBitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $iconImages += ,([byte[]]$pngStream.ToArray())
    if ($iconSize -eq 256) {
        $iconBitmap.Save((Join-Path $iconDirectory 'icon-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $pngStream.Dispose()
    $spinePen.Dispose()
    $linePen.Dispose()
    $spinePath.Dispose()
    $bookPath.Dispose()
    $tilePath.Dispose()
    $iconGreen.Dispose()
    $iconWhite.Dispose()
    $iconGraphics.Dispose()
    $iconBitmap.Dispose()
}

# Windows 图标目录后依次写入各尺寸的 PNG 数据；256 用 0 表示。
$icoStream = [System.IO.MemoryStream]::new()
$icoWriter = [System.IO.BinaryWriter]::new($icoStream)
$icoWriter.Write([uint16]0)
$icoWriter.Write([uint16]1)
$icoWriter.Write([uint16]$iconSizes.Count)
$imageOffset = 6 + 16 * $iconSizes.Count
for ($iconIndex = 0; $iconIndex -lt $iconSizes.Count; $iconIndex++) {
    $storedSize = if ($iconSizes[$iconIndex] -eq 256) { 0 } else { $iconSizes[$iconIndex] }
    $icoWriter.Write([byte]$storedSize)
    $icoWriter.Write([byte]$storedSize)
    $icoWriter.Write([byte]0)
    $icoWriter.Write([byte]0)
    $icoWriter.Write([uint16]1)
    $icoWriter.Write([uint16]32)
    $icoWriter.Write([uint32]$iconImages[$iconIndex].Length)
    $icoWriter.Write([uint32]$imageOffset)
    $imageOffset += $iconImages[$iconIndex].Length
}
foreach ($iconImage in $iconImages) { $icoWriter.Write([byte[]]$iconImage) }
$icoWriter.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $iconDirectory 'chat-viewer.ico'), $icoStream.ToArray())
$icoWriter.Dispose()
$icoStream.Dispose()
