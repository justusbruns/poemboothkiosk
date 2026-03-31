# 🔧 Device Provisioning Guide for Workshop Technicians

**Document Version:** 1.0
**Last Updated:** 2025-11-10
**Audience:** Workshop technicians, hardware engineers, super admins

---

## 📋 Overview

This guide explains how to provision poem booth kiosk devices using the **zero-touch provisioning system** with X.509 certificates. Devices configured with this system will auto-register when hub managers connect them to WiFi at event locations.

### What This Achieves

- **Pre-configured equipment assignment** - Device knows which equipment it belongs to
- **Cryptographic device identity** - Secure authentication without passwords or tokens
- **Zero hub manager setup** - Only WiFi QR code scan needed on-site
- **Long-term credentials** - 3-year validity, no frequent rotation

### Workflow Summary

```
Workshop (You)              →    Shipping    →    Hub Manager (On-Site)
────────────────────────────────────────────────────────────────────────
1. Run setup script                             4. Unbox device
2. Generate certificates                        5. Scan WiFi QR code
3. Install on device                            6. Device auto-registers
                                                7. Ready for events
```

---

## 🛠️ Prerequisites

### Software Requirements

- **Node.js 18+** - For running setup script
- **npm** - Package manager (comes with Node.js)
- **OpenSSL** - Certificate generation tool
- **Git** - To clone the booking system repository

#### Installation (Ubuntu/Debian)

```bash
# Update package list
sudo apt update

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher

# Install OpenSSL (usually pre-installed)
sudo apt install -y openssl

# Verify OpenSSL
openssl version  # Should show OpenSSL 3.0.x or higher
```

#### Installation (Windows 10/11)

**Option A: Chocolatey (Recommended)**

```powershell
# Install Chocolatey package manager (if not already installed)
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install required packages
choco install nodejs-lts openssl git -y

# Verify installations
node --version  # Should show v18.x.x or v20.x.x
npm --version   # Should show 9.x.x or higher
openssl version # Should show OpenSSL 3.0.x or higher
```

**Option B: Winget (Windows 11)**

```powershell
# Install using Windows Package Manager
winget install OpenJS.NodeJS.LTS
winget install ShiningLight.OpenSSL
winget install Git.Git

# Verify installations
node --version
openssl version
```

**Option C: Manual Installers**

If you prefer manual installation:
1. **Node.js:** Download from https://nodejs.org/ (LTS version)
2. **OpenSSL:** Download from https://slproweb.com/products/Win32OpenSSL.html (Win64 OpenSSL v3.x)
3. **Git:** Download from https://git-scm.com/download/win

After manual installation, verify in PowerShell:
```powershell
node --version
openssl version
git --version
```

#### Installation (macOS)

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@18

# Install OpenSSL
brew install openssl@3

# Verify installations
node --version
openssl version
```

### Database Access

You need **service role key** access to create equipment records in the database.

**Important:** Service role key is ONLY used in this workshop script for provisioning. It is NOT deployed to production or stored on kiosk devices.

#### Obtaining Service Role Key

1. Contact the system administrator or super admin
2. They will provide you with:
   - Supabase project URL
   - Service role key (secret, keep secure!)
3. Store in `.env.local` file (see Configuration section)

### Network Access

- Internet connection to access Supabase database
- If provisioning multiple devices, use a stable connection (not mobile hotspot)

---

## 📁 Project Setup

### 1. Clone Repository

```bash
# Clone the booking system repository
git clone https://github.com/yourusername/poemboothbooking.git
cd poemboothbooking

# Install dependencies
npm install
```

### 2. Configure Environment

Create a `.env.local` file in the project root:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://xtgxfighvyybzcxfimvs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Optional: Custom certificate directory
# CERT_OUTPUT_DIR=/path/to/custom/cert/directory
```

**Security Notes:**
- **NEVER** commit `.env.local` to version control
- Service role key grants full database access - keep it secret
- Only use service role key in workshop, NEVER deploy to production

### 3. Verify Setup

```bash
# Test database connectivity
npm run setup-device -- --help
```

If successful, you should see the help text for the setup script.

---

## 🚀 Provisioning Process

### Step 1: Gather Equipment Information

Before running the script, collect the following information:

