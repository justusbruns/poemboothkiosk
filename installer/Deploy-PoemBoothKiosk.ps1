<#
.SYNOPSIS
    Unified PoemBooth Kiosk Deployment Script

.DESCRIPTION
    This script automates the complete deployment of PoemBooth Kiosk on a new Windows PC.
    It handles:
    - Certificate generation with secure credential handling
    - Application installation
    - Auto-start configuration
    - Windows kiosk mode setup
    - Security cleanup

.PARAMETER AssetTag
    Device asset tag (e.g., PB-005)

.PARAMETER HubId
    Hub UUID from the booking system

.PARAMETER SerialNumber
    Optional device serial number

.PARAMETER SupabaseUrl
    Supabase project URL (defaults to production)

.PARAMETER InstallerPath
    Path to PoemBooth Kiosk Setup.exe (defaults to ./dist/)

.PARAMETER SkipInstaller
    Skip running the installer (if app is already installed)

.PARAMETER AutoStartMethod
    Method for auto-start: TaskScheduler or StartupFolder (default: TaskScheduler)

.EXAMPLE
    .\Deploy-PoemBoothKiosk.ps1 -AssetTag "PB-005" -HubId "abc123-uuid"

.EXAMPLE
    .\Deploy-PoemBoothKiosk.ps1 -AssetTag "PB-010" -HubId "def456-uuid" -SerialNumber "SN-2025-010" -SkipInstaller

.NOTES
    Requires: Administrator privileges, Node.js, npm, OpenSSL
    Security: Service role key is prompted securely and never persisted to disk
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$AssetTag,

    [Parameter(Mandatory=$true)]
    [string]$HubId,

    [Parameter(Mandatory=$false)]
    [string]$SerialNumber = "",

    [Parameter(Mandatory=$false)]
    [string]$SupabaseUrl = "https://xtgxfighvyybzcxfimvs.supabase.co",

    [Parameter(Mandatory=$false)]
    [string]$InstallerPath = "",

    [Parameter(Mandatory=$false)]
    [switch]$SkipInstaller,

    [Parameter(Mandatory=$false)]
    [ValidateSet("TaskScheduler", "StartupFolder")]
    [string]$AutoStartMethod = "TaskScheduler"
)

#Requires -RunAsAdministrator

# Script configuration
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Colors for output
function Write-Success { param([string]$Message) Write-Host "✓ $Message" -ForegroundColor Green }
function Write-Info { param([string]$Message) Write-Host "ℹ $Message" -ForegroundColor Cyan }
function Write-Warning { param([string]$Message) Write-Host "⚠ $Message" -ForegroundColor Yellow }
function Write-Error { param([string]$Message) Write-Host "✗ $Message" -ForegroundColor Red }
function Write-Step { param([string]$Message) Write-Host "`n═══ $Message ═══`n" -ForegroundColor Magenta }

# Global paths
$Script:KioskInstallPath = "C:\Program Files\PoemBooth Kiosk"
$Script:KioskExePath = "$KioskInstallPath\PoemBooth Kiosk.exe"
$Script:CertPath = "C:\ProgramData\PoemBooth"
$Script:ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# ==============================================================================
# PREREQUISITE CHECKS
# ==============================================================================

function Test-Prerequisites {
    Write-Step "Checking Prerequisites"

    $allGood = $true

    # Check administrator
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Write-Success "Running as Administrator"
    } else {
        Write-Error "Must run as Administrator"
        $allGood = $false
    }

    # Check Node.js
    try {
        $nodeVersion = node --version 2>$null
        Write-Success "Node.js installed: $nodeVersion"
    } catch {
        Write-Error "Node.js not found. Please install from https://nodejs.org"
        $allGood = $false
    }

    # Check npm
    try {
        $npmVersion = npm --version 2>$null
        Write-Success "npm installed: $npmVersion"
    } catch {
        Write-Error "npm not found"
        $allGood = $false
    }

    # Check OpenSSL - also search common Win32OpenSSL install locations
    $opensslFound = $false
    try {
        $opensslVersion = & openssl version 2>$null
        if ($LASTEXITCODE -eq 0 -or $opensslVersion) {
            Write-Success "OpenSSL installed: $opensslVersion"
            $opensslFound = $true
        }
    } catch { }

    if (-not $opensslFound) {
        $commonPaths = @(
            "C:\Program Files\OpenSSL-Win64\bin",
            "C:\Program Files (x86)\OpenSSL-Win64\bin",
            "C:\OpenSSL-Win64\bin",
            "C:\Program Files\OpenSSL\bin",
            "C:\OpenSSL\bin"
        )
        foreach ($p in $commonPaths) {
            if (Test-Path "$p\openssl.exe") {
                $env:PATH = "$p;$env:PATH"
                $opensslVersion = & openssl version 2>$null
                Write-Success "OpenSSL found and added to PATH: $p"
                Write-Success "OpenSSL version: $opensslVersion"
                $opensslFound = $true
                break
            }
        }
    }

    if (-not $opensslFound) {
        Write-Warning "OpenSSL not found in PATH or common locations. Certificate generation will fail."
        Write-Info "Install OpenSSL from: https://slproweb.com/products/Win32OpenSSL.html"
    }

    # Check TypeScript (tsx) - check local node_modules in poemboothbooking (avoids hanging npx download)
    $bookingRoot = Split-Path (Split-Path $Script:ScriptRoot -Parent) -Parent
    $tsxBin = Join-Path $bookingRoot "poemboothbooking\node_modules\.bin\tsx.cmd"
    if (Test-Path $tsxBin) {
        Write-Success "TypeScript execution (tsx) available (local node_modules)"
    } else {
        Write-Info "tsx not found in local node_modules - run 'npm install' in poemboothbooking first"
    }

    if (-not $allGood) {
        throw "Prerequisites not met. Please install missing components."
    }
}

