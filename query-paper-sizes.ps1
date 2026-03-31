Add-Type -AssemblyName System.Drawing

# Find DNP printer
$printerName = (Get-Printer | Where-Object { $_.Name -like '*DNP*' -or $_.Name -like '*QW410*' -or $_.Name -like '*DP-QW410*' } | Select-Object -First 1).Name

if (-not $printerName) {
    Write-Host "No DNP printer found. Available printers:"
    Get-Printer | ForEach-Object { Write-Host "  - $($_.Name)" }
    exit 1
}

Write-Host "Printer: $printerName"
Write-Host ""

$pd = New-Object System.Drawing.Printing.PrintDocument
$pd.PrinterSettings.PrinterName = $printerName

Write-Host "Available Paper Sizes from printer driver:"
Write-Host "==========================================="
$pd.PrinterSettings.PaperSizes | ForEach-Object {
    $widthCm = [Math]::Round($_.Width / 100 * 2.54, 1)
    $heightCm = [Math]::Round($_.Height / 100 * 2.54, 1)
    Write-Host ("  {0,-25} {1,4} x {2,4} (hundredths)  =  {3,5} x {4,5} cm" -f $_.PaperName, $_.Width, $_.Height, $widthCm, $heightCm)
}

Write-Host ""
Write-Host "Target sizes for PoemBooth (POST-ROTATION dimensions):"
Write-Host "==========================================="
$targets = @(
    @{Name="10x15cm"; Width=422; Height=612; Rotate=$false},
    @{Name="10x10cm"; Width=422; Height=412; Rotate=$false},
    @{Name="10x7.5cm"; Width=422; Height=312; Rotate=$false},
    @{Name="10x5cm"; Width=422; Height=312; Rotate=$false},
    @{Name="5x10cm"; Width=422; Height=312; Rotate=$true},
    @{Name="7.5x10cm"; Width=422; Height=312; Rotate=$true},
    @{Name="15x10cm"; Width=422; Height=612; Rotate=$true}
)

foreach ($target in $targets) {
    $bestMatch = $null
    $bestDiff = [int]::MaxValue
    foreach ($size in $pd.PrinterSettings.PaperSizes) {
        $diff = [Math]::Abs($size.Width - $target.Width) + [Math]::Abs($size.Height - $target.Height)
        if ($diff -lt $bestDiff) {
            $bestDiff = $diff
            $bestMatch = $size
        }
    }

    $rotateStr = if ($target.Rotate) { "ROTATE" } else { "direct" }
    if ($bestMatch -and $bestDiff -lt 50) {
        Write-Host ("  {0,-10} [{1}] -> MATCHED: {2} (diff={3})" -f $target.Name, $rotateStr, $bestMatch.PaperName, $bestDiff)
    } else {
        Write-Host ("  {0,-10} [{1}] -> NO MATCH (best diff={2}, would use: {3})" -f $target.Name, $rotateStr, $bestDiff, $bestMatch.PaperName)
    }
}