- **Asset Tag** (e.g., "PB-005") - Unique identifier for equipment
- **Hub ID** (UUID format) - Which hub this device belongs to
- **Equipment Type** (e.g., "poem-booth", "printer") - Type of equipment
- **Serial Number** (e.g., "DEV-2025-005") - Hardware serial number

**Where to Find Hub ID:**
1. Contact super admin for hub UUID
2. Or query database: `SELECT id, name FROM hubs;`
3. Common hubs:
   - Amsterdam: `abc123-uuid-amsterdam`
   - New York: `xyz789-uuid-newyork`

### Step 2: Run Setup Script

Execute the provisioning script with equipment details:

```bash
npm run setup-device -- \
  --asset-tag "PB-005" \
  --hub-id "abc123-uuid-amsterdam" \
  --equipment-type "poem-booth" \
  --serial "DEV-2025-005"
```

**Script Output:**

```
🔧 Device Setup Tool - Zero-Touch Provisioning
────────────────────────────────────────────────

📋 Configuration:
   Asset Tag:      PB-005
   Hub ID:         abc123-uuid-amsterdam
   Equipment Type: poem-booth
   Serial Number:  DEV-2025-005

✅ Step 1: Generate Root CA (if not exists)
   CA Certificate: /certs/root-ca.crt
   CA Key:         /certs/root-ca.key (KEEP SECURE!)

   ⚠️  Root CA already exists. Reusing existing CA.
   This ensures all devices trust the same authority.

✅ Step 2: Create Equipment in Database
   Equipment ID:   5
   Hub:            Amsterdam Hub
   Status:         available

   Equipment record created successfully!

✅ Step 3: Generate Device Certificate
   Device ID:      dev-uuid-12345-67890
   Certificate:    /certs/devices/PB-005.crt
   Private Key:    /certs/devices/PB-005.key
   Fingerprint:    SHA256:abc123def456...

   Certificate Details:
   - Subject: CN=PB-005, O=Poem Booth, OU=Amsterdam Hub
   - Issuer: CN=Poem Booth Root CA
   - Valid From: 2025-11-10 00:00:00 UTC
   - Valid To: 2028-11-10 00:00:00 UTC (3 years)

   Subject Alternative Names (SAN):
   - URI: urn:device:dev-uuid-12345-67890
   - URI: urn:equipment:5
   - URI: urn:hub:abc123-uuid-amsterdam
   - DNS: PB-005.booth.internal

✅ Step 4: Register Device in Database
   Table: registered_devices
   Device ID: dev-uuid-12345-67890
   Status: provisioned (awaiting first boot)

   Device registration successful!

✅ Step 5: Update Equipment Record
   Linking device to equipment...
   - device_id: dev-uuid-12345-67890
   - device_certificate_fingerprint: SHA256:abc123def456...

   Equipment updated successfully!

📦 Installation Instructions:

   Copy the following files to the kiosk device:

   **On Linux:**
   1. Device Certificate:
      Source: /certs/devices/PB-005.crt
      Target: /etc/poembooth/device.crt

   2. Device Private Key:
      Source: /certs/devices/PB-005.key
      Target: /etc/poembooth/device.key

   3. Root CA Certificate:
      Source: /certs/root-ca.crt
      Target: /etc/poembooth/ca.crt

   **On Windows (Intel NUC):**
   1. Device Certificate:
      Source: certs\devices\PB-005.crt
      Target: C:\ProgramData\PoemBooth\device.crt

   2. Device Private Key:
      Source: certs\devices\PB-005.key
      Target: C:\ProgramData\PoemBooth\device.key

   3. Root CA Certificate:
      Source: certs\root-ca.crt
      Target: C:\ProgramData\PoemBooth\ca.crt

   **On macOS:**
   1. Device Certificate:
      Source: certs/devices/PB-005.crt
      Target: /Library/Application Support/PoemBooth/device.crt

   2. Device Private Key:
      Source: certs/devices/PB-005.key
      Target: /Library/Application Support/PoemBooth/device.key

   3. Root CA Certificate:
      Source: certs/root-ca.crt
      Target: /Library/Application Support/PoemBooth/ca.crt

   Installation commands:

   **On Linux (run on device):**
   sudo mkdir -p /etc/poembooth
   sudo scp user@workshop:/certs/devices/PB-005.crt /etc/poembooth/device.crt
   sudo scp user@workshop:/certs/devices/PB-005.key /etc/poembooth/device.key
   sudo scp user@workshop:/certs/root-ca.crt /etc/poembooth/ca.crt
   sudo chmod 644 /etc/poembooth/device.crt
   sudo chmod 600 /etc/poembooth/device.key
   sudo chmod 644 /etc/poembooth/ca.crt
   sudo chown poembooth:poembooth /etc/poembooth/*

   **On Windows (run PowerShell as Administrator):**
   New-Item -ItemType Directory -Path "C:\ProgramData\PoemBooth" -Force
   # Copy files via USB or network (see installation methods below)
   # Set permissions (private key accessible only to SYSTEM):
   icacls "C:\ProgramData\PoemBooth\device.key" /inheritance:r
   icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "SYSTEM:(F)"
   icacls "C:\ProgramData\PoemBooth\device.crt" /grant "Users:(R)"
   icacls "C:\ProgramData\PoemBooth\ca.crt" /grant "Users:(R)"

   **On macOS (run on device):**
   sudo mkdir -p "/Library/Application Support/PoemBooth"
   sudo scp user@workshop:/certs/devices/PB-005.crt "/Library/Application Support/PoemBooth/device.crt"
   sudo scp user@workshop:/certs/devices/PB-005.key "/Library/Application Support/PoemBooth/device.key"
   sudo scp user@workshop:/certs/root-ca.crt "/Library/Application Support/PoemBooth/ca.crt"
   sudo chmod 644 "/Library/Application Support/PoemBooth/device.crt"
   sudo chmod 600 "/Library/Application Support/PoemBooth/device.key"
   sudo chmod 644 "/Library/Application Support/PoemBooth/ca.crt"
   sudo chown root:wheel "/Library/Application Support/PoemBooth"/*

🎉 SUCCESS! Device PB-005 is provisioned and ready for installation.

   Next Steps:
   1. Copy certificate files to device (see instructions above)
   2. Test device connectivity (see Testing section)
   3. Ship device to Amsterdam Hub
   4. Hub manager scans WiFi QR code
   5. Device auto-registers and is ready for events!

📄 Certificate Files Generated:
   - /certs/devices/PB-005.crt (public certificate)
   - /certs/devices/PB-005.key (private key - KEEP SECURE!)
   - /certs/root-ca.crt (root CA certificate - same for all devices)
```