# ==============================================================================
# CERTIFICATE GENERATION
# ==============================================================================

function Invoke-CertificateGeneration {
    param(
        [string]$AssetTag,
        [string]$HubId,
        [string]$SerialNumber,
        [string]$SupabaseUrl,
        [securestring]$ServiceRoleKey
    )

    Write-Step "Generating Device Certificates"

    # Convert SecureString to plain text for environment variable (only in memory)
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($ServiceRoleKey)
    $serviceRoleKeyPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)

    try {
        # Set environment variables (only for this process)
        $env:NEXT_PUBLIC_SUPABASE_URL = $SupabaseUrl
        $env:SUPABASE_SERVICE_ROLE_KEY = $serviceRoleKeyPlain

        Write-Info "Supabase URL: $SupabaseUrl"
        Write-Info "Asset Tag: $AssetTag"
        Write-Info "Hub ID: $HubId"
        if ($SerialNumber) {
            Write-Info "Serial Number: $SerialNumber"
        }

        # Navigate to poemboothbooking directory (sibling of poemboothkiosk, two levels up from installer\)
        $bookingPath = Join-Path (Split-Path (Split-Path $Script:ScriptRoot -Parent) -Parent) "poemboothbooking"

        if (-not (Test-Path $bookingPath)) {
            throw "PoemBooth Booking system not found at: $bookingPath"
        }

        Write-Info "Using booking system at: $bookingPath"
        Push-Location $bookingPath

        # Ensure node_modules are installed (tsx must be present)
        if (-not (Test-Path ".\node_modules\.bin\tsx.cmd")) {
            Write-Info "node_modules not found - running npm install..."
            npm install --prefer-offline 2>&1 | Write-Host
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code: $LASTEXITCODE"
            }
            Write-Success "Dependencies installed"
        } else {
            Write-Success "node_modules already present"
        }

        # Build command
        # Build args as an array so PowerShell passes them as separate arguments
        $setupArgsList = @("--asset-tag=$AssetTag", "--hub-id=$HubId")
        if ($SerialNumber) {
            $setupArgsList += "--serial=$SerialNumber"
        }

        Write-Info "Running setup-device script..."
        Write-Info "Command: npm run setup-device -- $($setupArgsList -join ' ')"

        # Temporarily disable Stop on error so Node.js deprecation warnings
        # on stderr don't get treated as terminating errors by PowerShell
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = & npm run setup-device -- @setupArgsList 2>&1
        $npmExitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP

        if ($npmExitCode -ne 0) {
            Write-Host "--- setup-device output ---"
            $output | ForEach-Object { Write-Host $_ }
            Write-Host "---------------------------"
            throw "Certificate generation failed with exit code: $npmExitCode"
        }

        Write-Success "Certificates generated successfully"
        Write-Host $output

        # Find generated certificate files
        $certFile = Get-ChildItem -Path "$bookingPath\device-certs" -Filter "$AssetTag-cert.pem" -ErrorAction SilentlyContinue
        $keyFile = Get-ChildItem -Path "$bookingPath\device-certs" -Filter "$AssetTag-key.pem" -ErrorAction SilentlyContinue
        $caFile = Get-ChildItem -Path "$bookingPath\ca" -Filter "ca-cert.pem" -ErrorAction SilentlyContinue

        if (-not $certFile -or -not $keyFile -or -not $caFile) {
            throw "Certificate files not found after generation"
        }

        Pop-Location

        return @{
            CertFile = $certFile.FullName
            KeyFile = $keyFile.FullName
            CaFile = $caFile.FullName
        }

    } finally {
        # CRITICAL: Clear sensitive data from memory and environment
        if ($serviceRoleKeyPlain) {
            $serviceRoleKeyPlain = $null
        }
        Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()

        Pop-Location -ErrorAction SilentlyContinue
    }
}

