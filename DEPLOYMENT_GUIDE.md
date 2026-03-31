# Poem Booth Kiosk Deployment Guide

Complete guide for deploying the poem booth kiosk system from development to production devices.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Device Provisioning](#device-provisioning)
3. [Application Deployment](#application-deployment)
4. [Testing & Validation](#testing--validation)
5. [Creating Deployment Images](#creating-deployment-images)
6. [Troubleshooting](#troubleshooting)

---

## Development Setup

### Prerequisites

- **Node.js** 18+ LTS
- **OpenSSL** 3.0+ (for certificate operations)
- **Git** (for version control)
- **Windows 10/11** (or Linux/macOS for cross-platform development)

### Initial Setup

1. **Clone/Extract Project**

```bash
cd C:\Users\JB\poemboothkiosk
cd kiosk-app
```

2. **Install Dependencies**

```bash
npm install
```

This will:
- Install all Node.js dependencies
- Download Playwright Chromium (~500MB)
- Compile native bindings for Sharp

3. **Run in Development Mode**

```bash
npm run dev
```

This launches the app in windowed mode with DevTools for debugging.

---

## Device Provisioning

Before deploying to a kiosk device, you must provision it with certificates.

### Step 1: Backend Access

Ensure you have access to `book.poembooth.com` backend. You'll need:
- Service role key (for provisioning script)
- Hub ID (UUID of the hub this device belongs to)
- Equipment details (asset tag, serial number, type)

### Step 2: Generate Certificates

**Option A: Using Backend Provisioning Script** (Recommended)

If the backend has a provisioning script:

```bash
# On provisioning computer (with service role key)
npm run setup-device -- \
  --asset-tag "PB-001" \
  --hub-id "abc123-uuid-amsterdam" \
  --equipment-type "poem-booth" \
  --serial "DEV-2025-001"
```

This generates:
- Root CA certificate (if first device)
- Device-specific certificate + private key
- Database records for device and equipment

**Option B: Manual Certificate Generation**

If provisioning script isn't available, manually:

1. Generate certificates using OpenSSL
2. Create equipment record in database
3. Register device with certificate fingerprint

(See DEVICE_PROVISIONING.md for detailed instructions)

### Step 3: Install Certificates on Device

**Windows:**

```powershell
# Create certificate directory
New-Item -ItemType Directory -Path "C:\ProgramData\PoemBooth" -Force

# Copy certificates (via USB, network, or SCP)
Copy-Item "device.crt" -Destination "C:\ProgramData\PoemBooth\device.crt"
Copy-Item "device.key" -Destination "C:\ProgramData\PoemBooth\device.key"
Copy-Item "ca.crt" -Destination "C:\ProgramData\PoemBooth\ca.crt"

# Set permissions (private key accessible only to SYSTEM)
icacls "C:\ProgramData\PoemBooth\device.key" /inheritance:r
icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "SYSTEM:(F)"
icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "Administrators:(F)"
icacls "C:\ProgramData\PoemBooth\device.crt" /grant "Users:(R)"
icacls "C:\ProgramData\PoemBooth\ca.crt" /grant "Users:(R)"
```

**Linux:**

```bash
sudo mkdir -p /etc/poembooth
sudo cp device.crt /etc/poembooth/
sudo cp device.key /etc/poembooth/
sudo cp ca.crt /etc/poembooth/
sudo chmod 644 /etc/poembooth/device.crt
sudo chmod 600 /etc/poembooth/device.key
sudo chmod 644 /etc/poembooth/ca.crt
```

**macOS:**

```bash
sudo mkdir -p "/Library/Application Support/PoemBooth"
sudo cp device.crt "/Library/Application Support/PoemBooth/"
sudo cp device.key "/Library/Application Support/PoemBooth/"
sudo cp ca.crt "/Library/Application Support/PoemBooth/"
sudo chmod 644 "/Library/Application Support/PoemBooth/device.crt"
sudo chmod 600 "/Library/Application Support/PoemBooth/device.key"
sudo chmod 644 "/Library/Application Support/PoemBooth/ca.crt"
```

### Step 4: Verify Certificate Installation

Run the certificate test script:

```bash
cd kiosk-app
node test-certificates.js
```

Expected output:
```
✅ All tests passed!
```

---

## Application Deployment

### Method 1: Direct Installation (Development/Testing)

1. **Copy kiosk-app folder to device**

```bash
# Via USB or network
xcopy /E /I kiosk-app D:\PoemBooth\kiosk-app
```

2. **Install dependencies on device**

```bash
cd D:\PoemBooth\kiosk-app
npm install --production
```

3. **Run application**

```bash
npm start  # Production mode (fullscreen kiosk)
```

### Method 2: Windows Installer (Recommended for Production)

1. **Build installer on development machine**

```bash
cd kiosk-app
npm run build:win
```

Output: `dist/PoemBooth Kiosk Setup.exe`

2. **Copy installer to device**

Transfer `PoemBooth Kiosk Setup.exe` via:
- USB drive
- Network share
- Cloud storage (OneDrive, Dropbox)

3. **Install on device**

```powershell
# Run installer (installs to C:\Program Files\PoemBooth Kiosk\)
.\PoemBooth-Kiosk-Setup.exe
```

The installer will:
- Copy all application files
- Create desktop shortcut
- Create start menu entry
- Set up uninstaller

4. **Configure auto-start**

**Option A: Task Scheduler (Recommended)**

```powershell
# Create startup task
$action = New-ScheduledTaskAction -Execute "C:\Program Files\PoemBooth Kiosk\PoemBooth Kiosk.exe"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "PoemBooth Kiosk" -Action $action -Trigger $trigger -Principal $principal
```

**Option B: Startup Folder**

```powershell
# Create shortcut in startup folder
$shortcut = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\PoemBooth Kiosk.lnk"
$target = "C:\Program Files\PoemBooth Kiosk\PoemBooth Kiosk.exe"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($shortcut)
$Shortcut.TargetPath = $target
$Shortcut.Save()
```

### Method 3: Portable Deployment

For USB or network boot:

1. **Build portable version**

```bash
npm run build:win -- --dir
```

Output: `dist/win-unpacked/` (portable folder)

2. **Copy entire folder to device**

3. **Run PoemBooth Kiosk.exe**

---

## Testing & Validation

### Pre-Deployment Checklist

Before shipping device:

- [ ] Certificates installed in `C:\ProgramData\PoemBooth\`
- [ ] Certificate test passes (`node test-certificates.js`)
- [ ] Application installed/copied
- [ ] Camera permissions granted
- [ ] Internet connectivity working
- [ ] Backend registration successful
- [ ] Test photo capture works
- [ ] Test poem generation works
- [ ] Test QR code generation works
- [ ] Test printing (if enabled)
- [ ] Auto-start configured (if desired)

### Test Device Registration

1. **Boot device with certificates installed**
2. **If no WiFi:** App shows WiFi QR scanner
3. **Scan WiFi QR code** (generated from admin portal)
4. **Device connects and registers** with backend
5. **Verify in admin portal:**
   - Equipment shows "Last Online" timestamp
   - Device status is "available" or "in_use"

### Test Complete Guest Workflow

1. **Press "Take Photo"**
2. **3-second countdown**
3. **Photo captured, preview shown**
4. **Press "Use This Photo"**
5. **Processing screen** ("Creating your poem...")
6. **Result screen** with QR code
7. **Scan QR code** → Opens public viewer
8. **Press "Take Another Photo"** → Returns to start

Expected timing:
- Capture to preview: 3-4 seconds
- Confirm to poem: 5-7 seconds (cloud AI)
- Render to result: 2-3 seconds
- **Total: ~10-12 seconds**

---

## Creating Deployment Images

For deploying to multiple devices, create a master image.

### Windows Deployment Image

1. **Set up master device:**
   - Install Windows 10/11
   - Install kiosk application
   - Configure auto-start
   - Test complete workflow
   - **DO NOT install device certificates** (unique per device)

2. **Configure Windows for kiosk mode:**

```powershell
# Disable Windows Update during events
Set-Service wuauserv -StartupType Disabled

# Disable screen saver
powercfg -change -monitor-timeout-ac 0
powercfg -change -standby-timeout-ac 0

# Hide taskbar
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3" /v Settings /t REG_BINARY /d 30000000feffffff02000000030000003e00000030000000000000000804000080070000b004000000000000 /f

# Disable Windows notifications
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" /v ToastEnabled /t REG_DWORD /d 0 /f
```

3. **Create system image:**

```powershell
# Using Windows Backup
wbAdmin start backup -backupTarget:E: -include:C: -allCritical -quiet

# Or use Disk2VHD or Macrium Reflect
```

4. **Deploy to new devices:**
   - Restore image to device
   - Install unique device certificates
   - Change computer name/hostname
   - Run certificate test
   - Test registration

### USB Boot Image (Linux)

For Linux-based kiosks (Raspberry Pi, Intel NUC):

1. **Create base system:**
   - Ubuntu Server 22.04 LTS
   - Minimal installation
   - Install Node.js, Electron dependencies
   - Install kiosk application
   - Configure auto-start (systemd)

2. **Create bootable image:**

```bash
# Clone SD card or disk
sudo dd if=/dev/sdX of=poembooth-kiosk-master.img bs=4M status=progress
sudo gzip poembooth-kiosk-master.img
```

3. **Deploy to devices:**

```bash
# Flash image to new device
sudo dd if=poembooth-kiosk-master.img.gz | gunzip | dd of=/dev/sdX bs=4M status=progress

# Expand filesystem
sudo resize2fs /dev/sdX2

# Install unique certificates
# Test registration
```

---

## Troubleshooting

### Device Won't Start

**Symptoms:** App crashes or doesn't launch

**Solutions:**
1. Check logs: `%APPDATA%\PoemBooth Kiosk\logs\`
2. Verify Node.js installed: `node --version`
3. Verify dependencies: `npm list` in app directory
4. Reinstall: `npm install --production`

### Certificates Not Found

**Symptoms:** "Device certificates not found" error

**Solutions:**
1. Run certificate test: `node test-certificates.js`
2. Verify path: `dir "C:\ProgramData\PoemBooth"`
3. Check permissions: `icacls "C:\ProgramData\PoemBooth\device.key"`
4. Reinstall certificates from provisioning machine

### Cannot Connect to Backend

**Symptoms:** "Registration failed" or "Network error"

**Solutions:**
1. Check internet: `ping book.poembooth.com`
2. Test API: `curl https://book.poembooth.com/api/health`
3. Verify WiFi connection
4. Check certificate expiry: `openssl x509 -in device.crt -noout -dates`
5. Verify device not revoked (contact admin)

### Camera Not Working

**Symptoms:** "Camera initialization failed"

**Solutions:**
1. **Windows:** Settings → Privacy → Camera → Allow apps
2. Check device manager: `devmgmt.msc`
3. Test camera: Windows Camera app
4. Try different USB port
5. Update camera drivers

### Rendering Fails

**Symptoms:** "Render error" during poem creation

**Solutions:**
1. Verify Playwright installed: `npx playwright --version`
2. Reinstall Chromium: `npx playwright install chromium`
3. Check disk space (rendering needs ~1GB temp space)
4. Check memory (minimum 4GB RAM recommended)

### Print Button Not Working

**Symptoms:** Print button doesn't appear or fails

**Solutions:**
1. Verify printing enabled in config
2. Check printer connected: `Get-Printer` (PowerShell)
3. Test printer: Print test page from Windows
4. Check printer permissions

---

## Production Recommendations

### Hardware Requirements

**Minimum:**
- CPU: Intel i3 / AMD Ryzen 3
- RAM: 4GB
- Storage: 64GB SSD
- Camera: 1080p USB webcam
- Display: 1920x1080 touchscreen
- Network: WiFi 802.11n or Ethernet

**Recommended:**
- CPU: Intel i5 / AMD Ryzen 5
- RAM: 8GB
- Storage: 128GB SSD
- Camera: 1080p USB webcam with autofocus
- Display: 1920x1080 or 4K touchscreen
- Network: WiFi 802.11ac or Gigabit Ethernet
- Printer: Thermal or inkjet photo printer (optional)

### Security Hardening

1. **Disable unnecessary services**
2. **Enable Windows Defender / firewall**
3. **Set strong local admin password**
4. **Disable USB ports** (except camera/printer)
5. **Lock BIOS with password**
6. **Enable BitLocker** disk encryption
7. **Regular security updates** (scheduled maintenance windows)

### Maintenance Schedule

**Daily:**
- Verify device online in admin portal
- Check for error logs
- Test guest workflow

**Weekly:**
- Clean camera lens
- Check printer paper/ink (if applicable)
- Review session logs

**Monthly:**
- Clear temp files
- Check certificate expiry (renew before expiration)
- Update application (if new version available)
- Check disk space

**Annually:**
- Deep clean hardware
- Replace camera if degraded
- Renew certificates (3-year validity)
- Review and update configurations

---

## Support

For deployment issues:
- **Technical Support:** support@poembooth.com
- **Device Provisioning:** Contact system administrator
- **Security Issues:** security@poembooth.com

---

**Last Updated:** 2025-11-12
**Version:** 1.0