### Step 3: Install Certificates on Device

#### Method A: USB Drive Installation (Recommended for Offline Devices)

**On Linux:**

```bash
# On workshop computer:
# 1. Copy files to USB drive
mkdir -p /media/usb/poembooth-certs
cp /certs/devices/PB-005.crt /media/usb/poembooth-certs/device.crt
cp /certs/devices/PB-005.key /media/usb/poembooth-certs/device.key
cp /certs/root-ca.crt /media/usb/poembooth-certs/ca.crt

# 2. On kiosk device (after inserting USB):
sudo mkdir -p /etc/poembooth
sudo cp /media/usb/poembooth-certs/* /etc/poembooth/
sudo chmod 644 /etc/poembooth/device.crt
sudo chmod 600 /etc/poembooth/device.key
sudo chmod 644 /etc/poembooth/ca.crt
sudo chown poembooth:poembooth /etc/poembooth/*

# 3. Verify installation
ls -la /etc/poembooth/
# Should show:
# -rw-r--r-- 1 poembooth poembooth 1234 Nov 10 10:00 device.crt
# -rw------- 1 poembooth poembooth 5678 Nov 10 10:00 device.key
# -rw-r--r-- 1 poembooth poembooth 9012 Nov 10 10:00 ca.crt

# 4. Securely erase USB drive after installation
sudo shred -vfz -n 3 /media/usb/poembooth-certs/*
```

**On Windows (Intel NUC):**

