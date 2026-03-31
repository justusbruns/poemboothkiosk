# PoemBooth Kiosk - Quick Deployment Guide

This guide helps you deploy PoemBooth Kiosk on a new Windows PC in **under 10 minutes**.

## Prerequisites

Before you begin, ensure you have:

- [ ] **Windows PC** (Windows 10/11, 64-bit)
- [ ] **Administrator access**
- [ ] **PoemBooth Kiosk installer** (`PoemBooth Kiosk Setup 1.0.0.exe`)
- [ ] **Both repositories** (poemboothkiosk and poemboothbooking)
- [ ] **Device information** (Asset Tag, Hub ID from booking system)
- [ ] **Supabase Service Role Key** (provided by system administrator)
- [ ] **Internet connection**

### Software Dependencies

The deployment script will check for these. Install if missing:

1. **Node.js** (v18 or later)
   - Download: https://nodejs.org
   - Choose "LTS" version
   - Include npm in installation

2. **OpenSSL** (for certificate generation)
   - Download: https://slproweb.com/products/Win32OpenSSL.html
   - Choose "Win64 OpenSSL v3.x.x" (not "Light")
   - Add to PATH during installation

### Repository Structure Requirement

**CRITICAL:** The deployment system requires **BOTH** repositories to be available:

```
Parent Directory/
├── poemboothkiosk/          # This repository (kiosk application)
│   ├── BuildBooth.bat
│   ├── installer/
│   │   └── Deploy-PoemBoothKiosk.ps1
│   └── dist/
│       └── PoemBooth Kiosk Setup 1.0.0.exe
└── poemboothbooking/        # Booking system repository (REQUIRED!)
    ├── scripts/
    │   └── setup-device.ts   # Certificate generation script
    ├── device-certs/          # Generated certificates stored here
    ├── ca/                    # Certificate authority files
    └── package.json
```

**Why both repositories are needed:**
- `poemboothkiosk` contains the kiosk application and deployment scripts
- `poemboothbooking` contains the certificate generation infrastructure (CA keys, signing scripts)
- The deployment script automatically calls `npm run setup-device` in the booking system

**Setup Steps (if cloning from git):**

```bash
# Create parent directory
mkdir PoemBooth
cd PoemBooth

# Clone both repositories
git clone https://github.com/yourusername/poemboothkiosk.git
git clone https://github.com/yourusername/poemboothbooking.git

# Install dependencies in booking system (REQUIRED for certificate generation)
cd poemboothbooking
npm install
cd ..

# Optional: Install dependencies in kiosk (only needed if building from source)
cd poemboothkiosk
npm install  # Only if you need to build the installer
```

**For USB deployment:** Copy BOTH repository folders to your USB drive maintaining the same folder structure.

## Deployment Methods

### Method 1: All-in-One Deployment (Recommended)

**Use this for:** Fresh PC setup with certificate generation

**Time:** ~5-10 minutes

**Prerequisites:** Ensure both `poemboothkiosk` and `poemboothbooking` repositories are available (see Repository Structure Requirement above).

1. **Verify repository structure**
   ```powershell
   # Check both repos exist in the same parent folder
   Test-Path ".\poemboothkiosk\BuildBooth.bat"
   Test-Path "..\poemboothbooking\scripts\setup-device.ts"

   # Both should return "True" - if not, check your folder structure
   ```

2. **Open PowerShell as Administrator**
   - Right-click Start Menu → "Windows PowerShell (Admin)" or "Terminal (Admin)"

3. **Navigate to poemboothkiosk directory**
   ```powershell
   cd C:\Deployment\poemboothkiosk
   # Or from USB: cd E:\poemboothkiosk
   ```

4. **Run deployment script**
   ```powershell
   .\installer\Deploy-PoemBoothKiosk.ps1 `
       -AssetTag "PB-005" `
       -HubId "your-hub-uuid-here"
   ```

