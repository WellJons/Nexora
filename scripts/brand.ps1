param([string]$OutputDir = (Join-Path $PSScriptRoot '..\dist\branding'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
New-Item -Force -ItemType Directory -Path $OutputDir | Out-Null
function Color([string]$v){[Drawing.ColorTranslator]::FromHtml($v)}
function Brush([string]$v){[Drawing.SolidBrush]::new((Color $v))}
function Logo($g,[float]$x,[float]$y,[float]$s){
  $pen=[Drawing.Pen]::new((Color '#C2A5FF'),$s*.095)
  $pen.StartCap=[Drawing.Drawing2D.LineCap]::Round; $pen.EndCap=[Drawing.Drawing2D.LineCap]::Round; $pen.LineJoin=[Drawing.Drawing2D.LineJoin]::Round
  $points=[Drawing.PointF[]]@([Drawing.PointF]::new($x+$s*.18,$y+$s*.8),[Drawing.PointF]::new($x+$s*.18,$y+$s*.2),[Drawing.PointF]::new($x+$s*.82,$y+$s*.8),[Drawing.PointF]::new($x+$s*.82,$y+$s*.2))
  $g.DrawLines($pen,$points);$g.DrawLines($pen,[Drawing.PointF[]]@([Drawing.PointF]::new($x+$s*.18,$y+$s*.2),[Drawing.PointF]::new($x+$s*.5,$y+$s*.48),[Drawing.PointF]::new($x+$s*.82,$y+$s*.2)));$pen.Dispose()
}
function Canvas([int]$w,[int]$h){
  $b=[Drawing.Bitmap]::new($w,$h);$g=[Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias;$g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $bg=[Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Rectangle]::new(0,0,$w,$h),(Color '#15151F'),(Color '#39284E'),45)
  $g.FillRectangle($bg,0,0,$w,$h);$bg.Dispose()
  return @($b,$g)
}
function Text($g,$value,$size,$color,$x,$y,$style){
  $font=[Drawing.Font]::new('Segoe UI',[float]$size,$style,[Drawing.GraphicsUnit]::Pixel);$br=Brush $color
  $g.DrawString($value,$font,$br,[Drawing.PointF]::new($x,$y));$font.Dispose();$br.Dispose()
}
$canvas=Canvas 384 720;$b=$canvas[0];$g=$canvas[1]
$pen=[Drawing.Pen]::new((Color '#54436E'),1.4)
for($i=0;$i -lt 11;$i++){$g.DrawLine($pen,0,330+$i*36,384,120+$i*36)}
$pen.Dispose();$ring=[Drawing.Pen]::new((Color '#72558F'),2.0)
for($i=0;$i -lt 4;$i++){$r=76+$i*22;$g.DrawEllipse($ring,192-$r,376-$r,$r*2,$r*2)}
$ring.Dispose();Logo $g 46 65 125
Text $g 'NEXORA' 45 '#F5F0FF' 40 208 ([Drawing.FontStyle]::Bold)
Text $g 'PLAY YOUR WAY' 20 '#C1A9EE' 44 270 ([Drawing.FontStyle]::Regular)
Text $g 'GAMES  /  MODS' 20 '#D6C5F7' 44 571 ([Drawing.FontStyle]::Bold)
Text $g 'TRAINERS  /  TRANSLATE' 18 '#D6C5F7' 44 606 ([Drawing.FontStyle]::Regular)
Text $g 'WINDOWS / GAME CENTER' 15 '#A99ABF' 44 660 ([Drawing.FontStyle]::Regular)
$g.Dispose();$b.Save((Join-Path $OutputDir 'wizard.png'),[Drawing.Imaging.ImageFormat]::Png);$b.Dispose()
$canvas=Canvas 128 128;$b=$canvas[0];$g=$canvas[1];Logo $g 14 14 100;$g.Dispose();$b.Save((Join-Path $OutputDir 'small.png'),[Drawing.Imaging.ImageFormat]::Png);$b.Dispose()
# Multi-size ICO with PNG payloads, for both Setup and application.
$images=@()
foreach($size in @(16,32,48,64,128,256)){
  $canvas=Canvas $size $size;$b=$canvas[0];$g=$canvas[1];Logo $g ($size*.12) ($size*.12) ($size*.76);$g.Dispose()
  $mem=[IO.MemoryStream]::new();$b.Save($mem,[Drawing.Imaging.ImageFormat]::Png);$images+= [pscustomobject]@{Size=$size;Bytes=$mem.ToArray()};$mem.Dispose();$b.Dispose()
}
$stream=[IO.File]::Create((Join-Path $OutputDir 'nexora.ico'));$writer=[IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count);$offset=6+16*$images.Count
foreach($im in $images){$size=$im.Size;$bytes=[byte[]]$im.Bytes;$dim=if($size -eq 256){0}else{$size};$writer.Write([byte]$dim);$writer.Write([byte]$dim);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]$offset);$offset+=$bytes.Length}
foreach($im in $images){$writer.Write([byte[]]$im.Bytes)};$writer.Dispose()