```powershell
# On workshop computer:
# 1. Copy files to USB drive (USB will auto-mount as E:\ or similar)
New-Item -ItemType Directory -Path "E:\poembooth-certs" -Force
Copy-Item "certs\devices\PB-005.crt" -Destination "E:\poembooth-certs\device.crt"
Copy-Item "certs\devices\PB-005.key" -Destination "E:\poembooth-certs\device.key"
Copy-Item "certs\root-ca.crt" -Destination "E:\poembooth-certs\ca.crt"

# 2. On kiosk device (run PowerShell as Administrator after inserting USB):
# Create certificate directory
New-Item -ItemType Directory -Path "C:\ProgramData\PoemBooth" -Force

# Copy certificates from USB (adjust drive letter if needed)
Copy-Item "E:\poembooth-certs\*" -Destination "C:\ProgramData\PoemBooth\"

# Set file permissions
icacls "C:\ProgramData\PoemBooth\device.key" /inheritance:r
icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "SYSTEM:(F)"
icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "Administrators:(F)"
icacls "C:\ProgramData\PoemBooth\device.crt" /grant "Users:(R)"
icacls "C:\ProgramData\PoemBooth\ca.crt" /grant "Users:(R)"

# 3. Verify installation
dir "C:\ProgramData\PoemBooth"
# Should list:
# device.crt
# device.key
# ca.crt

# 4. Securely erase USB drive after installation
cipher /w:E:\poembooth-certs
# Note: cipher overwrites deleted files. For more thorough deletion, use SDelete:
# Download from: https://docs.microsoft.com/sysinternals/downloads/sdelete
# sdelete -p 3 E:\poembooth-certs\*
```

**On macOS:**

```bash
# On workshop computer:
# 1. Copy files to USB drive (USB will auto-mount at /Volumes/)
mkdir -p "/Volumes/Untitled/poembooth-certs"  # Replace "Untitled" with your USB drive name
cp certs/devices/PB-005.crt "/Volumes/Untitled/poembooth-certs/device.crt"
cp certs/devices/PB-005.key "/Volumes/Untitled/poembooth-certs/device.key"
cp certs/root-ca.crt "/Volumes/Untitled/poembooth-certs/ca.crt"

# 2. On kiosk device (after inserting USB):
sudo mkdir -p "/Library/Application Support/PoemBooth"
sudo cp "/Volumes/Untitled/poembooth-certs"/* "/Library/Application Support/PoemBooth/"
sudo chmod 644 "/Library/Application Support/PoemBooth/device.crt"
sudo chmod 600 "/Library/Application Support/PoemBooth/device.key"
sudo chmod 644 "/Library/Application Support/PoemBooth/ca.crt"
sudo chown root:wheel "/Library/Application Support/PoemBooth"/*

# 3. Verify installation
ls -la "/Library/Application Support/PoemBooth/"
# Should show:
# -rw-r--r-- 1 root wheel 1234 Nov 11 10:00 device.crt
# -rw------- 1 root wheel 5678 Nov 11 10:00 device.key
# -rw-r--r-- 1 root wheel 9012 Nov 11 10:00 ca.crt

# 4. Securely erase USB drive after installation
# Option 1: 3-pass overwrite (quick)
rm -P "/Volumes/Untitled/poembooth-certs"/*

# Option 2: 7-pass DoD standard (more secure, requires srm)
# Install srm: brew install srm
srm -m "/Volumes/Untitled/poembooth-certs"/*

# Option 3: Erase entire USB drive (most secure)
diskutil list  # Find your USB drive identifier (e.g., disk2)
diskutil secureErase 3 disk2  # 3 = 7-pass erase
```

#### Method B: Network Installation (For Devices with Network Access)

**On Linux:**

```bash
# On kiosk device (SSH or direct access):
sudo mkdir -p /etc/poembooth

# Copy files via SCP (from workshop computer)
sudo scp workshop-user@192.168.1.100:/certs/devices/PB-005.crt /etc/poembooth/device.crt
sudo scp workshop-user@192.168.1.100:/certs/devices/PB-005.key /etc/poembooth/device.key
sudo scp workshop-user@192.168.1.100:/certs/root-ca.crt /etc/poembooth/ca.crt

# Set correct permissions
sudo chmod 644 /etc/poembooth/device.crt
sudo chmod 600 /etc/poembooth/device.key
sudo chmod 644 /etc/poembooth/ca.crt
sudo chown poembooth:poembooth /etc/poembooth/*
```

**On Windows (Intel NUC):**