5. **Enter Supabase Service Role Key when prompted**
   - Paste the key (it will be masked for security)
   - Press Enter

6. **Wait for completion** (5-10 minutes)
   - Script will:
     - ✓ Check prerequisites
     - ✓ Generate device certificates
     - ✓ Install certificates
     - ✓ Install kiosk application
     - ✓ Configure auto-start
     - ✓ Set up Windows kiosk mode
     - ✓ Validate installation
     - ✓ Clean up sensitive data

7. **Reboot**
   ```powershell
   Restart-Computer
   ```
   - Kiosk will start automatically on boot

### Method 2: Manual Installation

**Use this for:** Advanced users, troubleshooting, or custom deployment workflows

**Note:** This method requires manual certificate generation using the booking system separately. For automated certificate generation, use Method 1 or Method 3 instead.

#### Step 1: Install Application

1. Run installer:
   ```powershell
   # Use the actual installer filename (with version number)
   .\dist\PoemBooth Kiosk Setup 1.0.0.exe
   ```

2. Application installs to:
   - Default location: `C:\Program Files\PoemBooth Kiosk`
   - Installs silently (no GUI) if run with `/S` flag

#### Step 2: Generate and Install Certificates

**Important:** The `BuildBooth.bat` and `Deploy-PoemBoothKiosk.ps1` scripts automatically handle certificate generation. This manual method is only for advanced scenarios.

**Option A: Generate certificates using the booking system**

```powershell
# Navigate to booking system repository
cd ..\poemboothbooking

# Run certificate generation
npm run setup-device -- --asset-tag PB-005 --hub-id <hub-uuid>

# Certificates will be created in: device-certs/<asset-tag>/
```

**Option B: Manual certificate installation (with pre-generated certificates)**

1. Create certificate directory:
   ```powershell
   New-Item -ItemType Directory -Path "C:\ProgramData\PoemBooth" -Force
   ```

2. Copy certificates (from USB or network):
   ```powershell
   Copy-Item "E:\poembooth-certs\device.crt" -Destination "C:\ProgramData\PoemBooth\device.crt"
   Copy-Item "E:\poembooth-certs\device.key" -Destination "C:\ProgramData\PoemBooth\device.key"
   Copy-Item "E:\poembooth-certs\ca.crt" -Destination "C:\ProgramData\PoemBooth\ca.crt"
   ```

3. Set permissions:
   ```powershell
   icacls "C:\ProgramData\PoemBooth\device.key" /inheritance:r
   icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "SYSTEM:(F)"
   icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "Administrators:(F)"
   icacls "C:\ProgramData\PoemBooth\device.crt" /grant "Users:(R)"
   icacls "C:\ProgramData\PoemBooth\ca.crt" /grant "Users:(R)"
   ```

#### Step 3: Configure Auto-Start

