# PoemBooth Kiosk Startup Script
# Runs npm start with hidden window - no terminal visible over the kiosk app

Set-Location "C:\Users\Gebruiker\Desktop\poembooth\poemboothkiosk"

# Start npm start as a detached process with hidden window
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c npm start"
$psi.WorkingDirectory = "C:\Users\Gebruiker\Desktop\poembooth\poemboothkiosk"
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.CreateNoWindow = $true
$psi.UseShellExecute = $false

[System.Diagnostics.Process]::Start($psi) | Out-Null