```powershell
# On kiosk device (run PowerShell as Administrator):

# Method 1: SMB Network Share (Recommended)
# Share the certs folder on workshop computer first:
# Right-click certs folder > Properties > Sharing > Share
# Then on kiosk device:
net use Z: \\workshop-pc\certs
New-Item -ItemType Directory -Path "C:\ProgramData\PoemBooth" -Force
Copy-Item "Z:\devices\PB-005.crt" -Destination "C:\ProgramData\PoemBooth\device.crt"
Copy-Item "Z:\devices\PB-005.key" -Destination "C:\ProgramData\PoemBooth\device.key"
Copy-Item "Z:\root-ca.crt" -Destination "C:\ProgramData\PoemBooth\ca.crt"
net use Z: /delete

# Method 2: PSCP (PuTTY SCP - if workshop runs Linux/SSH)
# Download PSCP from: https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html
pscp workshop-user@192.168.1.100:/certs/devices/PB-005.crt C:\ProgramData\PoemBooth\device.crt
pscp workshop-user@192.168.1.100:/certs/devices/PB-005.key C:\ProgramData\PoemBooth\device.key
pscp workshop-user@192.168.1.100:/certs/root-ca.crt C:\ProgramData\PoemBooth\ca.crt

# Set file permissions
icacls "C:\ProgramData\PoemBooth\device.key" /inheritance:r
icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "SYSTEM:(F)"
icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "Administrators:(F)"
icacls "C:\ProgramData\PoemBooth\device.crt" /grant "Users:(R)"
icacls "C:\ProgramData\PoemBooth\ca.crt" /grant "Users:(R)"
```

**On macOS:**

```bash
# On kiosk device (run in Terminal):

# Method 1: SCP (SSH Copy)
sudo mkdir -p "/Library/Application Support/PoemBooth"
sudo scp workshop-user@192.168.1.100:/certs/devices/PB-005.crt "/Library/Application Support/PoemBooth/device.crt"
sudo scp workshop-user@192.168.1.100:/certs/devices/PB-005.key "/Library/Application Support/PoemBooth/device.key"
sudo scp workshop-user@192.168.1.100:/certs/root-ca.crt "/Library/Application Support/PoemBooth/ca.crt"

# Method 2: SMB Network Share via Finder
# 1. In Finder, press Cmd+K or Go > Connect to Server
# 2. Enter: smb://workshop-pc/certs
# 3. Mount the network share (appears in /Volumes/)
# 4. Copy certificates:
sudo mkdir -p "/Library/Application Support/PoemBooth"
sudo cp "/Volumes/certs/devices/PB-005.crt" "/Library/Application Support/PoemBooth/device.crt"
sudo cp "/Volumes/certs/devices/PB-005.key" "/Library/Application Support/PoemBooth/device.key"
sudo cp "/Volumes/certs/root-ca.crt" "/Library/Application Support/PoemBooth/ca.crt"

# Method 3: SMB via Command Line
mkdir /Volumes/workshop-certs  # Create mount point
mount_smbfs //workshop-user@workshop-pc/certs /Volumes/workshop-certs
sudo cp /Volumes/workshop-certs/devices/PB-005.* "/Library/Application Support/PoemBooth/"
sudo cp /Volumes/workshop-certs/root-ca.crt "/Library/Application Support/PoemBooth/ca.crt"
umount /Volumes/workshop-certs  # Unmount when done

# Set correct permissions (all methods)
sudo chmod 644 "/Library/Application Support/PoemBooth/device.crt"
sudo chmod 600 "/Library/Application Support/PoemBooth/device.key"
sudo chmod 644 "/Library/Application Support/PoemBooth/ca.crt"
sudo chown root:wheel "/Library/Application Support/PoemBooth"/*
```

#### Method C: Electron App Installer (Automated)

If the kiosk Electron app includes an installer script:

```bash
# Run app installer with certificate files
./install-certificates.sh \
  --cert /path/to/PB-005.crt \
  --key /path/to/PB-005.key \
  --ca /path/to/root-ca.crt
```

---

## ✅ Testing & Verification

### 1. Verify Certificate Installation

**On Linux:**

```bash
# Check files exist
ls -la /etc/poembooth/

# Verify certificate details
openssl x509 -in /etc/poembooth/device.crt -text -noout

# Should show:
# - Subject: CN=PB-005, O=Poem Booth, OU=Amsterdam Hub
# - Issuer: CN=Poem Booth Root CA
# - Validity dates (3 years)
# - Subject Alternative Names (equipment_id, hub_id, device_id)

# Verify private key matches certificate
openssl x509 -noout -modulus -in /etc/poembooth/device.crt | openssl md5
openssl rsa -noout -modulus -in /etc/poembooth/device.key | openssl md5
# Both MD5 hashes should match
```