# ==============================================================================
# CERTIFICATE INSTALLATION
# ==============================================================================

function Install-Certificates {
    param(
        [hashtable]$CertFiles
    )

    Write-Step "Installing Certificates"

    # Create PoemBooth directory
    if (-not (Test-Path $Script:CertPath)) {
        New-Item -ItemType Directory -Path $Script:CertPath -Force | Out-Null
        Write-Success "Created directory: $Script:CertPath"
    }

    # Copy certificates
    Write-Info "Copying certificates..."
    Copy-Item $CertFiles.CertFile -Destination "$Script:CertPath\device.crt" -Force
    Copy-Item $CertFiles.KeyFile -Destination "$Script:CertPath\device.key" -Force
    Copy-Item $CertFiles.CaFile -Destination "$Script:CertPath\ca.crt" -Force

    # Set permissions
    Write-Info "Setting permissions..."

    # Device key: SYSTEM and Administrators only (600-equivalent)
    icacls "$Script:CertPath\device.key" /inheritance:r | Out-Null
    icacls "$Script:CertPath\device.key" /grant:r "SYSTEM:(F)" | Out-Null
    icacls "$Script:CertPath\device.key" /grant:r "Administrators:(F)" | Out-Null

    # Device cert and CA cert: Users can read (644-equivalent)
    icacls "$Script:CertPath\device.crt" /grant "Users:(R)" | Out-Null
    icacls "$Script:CertPath\ca.crt" /grant "Users:(R)" | Out-Null

    Write-Success "Certificates installed with proper permissions"

    # Delete source certificate files (already copied to C:\ProgramData\PoemBooth)
    Write-Info "Deleting source certificate files..."
    Remove-Item $CertFiles.KeyFile -Force -ErrorAction SilentlyContinue
    Remove-Item $CertFiles.CertFile -Force -ErrorAction SilentlyContinue

    Write-Success "Source files deleted"
}

# ==============================================================================
# APPLICATION INSTALLATION
# ==============================================================================

function Install-KioskApplication {
    param([string]$InstallerPath)

    Write-Step "Installing PoemBooth Kiosk Application"

    # Find installer
    if (-not $InstallerPath) {
        $InstallerPath = Get-ChildItem -Path "$Script:ScriptRoot\..\" -Recurse -Filter "*PoemBooth*Setup*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($InstallerPath) {
            $InstallerPath = $InstallerPath.FullName
        }
    }

    if (-not $InstallerPath -or -not (Test-Path $InstallerPath)) {
        Write-Warning "Installer not found. Please specify path with -InstallerPath or place in dist folder"
        return $false
    }

    Write-Info "Found installer: $InstallerPath"
    Write-Info "Running installer..."

    # Run installer silently (NSIS /S flag)
    $process = Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait -PassThru

    if ($process.ExitCode -eq 0) {
        Write-Success "Application installed successfully"
        return $true
    } else {
        Write-Error "Installation failed with exit code: $($process.ExitCode)"
        return $false
    }
}

# ==============================================================================
# AUTO-START CONFIGURATION
# ==============================================================================

function Enable-AutoStart {
    param([string]$Method)

    Write-Step "Configuring Auto-Start ($Method)"

    if ($Method -eq "TaskScheduler") {
        # Task Scheduler method (recommended)
        Write-Info "Creating scheduled task..."

        $action = New-ScheduledTaskAction -Execute $Script:KioskExePath
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

        Register-ScheduledTask -TaskName "PoemBooth Kiosk" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

        Write-Success "Scheduled task created"

    } elseif ($Method -eq "StartupFolder") {
        # Startup folder method (simpler)
        Write-Info "Creating startup shortcut..."

        $startupPath = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
        $shortcutPath = "$startupPath\PoemBooth Kiosk.lnk"

        $WScriptShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WScriptShell.CreateShortcut($shortcutPath)
        $Shortcut.TargetPath = $Script:KioskExePath
        $Shortcut.WorkingDirectory = $Script:KioskInstallPath
        $Shortcut.Save()

        Write-Success "Startup shortcut created"
    }
}

# ==============================================================================
# WINDOWS KIOSK MODE CONFIGURATION
# ==============================================================================

function Enable-KioskMode {
    Write-Step "Configuring Windows for Kiosk Mode"

    # Disable Windows Update
    Write-Info "Disabling Windows Update..."
    Set-Service wuauserv -StartupType Disabled -ErrorAction SilentlyContinue
    Stop-Service wuauserv -Force -ErrorAction SilentlyContinue

    # Disable screen saver and sleep
    Write-Info "Disabling power management..."
    powercfg -change -monitor-timeout-ac 0
    powercfg -change -standby-timeout-ac 0
    powercfg -change -hibernate-timeout-ac 0

    # Disable Windows notifications
    Write-Info "Disabling notifications..."
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" /v ToastEnabled /t REG_DWORD /d 0 /f | Out-Null

    Write-Success "Windows configured for kiosk mode"
}