**Option A: Task Scheduler (Recommended)**

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\PoemBooth Kiosk\PoemBooth Kiosk.exe"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "PoemBooth Kiosk" -Action $action -Trigger $trigger -Principal $principal
```

**Option B: Startup Folder (Simpler)**

```powershell
$shortcut = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\PoemBooth Kiosk.lnk"
$target = "C:\Program Files\PoemBooth Kiosk\PoemBooth Kiosk.exe"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($shortcut)
$Shortcut.TargetPath = $target
$Shortcut.Save()
```

### Method 3: USB Deployment (Recommended for Multiple Devices)

**Use this for:** Field deployments, workshop pre-configuration, maintaining version consistency

**Why USB deployment:**
- ✅ **Version control** - Ensure all devices use the same tested version
- ✅ **Offline deployment** - No git clone or internet needed during setup
- ✅ **Repository updates** - Easy to update USB with latest code changes
- ✅ **Consistency** - Same deployment package for all devices
- ✅ **Portability** - Deploy anywhere without network access

**Time:** ~5-10 minutes per device (after USB preparation)

#### Step 1: Prepare USB Drive (One-Time Setup)

1. **Format USB drive** (16GB+ recommended)
   - Format as NTFS for large files
   - Label as "PoemBooth Deploy"

2. **Copy both repositories to USB:**
   ```
   USB Drive (E:\)
   ├── poemboothkiosk\
   │   ├── BuildBooth.bat
   │   ├── installer\
   │   │   └── Deploy-PoemBoothKiosk.ps1
   │   ├── dist\
   │   │   └── PoemBooth Kiosk Setup 1.0.0.exe
   │   ├── src\
   │   └── ... (all repo files)
   └── poemboothbooking\
       ├── scripts\
       │   └── setup-device.ts
       ├── ca\
       ├── device-certs\
       └── ... (all repo files)
   ```

3. **Ensure npm dependencies installed:**
   ```bash
   # On your development machine, before copying to USB
   cd poemboothbooking
   npm install
   ```

4. **Verify installer is built:**
   ```bash
   # If not present, build the installer first
   cd poemboothkiosk
   npm run build:win
   ```

#### Step 2: Deploy to Target PC (Repeat for Each Device)

1. **Connect USB drive to target PC**

2. **Copy to local disk** (optional but faster):
   ```powershell
   # Copy both repos to C:\Deployment
   New-Item -ItemType Directory -Path "C:\Deployment" -Force
   Copy-Item -Path "E:\poemboothkiosk" -Destination "C:\Deployment\poemboothkiosk" -Recurse
   Copy-Item -Path "E:\poemboothbooking" -Destination "C:\Deployment\poemboothbooking" -Recurse
   ```

3. **Run deployment** (from copied location or directly from USB):
   ```powershell
   cd C:\Deployment\poemboothkiosk
   # Or: cd E:\poemboothkiosk

   .\BuildBooth.bat
   ```

4. **Enter device information when prompted:**
   - Asset Tag (e.g., PB-005)
   - Hub ID (UUID from booking system)
   - Serial Number (optional)
   - Supabase Service Role Key (masked input)

5. **Wait for completion** (5-10 minutes)

6. **Reboot:**
   ```powershell
   Restart-Computer
   ```

#### Step 3: Cleanup

After successful deployment and testing:
- Delete `C:\Deployment` folder (if you copied locally)
- Remove USB drive
- Device is ready for shipment

#### Updating Your USB Deployment Package

When you have code updates:

```bash
# On your development machine
cd /path/to/poemboothkiosk
git pull origin main
npm run build:win  # Rebuild installer with updates

cd /path/to/poemboothbooking
git pull origin main
npm install  # Update dependencies if needed

# Copy updated repos to USB
robocopy poemboothkiosk E:\poemboothkiosk /MIR /XD node_modules .git
robocopy poemboothbooking E:\poemboothbooking /MIR /XD .git
```

This ensures all devices deployed from your USB use the latest stable version.

## Deployment Script Options

### Basic Usage

```powershell
.\installer\Deploy-PoemBoothKiosk.ps1 -AssetTag "PB-XXX" -HubId "uuid"
```

### Advanced Options

```powershell
.\installer\Deploy-PoemBoothKiosk.ps1 `
    -AssetTag "PB-010" `
    -HubId "abc123-def456-uuid" `
    -SerialNumber "SN-2025-010" `
    -SupabaseUrl "https://custom.supabase.co" `
    -InstallerPath ".\dist\PoemBooth Kiosk Setup.exe" `
    -SkipInstaller `
    -AutoStartMethod "StartupFolder"
```

### Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `-AssetTag` | Yes | Device asset tag (e.g., PB-005) | - |
| `-HubId` | Yes | Hub UUID from booking system | - |
| `-SerialNumber` | No | Device serial number | "" |
| `-SupabaseUrl` | No | Supabase project URL | Production URL |
| `-InstallerPath` | No | Path to installer .exe | Auto-detect in ./dist/ |
| `-SkipInstaller` | No | Skip running installer (if already installed) | False |
| `-AutoStartMethod` | No | Auto-start method: TaskScheduler or StartupFolder | TaskScheduler |