**On Windows:**

```powershell
# Check files exist
dir "C:\ProgramData\PoemBooth"

# Method 1: Using OpenSSL (if installed via Chocolatey/Winget)
openssl x509 -in "C:\ProgramData\PoemBooth\device.crt" -text -noout

# Method 2: Using Windows certutil (built-in)
certutil -dump "C:\ProgramData\PoemBooth\device.crt"
certutil -verify "C:\ProgramData\PoemBooth\device.crt"

# Should show:
# - Subject: CN=PB-005, O=Poem Booth, OU=Amsterdam Hub
# - Issuer: CN=Poem Booth Root CA
# - Validity dates (3 years)
# - Subject Alternative Names (equipment_id, hub_id, device_id)

# Verify private key matches certificate (using OpenSSL)
$certModulus = openssl x509 -noout -modulus -in "C:\ProgramData\PoemBooth\device.crt"
$keyModulus = openssl rsa -noout -modulus -in "C:\ProgramData\PoemBooth\device.key"
if ($certModulus -eq $keyModulus) {
  Write-Host "✓ Certificate and private key match" -ForegroundColor Green
} else {
  Write-Host "✗ Certificate and private key DO NOT match" -ForegroundColor Red
}
```

**On macOS:**

```bash
# Check files exist
ls -la "/Library/Application Support/PoemBooth/"

# Verify certificate details
openssl x509 -in "/Library/Application Support/PoemBooth/device.crt" -text -noout

# Should show:
# - Subject: CN=PB-005, O=Poem Booth, OU=Amsterdam Hub
# - Issuer: CN=Poem Booth Root CA
# - Validity dates (3 years)
# - Subject Alternative Names (equipment_id, hub_id, device_id)

# Verify private key matches certificate
openssl x509 -noout -modulus -in "/Library/Application Support/PoemBooth/device.crt" | openssl md5
openssl rsa -noout -modulus -in "/Library/Application Support/PoemBooth/device.key" | openssl md5
# Both MD5 hashes should match

# Alternative: One-liner comparison
if [ "$(openssl x509 -noout -modulus -in "/Library/Application Support/PoemBooth/device.crt" | openssl md5)" = "$(openssl rsa -noout -modulus -in "/Library/Application Support/PoemBooth/device.key" | openssl md5)" ]; then
  echo "✓ Certificate and private key match"
else
  echo "✗ Certificate and private key DO NOT match"
fi
```

### 2. Test Device Registration (Without WiFi Setup)

Create a test script to verify certificate authentication:

```bash
# test-cert-auth.sh
#!/bin/bash

# Detect platform and set certificate path
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  CERT_PATH="/Library/Application Support/PoemBooth/device.crt"
  CERT=$(base64 -i "$CERT_PATH" | tr -d '\n')  # macOS doesn't support -w flag
  PLATFORM="darwin"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  # Windows (Git Bash)
  CERT_PATH="C:/ProgramData/PoemBooth/device.crt"
  CERT=$(base64 -w 0 "$CERT_PATH")
  PLATFORM="win32"
else
  # Linux
  CERT_PATH="/etc/poembooth/device.crt"
  CERT=$(base64 -w 0 "$CERT_PATH")
  PLATFORM="linux"
fi

# Test API call
curl -X POST https://book.poembooth.com/api/devices/register \
  -H "Authorization: Bearer $CERT" \
  -H "Content-Type: application/json" \
  -d "{
    \"device_info\": {
      \"mac_address\": \"AA:BB:CC:DD:EE:FF\",
      \"ip_address\": \"192.168.1.105\",
      \"platform\": \"$PLATFORM\",
      \"app_version\": \"2.0.0\",
      \"wifi_ssid\": \"TestNetwork\"
    }
  }"

# Expected response:
# {
#   "success": true,
#   "device": {
#     "device_id": "dev-uuid-12345-67890",
#     "equipment_id": 5,
#     "equipment_name": "PB-005",
#     "hub_id": "abc123-uuid-amsterdam",
#     "hub_name": "Amsterdam Hub",
#     "status": "active"
#   }
# }
```

Run the test:

```bash
chmod +x test-cert-auth.sh
./test-cert-auth.sh
```

**Expected Output:**
- HTTP 200 OK
- JSON response with device and equipment details
- No errors about certificate validation

### 3. Test Complete Workflow (Full Integration Test)