# ==============================================================================
# VALIDATION
# ==============================================================================

function Test-Installation {
    Write-Step "Validating Installation"

    $allGood = $true

    # Check certificates exist
    if (Test-Path "$Script:CertPath\device.crt") {
        Write-Success "Device certificate found"
    } else {
        Write-Error "Device certificate missing"
        $allGood = $false
    }

    if (Test-Path "$Script:CertPath\device.key") {
        Write-Success "Device private key found"
    } else {
        Write-Error "Device private key missing"
        $allGood = $false
    }

    if (Test-Path "$Script:CertPath\ca.crt") {
        Write-Success "CA certificate found"
    } else {
        Write-Error "CA certificate missing"
        $allGood = $false
    }

    # Check application installed
    if (Test-Path $Script:KioskExePath) {
        Write-Success "Kiosk application installed"
    } else {
        Write-Error "Kiosk application not found"
        $allGood = $false
    }

    # Check auto-start configured
    $task = Get-ScheduledTask -TaskName "PoemBooth Kiosk" -ErrorAction SilentlyContinue
    if ($task) {
        Write-Success "Auto-start configured (Task Scheduler)"
    } else {
        $startupShortcut = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\PoemBooth Kiosk.lnk"
        if (Test-Path $startupShortcut) {
            Write-Success "Auto-start configured (Startup Folder)"
        } else {
            Write-Warning "Auto-start not configured"
        }
    }

    return $allGood
}

# ==============================================================================
# SECURITY CLEANUP
# ==============================================================================

function Invoke-SecurityCleanup {
    Write-Step "Security Cleanup"

    # Clear PowerShell history
    Write-Info "Clearing PowerShell history..."
    Clear-History
    Remove-Item (Get-PSReadlineOption).HistorySavePath -ErrorAction SilentlyContinue

    # Clear environment variables
    Write-Info "Clearing environment variables..."
    Remove-Item Env:\NEXT_PUBLIC_SUPABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue

    # Force garbage collection
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
    [System.GC]::Collect()

    Write-Success "Security cleanup complete"
}

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

function Start-Deployment {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       PoemBooth Kiosk - Unified Deployment Script           ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    try {
        # Step 1: Prerequisites
        Test-Prerequisites

        # Step 2: Prompt for Supabase Service Role Key (SECURE)
        Write-Host ""
        Write-Warning "The Supabase Service Role Key is required for certificate generation."
        Write-Warning "This key will NOT be saved and will be removed from memory after use."
        Write-Host ""
        $serviceRoleKey = Read-Host "Enter Supabase Service Role Key" -AsSecureString

        # Step 3: Generate certificates
        $certFiles = Invoke-CertificateGeneration -AssetTag $AssetTag -HubId $HubId -SerialNumber $SerialNumber -SupabaseUrl $SupabaseUrl -ServiceRoleKey $serviceRoleKey

        # Step 4: Install certificates
        Install-Certificates -CertFiles $certFiles

        # Step 5: Install application (if not skipped)
        if (-not $SkipInstaller) {
            $installed = Install-KioskApplication -InstallerPath $InstallerPath
            if (-not $installed) {
                Write-Warning "Application installation failed or skipped. You may need to install manually."
            }
        } else {
            Write-Info "Skipping application installation (already installed)"
        }

        # Step 6: Configure auto-start
        Enable-AutoStart -Method $AutoStartMethod

        # Step 7: Configure Windows kiosk mode
        Enable-KioskMode

        # Step 8: Security cleanup
        Invoke-SecurityCleanup

        # Step 9: Validation
        $valid = Test-Installation

        # Final message
        Write-Host ""
        Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
        if ($valid) {
            Write-Host "║  ✓  Deployment Complete! PoemBooth Kiosk is ready to use.   ║" -ForegroundColor Green
        } else {
            Write-Host "║  ⚠  Deployment completed with warnings. Check logs above.   ║" -ForegroundColor Yellow
        }
        Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
        Write-Host ""
        Write-Info "The kiosk will start automatically on next boot."
        Write-Info "To start now, run: & '$Script:KioskExePath'"
        Write-Host ""

    } catch {
        Write-Host ""
        Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Red
        Write-Host "║  ✗  Deployment Failed!                                       ║" -ForegroundColor Red
        Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Red
        Write-Host ""
        Write-Error "Error: $_"
        Write-Host $_.ScriptStackTrace

        # Cleanup on failure
        Invoke-SecurityCleanup

        exit 1
    }
}

# Run deployment
Start-Deployment