## Verification

### Check Installation

1. **Verify certificates installed:**
   ```powershell
   Test-Path "C:\ProgramData\PoemBooth\device.crt"
   Test-Path "C:\ProgramData\PoemBooth\device.key"
   Test-Path "C:\ProgramData\PoemBooth\ca.crt"
   ```

2. **Verify application installed:**
   ```powershell
   Test-Path "C:\Program Files\PoemBooth Kiosk\PoemBooth Kiosk.exe"
   ```

3. **Verify auto-start configured:**
   ```powershell
   Get-ScheduledTask -TaskName "PoemBooth Kiosk"
   ```

### Test Launch

**Manual test (before auto-start):**
```powershell
& "C:\Program Files\PoemBooth Kiosk\PoemBooth Kiosk.exe"
```

Expected behavior:
- App launches in fullscreen
- Loading screen appears
- Connects to backend and fetches config
- Camera initializes
- Main booth screen appears

### First Boot Workflow

1. **If WiFi connection needed:**
   - App shows WiFi QR scanner
   - Hub manager scans WiFi QR code from admin portal
   - Device connects automatically

2. **Device registration:**
   - App reads certificates from `C:\ProgramData\PoemBooth`
   - Calls backend `/api/devices/register` with certificate
   - Backend validates and returns device config

3. **Ready for use:**
   - Main booth screen appears
   - Guests can start taking photos

## Troubleshooting

### PoemBooth Booking System Not Found

**Symptom:** Error message: `"PoemBooth Booking system not found at: C:\...\poemboothbooking"`

**Cause:** The deployment script requires BOTH repositories to be present as siblings.

**Solution:**
1. Verify folder structure:
   ```powershell
   # From poemboothkiosk directory
   Test-Path "..\poemboothbooking\scripts\setup-device.ts"
   ```
2. If False, clone/copy the poemboothbooking repository:
   ```bash
   cd ..
   git clone https://github.com/yourusername/poemboothbooking.git
   # Or copy from USB: Copy-Item E:\poemboothbooking -Destination . -Recurse
   ```
3. Install npm dependencies in booking system:
   ```bash
   cd poemboothbooking
   npm install
   ```
4. Return to poemboothkiosk and retry deployment

### npm Dependencies Missing in Booking System

**Symptom:** Error during certificate generation: `"Cannot find module..."` or `"setup-device script failed"`

**Cause:** npm dependencies not installed in the poemboothbooking repository

**Solution:**
```powershell
cd ..\poemboothbooking
npm install
cd ..\poemboothkiosk
# Retry deployment
```

### Certificate Generation Fails

**Symptom:** "OpenSSL not found" or "Certificate generation failed"

**Solution:**
1. Install OpenSSL from https://slproweb.com/products/Win32OpenSSL.html
2. Add OpenSSL to PATH: `C:\Program Files\OpenSSL-Win64\bin`
3. Verify OpenSSL is accessible:
   ```powershell
   openssl version
   ```
4. Restart PowerShell and retry

### Application Not Installing

**Symptom:** "Installer not found" or installation fails silently

**Solution:**
1. Verify installer exists:
   ```powershell
   Test-Path ".\dist\PoemBooth Kiosk Setup 1.0.0.exe"
   # Or search: Get-ChildItem -Recurse -Filter "*PoemBooth*Setup*.exe"
   ```
2. Run installer manually:
   ```powershell
   & ".\dist\PoemBooth Kiosk Setup 1.0.0.exe"
   ```
3. Check installer logs in: `%TEMP%\squirrel-installer.log`

### Auto-Start Not Working

**Symptom:** Kiosk doesn't start on boot

**Solution:**
1. Check Task Scheduler:
   ```powershell
   Get-ScheduledTask -TaskName "PoemBooth Kiosk" | Format-List *
   ```