If you have access to a test WiFi network:

1. **Generate WiFi QR Code** (admin portal: Profile → WiFi QR Code)
   - SSID: TestNetwork
   - Password: TestPass123

2. **Boot Device and Scan QR**
   - Device should connect to WiFi automatically
   - Device calls `/api/devices/register`
   - Device displays: "✅ Connected - Equipment: PB-005"

3. **Verify in Admin Portal**
   - Go to Equipment → PB-005
   - Check "Last Online" timestamp (should be recent)
   - Status should be "available" or "in_use"

---

## 🔒 Security Best Practices

### Root CA Private Key Protection

The Root CA private key (`/certs/root-ca.key`) is the **most sensitive file** in this system. Anyone with access to it can create valid device certificates.

**Storage Requirements:**
- ✅ Store on encrypted external drive (offline backup)
- ✅ Keep in physically secure location (locked cabinet)
- ✅ Limit access to authorized technicians only
- ✅ Create multiple backup copies (geographically distributed)
- ❌ Never store on cloud services
- ❌ Never commit to version control
- ❌ Never copy to unsecured USB drives

**Backup Procedure:**

```bash
# Encrypt Root CA key with strong password
openssl enc -aes-256-cbc -salt \
  -in /certs/root-ca.key \
  -out /certs/root-ca.key.enc \
  -k "VERY-STRONG-PASSWORD-HERE"

# Copy encrypted file to secure backup location
cp /certs/root-ca.key.enc /path/to/secure/backup/

# Verify backup integrity
diff /certs/root-ca.key.enc /path/to/secure/backup/root-ca.key.enc
```

### Device Private Key Protection

Each device private key (`/certs/devices/PB-005.key`) authenticates that specific device.

**Handling:**
- ✅ Delete from workshop computer after installation
- ✅ Set correct file permissions (600) on device
- ✅ Never transmit over unencrypted channels
- ❌ Never store multiple device keys in same directory long-term
- ❌ Never reuse keys across devices

**Secure Deletion:**

```bash
# After successful installation, securely delete from workshop
shred -vfz -n 3 /certs/devices/PB-005.key

# Verify deletion
ls /certs/devices/PB-005.key
# Should show: No such file or directory
```

### Access Control

**Workshop Computer:**
- Use encrypted disk (FileVault on macOS, LUKS on Linux)
- Require strong login password
- Lock screen when unattended
- Disable USB auto-mount for security

**Service Role Key:**
- Store in `.env.local` (never commit to git)
- Rotate quarterly (contact system admin)
- Revoke immediately if compromised

---

## 🔄 Certificate Renewal

Certificates are valid for **3 years**. Devices need new certificates before expiry.

### Renewal Schedule

- **2.5 years after issuance**: Plan renewal
- **2.8 years after issuance**: Begin renewal process
- **3 years after issuance**: Certificate expires (device stops working)

### Renewal Process

1. **Check Certificate Expiry**

```bash
# On device or from backup
openssl x509 -in /etc/poembooth/device.crt -noout -dates

# Output:
# notBefore=Nov 10 00:00:00 2025 GMT
# notAfter=Nov 10 00:00:00 2028 GMT
```

2. **Generate New Certificate**

```bash
# Same process as initial provisioning
npm run setup-device -- \
  --asset-tag "PB-005" \
  --hub-id "abc123-uuid-amsterdam" \
  --equipment-type "poem-booth" \
  --serial "DEV-2025-005" \
  --renew

# --renew flag reuses existing device_id and equipment record
```

3. **Update Device**

- Follow installation steps (USB/network)
- No need to update hub manager's workflow
- Device automatically uses new certificate

### Emergency Revocation

If a device is lost, stolen, or compromised:

1. **Contact System Administrator**
   - Provide equipment ID and certificate fingerprint
   - Request immediate revocation

2. **Admin Revokes Certificate** (via admin portal or database)

```sql
-- Insert into revocation list
INSERT INTO revoked_device_certificates (
  certificate_fingerprint,
  revoked_at,
  revoked_by,
  reason
) VALUES (
  'SHA256:abc123def456...',
  NOW(),
  'admin-user-id',
  'Device reported stolen from warehouse'
);
```

3. **Generate Replacement Certificate**
   - Run setup script with same equipment details
   - New certificate will have different device_id
   - Old certificate can never be used again

---

## 🐛 Troubleshooting

### Issue: "Equipment already exists with this asset tag"

**Cause:** Asset tag is already in use by another equipment record.

**Solution:**

```bash
# Option 1: Use different asset tag
npm run setup-device -- --asset-tag "PB-005-CLONE" ...

# Option 2: Delete existing record (if you're sure it's wrong)
# Contact system admin to remove old equipment record
```

### Issue: "Root CA not found"

**Cause:** First time running setup script, or CA files were deleted.

**Solution:**
- Script automatically generates new Root CA on first run
- If Root CA exists but script doesn't detect it, check `CERT_OUTPUT_DIR` environment variable

### Issue: "OpenSSL command failed"

**Cause:** OpenSSL not installed or wrong version.

**Solution:**

```bash
# Check OpenSSL version
openssl version

# Should be OpenSSL 3.0.x or higher
# If not, reinstall:
# Ubuntu/Debian:
sudo apt install --reinstall openssl

# macOS:
brew reinstall openssl@3
```

### Issue: "Database connection failed"

**Cause:** Incorrect Supabase URL or service role key.

**Solution:**

1. Verify `.env.local` contents
2. Test database connection:

```bash
# Install Supabase CLI
npm install -g supabase

# Test connection
export SUPABASE_URL="https://xtgxfighvyybzcxfimvs.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"

supabase db remote --help
```

### Issue: "Certificate installation failed - permission denied"

**Cause:** Insufficient permissions on kiosk device.

**Solution:**

```bash
# Ensure you have sudo access
sudo whoami  # Should show: root

# If not in sudoers, add yourself:
# (As root or via recovery mode)
usermod -aG sudo your-username

# Or run installation as root
su - root
# Then run installation commands
```

### Issue: "Device doesn't auto-register after WiFi scan"

**Possible Causes & Solutions:**

1. **Certificates not installed correctly**
   ```bash
   # Check file permissions
   ls -la /etc/poembooth/
   # device.key should be -rw------- (600)
   ```

2. **Electron app not configured to read certificates**
   - Verify app reads from `/etc/poembooth/` directory
   - Check app logs for certificate loading errors

3. **Network connectivity issue**
   ```bash
   # Test internet connectivity
   ping -c 3 book.poembooth.com

   # Test API endpoint
   curl https://book.poembooth.com/api/health
   ```

4. **Certificate expired or revoked**
   ```bash
   # Check expiry
   openssl x509 -in /etc/poembooth/device.crt -noout -dates

   # Check if revoked (contact admin)
   ```

---

## 📚 Additional Resources

### Related Documentation

- **KIOSK_INTEGRATION_GUIDE.md** - Complete kiosk system architecture
- **CLAUDE.md** - Project overview and security architecture
- **README.md** - Project setup and deployment

### External References

- [X.509 Certificate Standard](https://tools.ietf.org/html/rfc5280)
- [OpenSSL Documentation](https://www.openssl.org/docs/)
- [Supabase Authentication](https://supabase.com/docs/guides/auth)

### Support Contacts

- **System Administrator**: admin@poembooth.com
- **Technical Support**: support@poembooth.com
- **Security Issues**: security@poembooth.com

---

## 📝 Provisioning Checklist

Use this checklist for each device:

### Pre-Provisioning

- [ ] Node.js 18+ installed
- [ ] OpenSSL installed
- [ ] Repository cloned and dependencies installed
- [ ] `.env.local` configured with service role key
- [ ] Equipment information gathered (asset tag, hub ID, etc.)

### Provisioning

- [ ] Ran setup script successfully
- [ ] Verified certificate files generated
- [ ] Checked database records created
- [ ] Backed up Root CA (if first device)

### Installation

- [ ] Copied certificate files to device
- [ ] Set correct file permissions (644/600)
- [ ] Verified certificate details with `openssl x509`
- [ ] Tested private key matches certificate
- [ ] Securely deleted source files from workshop

### Testing

- [ ] Tested certificate authentication with test script
- [ ] Verified device registration API call
- [ ] (Optional) Full integration test with WiFi QR scan
- [ ] Checked "Last Online" timestamp in admin portal

### Shipping

- [ ] Labeled device with asset tag
- [ ] Included shipping documentation
- [ ] Notified hub manager of incoming device
- [ ] Provided hub manager with WiFi QR code instructions

---

**Document End**