2. Verify task is enabled and runs as SYSTEM
3. Test task manually:
   ```powershell
   Start-ScheduledTask -TaskName "PoemBooth Kiosk"
   ```

### Device Registration Fails

**Symptom:** "Device certificates not found" or "Registration failed"

**Solution:**
1. Verify certificates exist and have correct permissions
2. Check certificate validity:
   ```powershell
   openssl x509 -in "C:\ProgramData\PoemBooth\device.crt" -noout -dates
   ```
3. Verify backend connectivity:
   ```powershell
   Invoke-WebRequest -Uri "https://book.poembooth.com/api/health"
   ```

### Camera Not Detected

**Symptom:** "Camera not found" error in kiosk

**Solution:**
1. Check camera is connected and working
2. Grant camera permissions in Windows Settings
3. Test camera: `Start ms-settings:privacy-webcam`

## Security Best Practices

### During Deployment

- ✓ Use secure, private WiFi (not public networks)
- ✓ Service role key is entered once and never persisted
- ✓ PowerShell history is cleared automatically
- ✓ Source certificate files are securely wiped after installation

### After Deployment

- ✓ Remove USB drives containing certificates
- ✓ Store CA private key in encrypted vault (offline backup)
- ✓ Never share device private keys
- ✓ Regular security updates for Windows

### Certificate Management

- **CA Certificate:** Valid for 10 years (configurable), back up securely
- **Device Certificate:** Valid for 10 years (configurable), regenerate if compromised
- **Service Role Key:** Only technicians should have access, rotate periodically

**Note:** Certificate validity is configured in the booking system setup script. Default is 10 years but can be adjusted based on security policy.

## Deployment Checklist

Use this checklist for each new device:

### Pre-Deployment
- [ ] Windows 10/11 installed and updated
- [ ] Node.js installed (v18+)
- [ ] OpenSSL installed
- [ ] Internet connection available
- [ ] **Both repositories available** (poemboothkiosk and poemboothbooking)
- [ ] npm dependencies installed in poemboothbooking (`npm install`)
- [ ] Device information ready (Asset Tag, Hub ID)
- [ ] Supabase Service Role Key available
- [ ] Installer built (`PoemBooth Kiosk Setup 1.0.0.exe` in dist folder)

### Deployment
- [ ] Run `Deploy-PoemBoothKiosk.ps1` as Administrator
- [ ] Enter asset tag and hub ID
- [ ] Enter service role key (will be masked)
- [ ] Wait for completion (5-10 minutes)
- [ ] Verify all checks pass

### Post-Deployment
- [ ] Test manual launch of kiosk app
- [ ] Verify device registration in admin portal
- [ ] Test photo capture and poem generation
- [ ] Test printing (if enabled)
- [ ] Reboot and verify auto-start
- [ ] Remove deployment files and USB drives
- [ ] Label device with asset tag

### Hub Delivery
- [ ] Package device securely
- [ ] Include quick start guide for hub manager
- [ ] Include WiFi QR code setup instructions
- [ ] Ship to hub location

## Time Estimates

| Task | Time |
|------|------|
| Install Windows & Dependencies | 30-45 min |
| Run Deployment Script | 5-10 min |
| Testing & Verification | 5 min |
| **Total (Fresh PC)** | **40-60 min** |
| **Total (Pre-configured PC)** | **10-15 min** |

## Support

For deployment issues:

1. Check logs in deployment script output
2. Review DEPLOYMENT_GUIDE.md for detailed troubleshooting
3. Contact system administrator for Supabase access issues
4. Check backend status: https://book.poembooth.com/api/health

## Related Documentation

- **DEPLOYMENT_GUIDE.md** - Comprehensive deployment guide with all details
- **DEVICE_PROVISIONING.md** - Certificate provisioning deep dive
- **CLAUDE.md** - Project architecture and technical overview
- **README.md** - Application usage and development guide
