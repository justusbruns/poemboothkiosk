# 🖥️ Kiosk Integration Guide - Local Rendering Architecture

**Last Updated:** 2025-01-05
**Status:** Production Ready ✅
**API Version:** 2.0

---

## 📋 Overview

This guide explains how to integrate poem booth kiosk devices with the centralized **Poem Generation + Local Rendering System**. The system uses cloud AI for poem generation while kiosk devices handle branded image rendering locally for optimal performance and offline capability.

### Complete Guest Experience

1. **Guest takes photo** at poem booth kiosk
2. **Poem appears instantly** (3-5 seconds) - displayed in plain text on screen
3. **Loading indicator** shows "Creating your artwork..."
4. **Branded image + QR code appear** (5-10 seconds) - rendered locally on kiosk
5. **Guest scans QR code** → Opens public viewer to download/share
6. **Optional: Guest long-presses** → Prints physical copy (if enabled by hub manager)

### Key Architecture Changes (v2.0)

**🎯 What's New:**
- ✅ **Local rendering** on kiosk devices (faster, no server dependency)
- ✅ **Progressive UX** - Show poem immediately while image renders
- ✅ **Zero-touch provisioning** - WiFi QR scan is the only setup step
- ✅ **Certificate-based authentication** - No JWT tokens, no service role keys
- ✅ **Local AI server support** for offline events (Ollama/LM Studio)
- ✅ **Smart printing** - Hub manager enables, guest chooses via long-press

**📦 What Kiosks Do:**
- Fetch configuration (poem style + branding template)
- Generate AI-powered poems from photos (via cloud or local AI)
- **Render branded images locally** (Sharp + Playwright on device)
- **Upload rendered images to Supabase Storage**
- Generate and display QR codes for guest access
- Support booking-specific customization
- Work offline with local AI server
- Handle optional printing with guest confirmation

**👩‍💼 What Hub Managers Do:**
- Configure branding templates (visual design)
- Assign poem styles (AI behavior)
- **Generate WiFi QR codes** for device setup (one-time)
- Test outputs before events (using server-side rendering)
- Enable/disable printing per booking
- Customize per-booking settings

---

## 🔐 Zero-Touch Device Provisioning

### Overview

Kiosk devices use **certificate-based authentication** with zero-touch provisioning. Devices are pre-configured in the workshop with X.509 certificates containing their equipment assignment, eliminating manual pairing steps for hub managers.

**Key Benefits:**
- ✅ **No manual pairing** - Device knows its assignment from factory
- ✅ **One-step WiFi setup** - Scan WiFi QR code, device auto-registers
- ✅ **Certificate-based auth** - No JWT tokens, no service role keys
- ✅ **Hardware identity** - Cryptographically secure device identity
- ✅ **Instant deployment** - Unbox → scan WiFi → ready to use

### Setup Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                    Zero-Touch Provisioning                        │
└──────────────────────────────────────────────────────────────────┘

Phase 1: Workshop (Pre-Shipment)     Phase 2: Hub Manager (On-Site)
┌──────────────────────────┐         ┌──────────────────────────┐
│  Device Manufacturing    │         │   Device Unboxing        │
│  ────────────────────    │         │   ────────────────       │
│                          │         │                          │
│  1. Run setup script:    │         │  1. Power on device      │
│     npm run setup-device │         │                          │
│     --asset-tag PB-005   │         │  2. Admin portal:        │
│     --hub-id <uuid>      │         │     Profile → WiFi QR    │
│                          │         │                          │
│  2. Generate:            │         │  3. Print WiFi QR code   │
│     ✅ Root CA cert      │         │     ┌─────────────────┐  │
│     ✅ Device cert       │         │     │  █████  █████   │  │
│     ✅ Private key       │         │     │  ██  ██  ██     │  │
│                          │         │     │  █████  █████   │  │
│  3. Embed in cert SAN:   │         │     │     ██  ██      │  │
│     - equipment_id: 5    │         │     │  █████  █████   │  │
│     - hub_id: ams-uuid   │         │     └─────────────────┘  │
│     - device_id: dev-uuid│         │     SSID: EventWiFi      │
│                          │         │     Pass: ********       │
│  4. Store in database:   │         │                          │
│     - registered_devices │         │  4. Hold QR to camera    │
│     - equipment_inv.     │         │     ↓                    │
│                          │         │  ✅ WiFi connected!      │
│  5. Install on device:   │         │  ✅ Auto-registered!     │
│     /etc/poembooth/      │         │  ✅ Ready to use!        │
│     ├─ device.crt        │         │                          │
│     ├─ device.key        │         │  Equipment: PB-005       │
│     └─ ca.crt            │         │  Hub: Amsterdam          │
│                          │         │  Status: Online          │
│  6. Ship to hub →        │         │                          │
└──────────────────────────┘         └──────────────────────────┘
```

### Workshop Pre-Configuration (Phase 1)

**For Technicians/Super Admins:**

This step happens **before shipping devices** to hubs. Run the device setup script to generate certificates and pre-register equipment.

#### Prerequisites

- Node.js 18+ installed
- Database access (service role key in `.env.local`)
- OpenSSL installed
- Equipment assignment ready (asset tag + hub ID)

#### Setup Script

```bash
# In project root directory
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

✅ Step 2: Create Equipment in Database
   Equipment ID:   5
   Status:         available
   Hub:            Amsterdam Hub

✅ Step 3: Generate Device Certificate
   Device ID:      dev-uuid-12345
   Certificate:    /certs/devices/PB-005.crt
   Private Key:    /certs/devices/PB-005.key
   Fingerprint:    SHA256:abc123...

   Certificate SAN (Subject Alternative Names):
   - URI: urn:device:dev-uuid-12345
   - URI: urn:equipment:5
   - URI: urn:hub:abc123-uuid-amsterdam
   - DNS: PB-005.booth.internal

✅ Step 4: Register Device in Database
   Table: registered_devices
   Status: provisioned (awaiting first boot)

✅ Step 5: Update Equipment Record
   device_id: dev-uuid-12345
   device_certificate_fingerprint: SHA256:abc123...

📦 Installation Instructions:

   **On Linux:**
   1. Copy files to device:
      scp /certs/devices/PB-005.crt root@device:/etc/poembooth/
      scp /certs/devices/PB-005.key root@device:/etc/poembooth/
      scp /certs/root-ca.crt root@device:/etc/poembooth/

   2. Set permissions:
      chmod 644 /etc/poembooth/device.crt
      chmod 600 /etc/poembooth/device.key
      chmod 644 /etc/poembooth/ca.crt

   **On Windows (Intel NUC):**
   1. Copy files to device (via USB or network):
      Copy-Item "certs\devices\PB-005.crt" "C:\ProgramData\PoemBooth\device.crt"
      Copy-Item "certs\devices\PB-005.key" "C:\ProgramData\PoemBooth\device.key"
      Copy-Item "certs\root-ca.crt" "C:\ProgramData\PoemBooth\ca.crt"

   2. Set permissions (PowerShell as Administrator):
      icacls "C:\ProgramData\PoemBooth\device.key" /inheritance:r
      icacls "C:\ProgramData\PoemBooth\device.key" /grant:r "SYSTEM:(F)"
      icacls "C:\ProgramData\PoemBooth\device.crt" /grant "Users:(R)"
      icacls "C:\ProgramData\PoemBooth\ca.crt" /grant "Users:(R)"

   **On macOS (Testing):**
   1. Copy files to device (via USB or network):
      sudo cp certs/devices/PB-005.crt "/Library/Application Support/PoemBooth/device.crt"
      sudo cp certs/devices/PB-005.key "/Library/Application Support/PoemBooth/device.key"
      sudo cp certs/root-ca.crt "/Library/Application Support/PoemBooth/ca.crt"

   2. Set permissions:
      sudo chmod 600 "/Library/Application Support/PoemBooth/device.key"
      sudo chmod 644 "/Library/Application Support/PoemBooth/device.crt"
      sudo chmod 644 "/Library/Application Support/PoemBooth/ca.crt"
      sudo chown root:wheel "/Library/Application Support/PoemBooth"/*

   3. Configure Electron app to read certificates
      (see cross-platform path utilities in src/lib/paths.ts)

🚀 Device is ready for shipment!
   Hub managers only need to provide WiFi credentials.
```

**Security Notes:**
- Root CA private key (`root-ca.key`) must be stored securely (offline backup)
- Device private keys are unique per device (never reuse)
- Certificates are valid for 3 years (renewal process in DEVICE_PROVISIONING.md)

### Hub Manager Setup (Phase 2)

**For Hub Managers (On-Site):**

When device arrives at hub location, setup requires only WiFi configuration. No manual equipment assignment needed.

#### Step 1: Generate WiFi QR Code

1. **Open Admin Portal**
   - Navigate to admin dashboard
   - Click profile dropdown (top right)
   - Select **"WiFi QR Code"**

2. **Enter Network Details**
   - **SSID**: Your event WiFi network name
   - **Security**: WPA/WPA2/WPA3 (recommended)
   - **Password**: WiFi password
   - **Hidden Network**: Check if SSID is hidden

3. **Generate and Print**
   - Click **"Generate QR Code"**
   - Print QR code (or download as SVG)
   - QR format: `WIFI:T:WPA;S:YourSSID;P:YourPassword;;`

#### Step 2: Device First Boot

1. **Power On Device**
   - Device boots into Electron app
   - App detects no WiFi connection
   - Shows **"Hold WiFi QR Code in Front of Camera"** screen

2. **Scan WiFi QR**
   - Hold printed QR code in front of device camera
   - App automatically:
     - Extracts WiFi credentials
     - Connects to network
     - Saves credentials for future boots

3. **Automatic Registration**
   - Once connected, device calls `/api/devices/register`
   - Sends device certificate in `Authorization: Bearer <cert>`
   - API validates certificate and registers device
   - Device receives configuration immediately

4. **Ready to Use**
   - Device displays:
     - ✅ Equipment: PB-005
     - ✅ Hub: Amsterdam
     - ✅ Status: Online
     - ✅ Last Config Update: 2 seconds ago
   - Automatically fetches poem style and branding
   - Ready for guests

**Total Setup Time:** ~30 seconds (unbox → scan WiFi → ready)

### Certificate Authentication

#### How It Works

Instead of JWT tokens, devices authenticate using X.509 certificates signed by a trusted root CA.

**Certificate Structure:**
```
Subject: CN=PB-005, O=Poem Booth, OU=Amsterdam Hub
Issuer: CN=Poem Booth Root CA
Valid From: 2025-01-01 00:00:00 UTC
Valid To: 2028-01-01 00:00:00 UTC (3 years)

Subject Alternative Names (SAN):
  - URI: urn:device:dev-uuid-12345
  - URI: urn:equipment:5
  - URI: urn:hub:abc123-uuid-amsterdam
  - DNS: PB-005.booth.internal

Public Key: RSA 4096-bit
Signature Algorithm: SHA256-RSA
```

**API Request Example:**
```typescript
// Kiosk reads certificate from local filesystem
const certificate = fs.readFileSync('/etc/poembooth/device.crt', 'utf8')
const certificateBase64 = Buffer.from(certificate).toString('base64')

// Send certificate in Authorization header
const response = await fetch('https://book.poembooth.com/api/kiosk/config', {
  headers: {
    'Authorization': `Bearer ${certificateBase64}`
  }
})
```

**Server-Side Validation:**
```typescript
// src/lib/certificate-auth.ts
export async function validateCertificateFromHeader(authHeader: string) {
  // 1. Extract certificate from header
  const certBase64 = authHeader.substring(7) // Remove "Bearer "
  const certificatePem = Buffer.from(certBase64, 'base64').toString('utf-8')

  // 2. Parse certificate
  const cert = parseCertificate(certificatePem)

  // 3. Verify signature against trusted CA (using anon client + RLS)
  const isValidSignature = await verifyCertificateSignature(cert)

  // 4. Check validity period
  if (new Date() < cert.validFrom || new Date() > cert.validTo) {
    return { valid: false, error: 'Certificate expired' }
  }

  // 5. Check revocation status (using anon client + RLS)
  const isRevoked = await isCertificateRevoked(cert.fingerprint)
  if (isRevoked) {
    return { valid: false, error: 'Certificate revoked' }
  }

  // 6. Extract device context from SAN
  const deviceContext = extractDeviceContext(cert)
  // { deviceId, equipmentId, hubId }

  // 7. Verify equipment assignment in database (using anon client + RLS)
  const equipment = await verifyEquipmentAssignment(deviceContext)

  return {
    valid: true,
    deviceContext: {
      deviceId: deviceContext.deviceId,
      equipmentId: deviceContext.equipmentId,
      hubId: deviceContext.hubId
    }
  }
}
```

### Security Features

✅ **No service role keys in production** - All API routes use anon client + RLS
✅ **Certificate-based identity** - Cryptographically secure device identity
✅ **Embedded equipment assignment** - No manual pairing or database lookups
✅ **Revocation support** - Compromised certificates can be invalidated
✅ **RLS enforcement** - Database policies restrict device to own equipment data
✅ **Audit trail** - All certificate usage logged with fingerprints
✅ **Long-lived credentials** - 3-year validity (no frequent rotation needed)
✅ **Offline verification** - Certificate validation works without database queries

### API Endpoints (Zero-Touch)

#### `POST /api/devices/register`
**Authentication:** Device certificate (in Authorization header)

**Purpose:** First contact endpoint - registers device and confirms connectivity

**Request Headers:**
```
Authorization: Bearer <base64-encoded-certificate>
```

**Request Body:**
```json
{
  "device_info": {
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "ip_address": "192.168.1.105",
    "platform": "linux",
    "app_version": "2.0.0",
    "wifi_ssid": "EventWiFi"
  }
}
```

**Response:**
```json
{
  "success": true,
  "device": {
    "device_id": "dev-uuid-12345",
    "equipment_id": 5,
    "equipment_name": "PB-005",
    "hub_id": "abc123-uuid-amsterdam",
    "hub_name": "Amsterdam Hub",
    "status": "active",
    "certificate_expires_at": "2028-01-01T00:00:00Z"
  },
  "config_endpoint": "/api/kiosk/config",
  "generate_endpoint": "/api/kiosk/generate"
}
```

**Error Responses:**
- `401` - Invalid certificate signature
- `401` - Certificate expired
- `401` - Certificate revoked
- `404` - Equipment not found in database
- `500` - Database error

**Rate Limiting:** 10 requests/minute per IP

---

## 🏗️ Architecture

### System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Cloud Infrastructure                        │
│  ┌──────────────────────┐       ┌─────────────────────────┐   │
│  │  Booking System API  │       │  Fly.io Rendering       │   │
│  │  (Next.js on Vercel) │       │  (Admin Testing Only)   │   │
│  │                      │       │                         │   │
│  │  - Poem generation   │       │  - Server-side render   │   │
│  │  - Configuration     │       │  - Test previews        │   │
│  │  - Authentication    │       │  - JWT authenticated    │   │
│  └──────────┬───────────┘       └─────────────────────────┘   │
│             │                                                   │
│             │ HTTPS + Certificate Auth                          │
└─────────────┼───────────────────────────────────────────────────┘
              │
              │ X.509 Certificate Auth
              │
┌─────────────▼──────────────────────────────────────────────────┐
│                        Kiosk Device                             │
│  ┌────────────────────────────────────────────────────────┐    │
│  │               Electron App (Poem Booth)                │    │
│  ├────────────────────────────────────────────────────────┤    │
│  │  Phase 1: Photo Capture                                │    │
│  │  ├─ Camera API                                         │    │
│  │  └─ Image preprocessing                                │    │
│  │                                                         │    │
│  │  Phase 2: Poem Generation (Cloud/Local AI)            │    │
│  │  ├─ POST /api/kiosk/generate                          │    │
│  │  ├─ OR call local AI server (offline mode)            │    │
│  │  └─ Display poem text immediately                      │    │
│  │                                                         │    │
│  │  Phase 3: Image Rendering (LOCAL)                     │    │
│  │  ├─ Sharp (image compositing)                         │    │
│  │  ├─ Playwright (text overlay)                         │    │
│  │  └─ Photo filters                                     │    │
│  │                                                         │    │
│  │  Phase 4: Upload to Cloud                             │    │
│  │  ├─ POST /api/kiosk/upload-session                    │    │
│  │  └─ Certificate-based authentication                   │    │
│  │                                                         │    │
│  │  Phase 5: Display QR Code                             │    │
│  │  ├─ Generate QR from public_view_url                  │    │
│  │  └─ Show "Long press to print" hint                   │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Dependencies:                                                  │
│  - Node.js 18+                                                  │
│  - Sharp (image processing)                                     │
│  - Playwright + Chromium (text rendering)                       │
│  - QR Code library (qrcode npm package)                         │
│                                                                 │
│  Local AI Server (Optional - Offline Mode):                     │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Ollama / LM Studio (Separate Machine)                 │    │
│  │  - LLaVA 13B (vision model for captions)               │    │
│  │  - Mistral 7B (text model for poems)                   │    │
│  │  - Connected via ethernet (192.168.1.x)                │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Printer (Optional - USB/Network):                              │
│  └─ Direct printing via CUPS or native Electron API            │
└─────────────────────────────────────────────────────────────────┘
```

### Guest Flow (Timeline)

```
Time    Action                           Technology
────────────────────────────────────────────────────────────────
0:00    Guest presses "Take Photo"       Camera API
0:01    Photo captured, preview shown    Image display
0:01    "Generating poem..." appears     Loading UI

        [Poem generation starts]
0:02    Call API or local AI server      HTTPS / Local network
0:05    Poem text appears on screen      Plain text display
        "Creating your artwork..."       Loading spinner

        [Local rendering starts]
0:05    Load branding template           Local cache
0:06    Render photo + filters           Sharp library
0:07    Render text overlay              Playwright + Chromium
0:08    Composite final image            Sharp compositing

        [Upload to cloud]
0:09    Upload rendered image            POST /upload-session
0:10    Receive public_view_url          API response
        Generate QR code                 qrcode library

0:10    Display image + QR code          Final UI
        "Scan to download!"
        "Long press to print" (if enabled)

        [Guest interaction]
0:15    Guest scans QR code              → Opens /view/{sessionId}
        OR Guest long-presses button     → Print job sent
────────────────────────────────────────────────────────────────
Total: 10 seconds from photo to QR code
```

### Technical Flow (Detailed)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Device Startup & Configuration                               │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> Load device certificate (from /etc/poembooth/device.crt)
   │   ├─> If missing → Show "Device Not Provisioned" screen
   │   ├─> If expired → Show "Certificate Expired" screen
   │   └─> If valid → Continue
   │
   ├─> GET /api/kiosk/config
   │   Headers: Authorization: Bearer {base64_certificate}
   │   Response: { style, branding_template, printing_enabled, ... }
   │
   ├─> Cache configuration locally (24h TTL)
   │   - Poem style (caption + poem prompts)
   │   - Branding template (layout, fonts, colors)
   │   - Booking variables (if booking active)
   │   - Quality settings (standard/hd)
   │
   └─> Display "Ready" screen
       └─> "Press to start"

┌─────────────────────────────────────────────────────────────────┐
│ 2. Photo Capture                                                 │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> Guest presses button
   ├─> Camera activates (countdown: 3, 2, 1...)
   ├─> Capture photo (high resolution: 3000x4000px)
   ├─> Show preview (3 seconds)
   └─> Guest confirms or retakes

┌─────────────────────────────────────────────────────────────────┐
│ 3. Poem Generation (Cloud or Local AI)                          │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> Display "Generating poem..." loading screen
   │
   ├─> **Cloud Mode (Default):**
   │   │
   │   ├─> POST /api/kiosk/generate
   │   │   Headers: Authorization: Bearer {base64_certificate}
   │   │   Body: {
   │   │     booking_id: "uuid" (optional),
   │   │     image_data: "base64...",
   │   │     image_type: "image/jpeg",
   │   │     variables: { couple_names: "Alice & Bob" }
   │   │   }
   │   │
   │   ├─> API processes:
   │   │   1. Generate caption (GPT-4V / Claude Vision / Gemini)
   │   │   2. Generate poem (GPT-4 / Claude / Gemini)
   │   │   3. Return immediately (NO rendering)
   │   │
   │   └─> Response (3-5 seconds):
   │       {
   │         "caption": "A smiling couple...",
   │         "poem": "In moments captured...",
   │         "session_id": "session-uuid",
   │         "branding_config": {
   │           "template": { /* full template */ },
   │           "quality": "standard" | "hd"
   │         }
   │       }
   │
   └─> **Local Mode (Offline):**
       │
       ├─> Check local AI server connectivity
       │   └─> Ping http://192.168.1.100:11434/api/tags
       │
       ├─> Generate caption locally:
       │   POST http://192.168.1.100:11434/api/generate
       │   Body: {
       │     model: "llava:13b",
       │     prompt: "Describe this photo...",
       │     images: ["base64..."]
       │   }
       │   Response: { response: "A smiling couple..." }
       │
       ├─> Generate poem locally:
       │   POST http://192.168.1.100:11434/api/generate
       │   Body: {
       │     model: "mistral:7b-instruct",
       │     prompt: "Write a poem about: {caption}..."
       │   }
       │   Response: { response: "In moments captured..." }
       │
       └─> Use cached branding configuration

┌─────────────────────────────────────────────────────────────────┐
│ 4. Display Poem Immediately                                     │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> Hide loading screen
   ├─> Display poem text (plain font, readable size)
   │   ┌─────────────────────────────────────────────┐
   │   │  In moments captured, love does shine      │
   │   │  Two hearts as one dispel the gloom        │
   │   │  Alice and Bob, on this blessed day        │
   │   │  October 30, 2025, love finds its way      │
   │   └─────────────────────────────────────────────┘
   │
   └─> Show loading spinner below:
       "Creating your artwork..."

┌─────────────────────────────────────────────────────────────────┐
│ 5. Render Branded Image (LOCAL - Async)                         │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> Load branding template from cache
   │   - Background (color or image)
   │   - Photo position, size, borders
   │   - Text position, fonts, colors
   │   - Output dimensions, DPI, format
   │
   ├─> **Step 1: Create Background Canvas**
   │   └─> Using Sharp:
   │       const canvas = sharp({
   │         create: {
   │           width: template.output_width,
   │           height: template.output_height,
   │           channels: 3,
   │           background: template.background_color
   │         }
   │       })
   │
   ├─> **Step 2: Process Photo**
   │   └─> Using Sharp:
   │       1. Resize to template.photo_width x template.photo_height
   │       2. Apply filter (if specified):
   │          - vintage, noir, sepia, polaroid, etc.
   │       3. Add border (if specified)
   │       4. Round corners (if border_radius > 0)
   │
   ├─> **Step 3: Composite Photo onto Canvas**
   │   └─> Using Sharp:
   │       canvas.composite([{
   │         input: processedPhotoBuffer,
   │         top: template.photo_position_y,
   │         left: template.photo_position_x
   │       }])
   │
   ├─> **Step 4: Render Text Overlay**
   │   └─> Using Playwright (local Chromium):
   │       1. Create HTML with poem text
   │       2. Apply template typography:
   │          - font_family, font_size, font_weight
   │          - text_align, line_height, letter_spacing
   │          - text_shadow (if enabled)
   │       3. Auto-size text to fit text_height
   │       4. Render to PNG buffer
   │       5. Make background transparent
   │
   ├─> **Step 5: Composite Text onto Canvas**
   │   └─> Using Sharp:
   │       canvas.composite([{
   │         input: textOverlayBuffer,
   │         top: template.text_position_y,
   │         left: template.text_position_x,
   │         blend: 'over'
   │       }])
   │
   └─> **Step 6: Export Final Image**
       └─> const finalImageBuffer = await canvas
             .png({ compressionLevel: 9 })  // or .jpeg({ quality: 90 })
             .toBuffer()

┌─────────────────────────────────────────────────────────────────┐
│ 6. Upload Rendered Image to Supabase Storage                    │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> POST /api/kiosk/upload-session
   │   Headers: Authorization: Bearer {device_token}
   │   Body: {
   │     session_id: "session-uuid",
   │     booking_id: "booking-uuid" (optional),
   │     image_data: "base64...",
   │     image_format: "png" | "jpeg",
   │     quality: "standard" | "hd"
   │   }
   │
   ├─> API processes:
   │   1. Validate device token
   │   2. Check equipment permissions (RLS)
   │   3. Upload to Supabase Storage:
   │      - Path: {booking_id}/{session_id}.png
   │      - Or: default/{session_id}.png
   │   4. Create/update session_logs entry:
   │      - rendered_image_url
   │      - public_view_url
   │      - storage_path
   │      - expires_at (24h or null if permanent)
   │      - is_permanent (check for "Digitaal pakket")
   │
   └─> Response (1-2 seconds):
       {
         "success": true,
         "storage_url": "https://xxx.supabase.co/storage/.../session-uuid.png",
         "public_view_url": "https://book.poembooth.com/view/session-uuid",
         "expires_at": "2025-01-05T10:30:00Z" | null,
         "is_permanent": false | true
       }

┌─────────────────────────────────────────────────────────────────┐
│ 7. Generate & Display QR Code                                   │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> Generate QR code from public_view_url:
   │   └─> Using qrcode library:
   │       const qrDataUrl = await QRCode.toDataURL(
   │         public_view_url,
   │         {
   │           width: 400,
   │           margin: 2,
   │           errorCorrectionLevel: 'H',
   │           color: { dark: '#000', light: '#FFF' }
   │         }
   │       )
   │
   ├─> Update UI:
   │   ┌─────────────────────────────────────────────┐
   │   │  [Branded Image Display]                   │
   │   │  (Full resolution poem image)              │
   │   │                                             │
   │   │         ┌───────────────┐                  │
   │   │         │  QR CODE      │                  │
   │   │         │  █████  █████ │                  │
   │   │         │  ██  ██  ██   │                  │
   │   │         │  █████  █████ │                  │
   │   │         └───────────────┘                  │
   │   │                                             │
   │   │  Scan to download your poem!               │
   │   │                                             │
   │   │  [Long press here to print]  (if enabled) │
   │   └─────────────────────────────────────────────┘
   │
   ├─> Show expiration notice (if applicable):
   │   "Available for 24 hours"
   │   OR "Saved permanently with Digitaal pakket"
   │
   └─> Start timeout (60 seconds):
       └─> Return to "Ready" screen

┌─────────────────────────────────────────────────────────────────┐
│ 8. Guest Interaction                                            │
└─────────────────────────────────────────────────────────────────┘
   │
   ├─> **Option A: Scan QR Code**
   │   │
   │   ├─> Guest scans with phone camera
   │   ├─> Opens: https://book.poembooth.com/view/{session_id}
   │   └─> Public viewer page shows:
   │       - Full branded image
   │       - Download button
   │       - Share button (Web Share API)
   │       - Poem text (collapsible)
   │       - Expiration notice (if applicable)
   │
   └─> **Option B: Print (if enabled)**
       │
       ├─> Guest long-presses print button (2 seconds)
       ├─> Confirmation dialog: "Print your poem?"
       ├─> If confirmed:
       │   1. Send image to printer (USB/CUPS)
       │   2. Show "Printing..." status
       │   3. Increment session_logs.metadata.print_count
       │   4. Show "Printed!" confirmation
       │
       └─> Print settings:
           - Format: PNG (high quality)
           - Size: From branding template (e.g., 4x6 inches)
           - DPI: 300 (if quality = "hd"), 72 (if "standard")
```

---

## 🔌 API Endpoints

### 1. Fetch Configuration

**Endpoint:** `GET /api/kiosk/config`

**Purpose:** Retrieve the kiosk's configuration including poem style, branding template, and current booking settings.

**Authentication:** Device token (Bearer token in Authorization header)

**Query Parameters:**
```typescript
{
  equipment_id: number  // Equipment inventory ID
}
```

**Example Request:**
```bash
curl -X GET "https://book.poembooth.com/api/kiosk/config?equipment_id=5" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Success Response (200 OK) - Multi-Style Configuration v2.0:**
```json
{
  "success": true,
  "config": {
    "equipment_id": 5,
    "equipment_name": "Booth #5 - Amsterdam",
    "equipment_type": {
      "id": 1,
      "name": "Model 4",
      "category": "booth"
    },
    "hub": {
      "id": "hub-uuid",
      "name": "Amsterdam Hub",
      "region_code": "NL"
    },
    "booking_id": "booking-uuid",  // NEW: null if no active booking
    "style_configs": [              // NEW: Array of styles for knob positions
      {
        "position": 1,              // Knob position number
        "poem_style": {
          "id": "style-uuid-1",
          "name": "Romantic Wedding Style",
          "description": "Elegant poems for wedding events",
          "custom_variables": [
            {
              "name": "couple_names",
              "placeholder": "John & Jane",
              "description": "Names of the couple"
            }
          ]
        },
        "caption_generation": {
          "provider": "anthropic",
          "model_id": "claude-3-5-sonnet-20241022",
          "prompt": "Describe this wedding photo in 2-3 sentences..."
        },
        "poem_generation": {
          "provider": "anthropic",
          "model_id": "claude-3-5-sonnet-20241022",
          "prompt": "Write a romantic poem about: {caption}. Include {couple_names}..."
        },
        "action_button_text": "Press for Romance",  // NEW: Custom action text
        "branding_template": {
          "id": "template-uuid",
          "name": "Elegant Wedding Template",
          "config": {
            "background_type": "color",
            "background_color": "#f8f8f8",
            "photo_position_x": 100,
            "photo_position_y": 100,
            "photo_width": 800,
            "photo_height": 800,
            "photo_border_radius": 20,
            "photo_filter": "vintage",
            "text_position_x": 100,
            "text_position_y": 950,
            "text_width": 800,
            "text_height": 300,
            "font_family": "Georgia, serif",
            "font_size": 32,
            "font_color": "#333333",
            "output_width": 1000,
            "output_height": 1400,
            "output_dpi": 300,
            "output_format": "png"
          }
        },
        "variables": {                // NEW: Booking-specific variable values
          "couple_names": "Alice & Bob"
        }
      },
      {
        "position": 2,                // Second knob position
        "poem_style": {
          "id": "style-uuid-2",
          "name": "Playful Party Style",
          "description": "Fun and lighthearted poems",
          "custom_variables": []
        },
        "caption_generation": { /* ... */ },
        "poem_generation": { /* ... */ },
        "action_button_text": "Turn for Fun",
        "branding_template": { /* ... */ }
      }
    ],
    "wifi_credentials": {          // NEW: WiFi configuration
      "ssid": "EventWiFi_2025",
      "password": "WeddingGuest123"
    },
    "last_updated": "2025-01-04T10:15:00Z"
  }
}
```

**Key Changes in v2.0:**
- **`booking_id`**: Now returned directly (null if no active booking)
- **`style_configs`**: Array of styles instead of single `style` object
- **`position`**: Physical knob position for each style (1, 2, 3, etc.)
- **`action_button_text`**: Custom text per position (e.g., "Press for Romance", "Turn for Fun")
- **`wifi_credentials`**: WiFi SSID and password from booking configuration
- **`variables`**: Booking-specific values for custom variables (per style)

**Backward Compatibility:**
- If `style_configs` is empty, kiosk should fall back to hub defaults
- Old single-style bookings are automatically migrated to position 1

**Branding Template Hierarchy:**

The system uses a hierarchical approach to determine which branding template to apply:

1. **Booking-specific branding** (highest priority)
   - If a booking has a `branding_template_id` set, that template is used
   - Allows per-event customization (e.g., corporate colors, wedding themes)

2. **Hub default branding** (fallback)
   - Each hub can configure a `default_branding_template_id`
   - Applied when no booking-specific branding exists
   - Configured via `/admin/hub/default-styles` page

3. **System default template** (last resort)
   - Used if hub has no default configured
   - Ensures kiosks always have valid branding

**Example:**
- **Booking exists with custom template** → Use booking's branding
- **Booking exists without custom template** → Use hub's default branding
- **No booking (testing mode)** → Use hub's default branding
- **Hub has no default** → Use system default template

**Error Responses:**

**401 Unauthorized** - Invalid or missing device token:
```json
{
  "error": "Unauthorized",
  "message": "Invalid device token",
  "code": "INVALID_TOKEN"
}
```

**403 Forbidden** - Token valid but not for this equipment:
```json
{
  "error": "Forbidden",
  "message": "This token is not authorized for equipment #5",
  "code": "TOKEN_EQUIPMENT_MISMATCH"
}
```

**404 Not Found** - Equipment not registered:
```json
{
  "error": "Equipment not found",
  "message": "Equipment #5 does not exist or has been removed"
}
```

**424 Failed Dependency** - No style configured:
```json
{
  "error": "No poem style configured",
  "message": "This equipment does not have a default poem style configured",
  "equipment_id": 5,
  "hub": { "name": "Amsterdam Hub" },
  "action_required": "Contact your hub manager to configure a default poem style"
}
```

**503 Service Unavailable** - Equipment under maintenance:
```json
{
  "error": "Equipment not available",
  "message": "This equipment is currently under maintenance",
  "status": "maintenance",
  "equipment_id": 5
}
```

---

### 2. Generate Poem (Cloud or Local AI)

**Endpoint:** `POST /api/kiosk/generate`

**Purpose:** Generate a poem from a photo using AI (caption + poem only, NO rendering).

**Authentication:** Device token (Bearer token in Authorization header)

**Request Body:**
```typescript
{
  equipment_id: number                    // Equipment inventory ID
  booking_id?: string                     // Optional: UUID of active booking
  image_data: string                      // Base64 encoded image (without prefix)
  image_type: "image/jpeg" | "image/png"  // Image MIME type
  variables?: Record<string, string>      // Optional: Override booking variables
}
```

**Example Request:**
```bash
curl -X POST "https://book.poembooth.com/api/kiosk/generate" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "equipment_id": 5,
    "booking_id": "booking-uuid",
    "image_data": "/9j/4AAQSkZJRgABAQAAAQABAAD...",
    "image_type": "image/jpeg",
    "variables": {
      "couple_names": "Alice & Bob",
      "wedding_date": "January 10, 2025"
    }
  }'
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "caption": "A joyful couple dancing together at their wedding reception, surrounded by twinkling lights and happy guests",
  "poem": "In moments captured, love does shine,\nTwo hearts as one dispel the gloom,\nAlice and Bob, on this blessed day,\nJanuary 10, 2025, love finds its way...",
  "session_id": "session-uuid-123",
  "branding_config": {
    "template": {
      "id": "template-uuid",
      "name": "Elegant Wedding Template",
      "background_type": "color",
      "background_color": "#f8f8f8",
      "photo_position_x": 100,
      "photo_position_y": 100,
      "photo_width": 800,
      "photo_height": 800,
      "photo_border_radius": 20,
      "photo_border_width": 10,
      "photo_border_color": "#ffffff",
      "photo_filter": "vintage",
      "text_position_x": 100,
      "text_position_y": 950,
      "text_width": 800,
      "text_height": 300,
      "text_align": "center",
      "text_vertical_align": "center",
      "font_family": "Georgia, serif",
      "font_size": 32,
      "font_weight": 400,
      "font_color": "#333333",
      "line_height": 1.5,
      "letter_spacing": 0,
      "text_shadow_enabled": true,
      "text_shadow_color": "#00000033",
      "text_shadow_blur": 4,
      "text_background_enabled": false,
      "output_width": 1000,
      "output_height": 1400,
      "output_dpi": 300,
      "output_format": "png"
    },
    "quality": "hd"
  },
  "metadata": {
    "equipment_id": 5,
    "equipment_name": "Booth #5 - Amsterdam",
    "hub": {
      "id": "hub-uuid",
      "name": "Amsterdam Hub",
      "region_code": "NL"
    },
    "style_id": "style-uuid",
    "caption_provider": "anthropic",
    "caption_model": "claude-3-5-sonnet-20241022",
    "poem_provider": "anthropic",
    "poem_model": "claude-3-5-sonnet-20241022",
    "processing_time": {
      "caption_ms": 1250,
      "poem_ms": 2100,
      "total_ms": 3350
    },
    "timestamp": "2025-01-04T10:20:15Z",
    "variables_used": ["couple_names", "wedding_date"]
  }
}
```

**Important Notes:**
- ⚠️ **No rendered image in response** - Kiosk must render locally
- ⚠️ **No upload to Storage yet** - Kiosk uploads after rendering
- ✅ **Session created in database** - But without image URLs yet
- ✅ **Branding config included** - For local rendering

**Error Responses:**

**400 Bad Request** - Invalid request body:
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "image_data",
      "message": "Image data is required"
    }
  ]
}
```

**401 Unauthorized** - Invalid device token:
```json
{
  "error": "Unauthorized",
  "code": "INVALID_TOKEN"
}
```

**404 Not Found** - Equipment not found:
```json
{
  "error": "Equipment not found"
}
```

**424 Failed Dependency** - No style configured:
```json
{
  "error": "No poem style configured",
  "equipment_id": 5
}
```

**502 Bad Gateway** - AI generation failed:
```json
{
  "error": "AI generation failed",
  "message": "Caption generation failed: API timeout",
  "provider": "anthropic",
  "suggestion": "Check AI provider status and try again"
}
```

**503 Service Unavailable** - Equipment not available:
```json
{
  "error": "Equipment not available",
  "message": "Equipment status: maintenance"
}
```

---

### 3. Upload Rendered Image (NEW)

**Endpoint:** `POST /api/kiosk/upload-session`

**Purpose:** Upload the locally rendered branded image to Supabase Storage and get public viewer URL.

**Authentication:** Device token (Bearer token in Authorization header)

**Request Body:**
```typescript
{
  session_id: string                      // UUID from /generate response
  booking_id?: string                     // Optional: UUID of active booking
  image_data: string                      // Base64 encoded rendered image
  image_format: "png" | "jpeg"            // Image format
  quality: "standard" | "hd"              // Quality setting (from config)
}
```

**Example Request:**
```bash
curl -X POST "https://book.poembooth.com/api/kiosk/upload-session" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session-uuid-123",
    "booking_id": "booking-uuid",
    "image_data": "iVBORw0KGgoAAAANSUhEUgAA...",
    "image_format": "png",
    "quality": "hd"
  }'
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "storage_url": "https://xtgxfighvyybzcxfimvs.supabase.co/storage/v1/object/public/poem-outputs/booking-uuid/session-uuid-123.png",
  "public_view_url": "https://book.poembooth.com/view/session-uuid-123",
  "storage_path": "booking-uuid/session-uuid-123.png",
  "expires_at": "2025-01-05T10:30:00Z",
  "is_permanent": false,
  "metadata": {
    "file_size_bytes": 2048576,
    "upload_time_ms": 1250,
    "storage_bucket": "poem-outputs"
  }
}
```

**Permanent Storage (Digitaal Pakket):**
```json
{
  "success": true,
  "storage_url": "https://...",
  "public_view_url": "https://book.poembooth.com/view/session-uuid-123",
  "storage_path": "booking-uuid/session-uuid-123.png",
  "expires_at": null,
  "is_permanent": true,
  "metadata": {
    "file_size_bytes": 2048576,
    "upload_time_ms": 1250,
    "storage_bucket": "poem-outputs",
    "retention": "permanent"
  }
}
```

**What Happens on Backend:**
1. Validates device token and equipment permissions
2. Checks session_id exists (created by /generate)
3. Decodes base64 image data
4. Uploads to Supabase Storage:
   - Path: `{booking_id}/{session_id}.{format}`
   - Or: `default/{session_id}.{format}` (if no booking)
5. Updates `session_logs` table:
   - `rendered_image_url` = Storage public URL
   - `public_view_url` = `/view/{session_id}`
   - `storage_path` = Internal path for cleanup
   - `expires_at` = 24 hours or null (if Digitaal pakket)
   - `is_permanent` = true/false
6. Returns URLs and expiration info

**Error Responses:**

**401 Unauthorized** - Invalid device token:
```json
{
  "error": "Unauthorized",
  "code": "INVALID_TOKEN"
}
```

**404 Not Found** - Session not found:
```json
{
  "error": "Session not found",
  "message": "No session exists with ID: session-uuid-123",
  "suggestion": "Ensure /generate was called first"
}
```

**413 Payload Too Large** - Image too big:
```json
{
  "error": "Image too large",
  "message": "Rendered image size (15.2 MB) exceeds limit (10 MB)",
  "suggestion": "Reduce image dimensions or use JPEG format with lower quality"
}
```

**500 Internal Server Error** - Upload failed:
```json
{
  "error": "Upload failed",
  "message": "Failed to upload to Supabase Storage",
  "details": "Storage API error: ...",
  "suggestion": "Check network connection and retry"
}
```

---

### 4. Token Refresh

**Endpoint:** `POST /api/kiosk/refresh-token`

**Purpose:** Obtain a new device token before the current one expires.

**Authentication:** Current device token (even if expired < 7 days)

**Request Body:**
```typescript
{
  current_token: string  // Current JWT token
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "device_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_expires_at": "2025-02-03T10:30:00Z",
  "equipment_id": 5,
  "hub_id": "hub-uuid-amsterdam"
}
```

**Error Response (401):**
```json
{
  "error": "Token cannot be refreshed",
  "message": "Token expired more than 7 days ago",
  "action_required": "Re-pair device using QR code"
}
```

---

## 🎨 Local Rendering Guide

This section explains how to implement local branded image rendering in the kiosk Electron app.

### Prerequisites

**System Requirements:**
- **Node.js:** 18+ (LTS recommended)
- **Operating System:** Linux (Ubuntu 22.04+), Windows 10+, or macOS 12+
- **RAM:** 4GB minimum (8GB recommended)
- **Storage:** 500MB for dependencies (Chromium binary)
- **Network:** Internet for initial setup (offline after dependencies installed)

**NPM Packages:**
```bash
npm install sharp@^0.33.0
npm install playwright@^1.40.0
npm install qrcode@^1.5.3
```

**Install Playwright Chromium:**
```bash
npx playwright install chromium
```

**Verify Installation:**
```bash
# Check Sharp
node -e "const sharp = require('sharp'); console.log('Sharp version:', sharp.versions)"

# Check Playwright
npx playwright --version

# Check Chromium (Linux/macOS)
ls ~/.cache/ms-playwright/chromium-*  # Linux
ls ~/Library/Caches/ms-playwright/chromium-*  # macOS

# Check Chromium (Windows)
dir "$env:LOCALAPPDATA\ms-playwright\chromium-*"
```

### Rendering Pipeline

#### Step 1: Fetch Branding Configuration

```typescript
// kiosk-config.ts
import { deviceToken, equipmentId } from './device-storage'

interface BrandingTemplate {
  id: string
  name: string
  background_type: 'color' | 'image'
  background_color?: string
  background_image_url?: string
  photo_position_x: number
  photo_position_y: number
  photo_width: number
  photo_height: number
  photo_border_radius: number
  photo_border_width: number
  photo_border_color: string
  photo_filter: string
  text_position_x: number
  text_position_y: number
  text_width: number
  text_height: number
  text_align: 'left' | 'center' | 'right'
  text_vertical_align: 'top' | 'center' | 'bottom'
  font_family: string
  font_size: number
  font_weight: number
  font_color: string
  line_height: number
  letter_spacing: number
  text_shadow_enabled: boolean
  text_shadow_color?: string
  text_shadow_blur?: number
  text_background_enabled: boolean
  text_background_color?: string
  output_width: number
  output_height: number
  output_dpi: number
  output_format: 'png' | 'jpeg'
}

async function fetchBrandingConfig(): Promise<BrandingTemplate> {
  const response = await fetch(
    `https://book.poembooth.com/api/kiosk/config?equipment_id=${equipmentId}`,
    {
      headers: {
        'Authorization': `Bearer ${deviceToken}`
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch config: ${response.status}`)
  }

  const { config } = await response.json()
  return config.branding_template
}

// Cache configuration for 24 hours
const configCache = {
  template: null as BrandingTemplate | null,
  cachedAt: 0,
  TTL: 24 * 60 * 60 * 1000  // 24 hours
}

export async function getBrandingTemplate(): Promise<BrandingTemplate> {
  const now = Date.now()

  if (configCache.template && (now - configCache.cachedAt < configCache.TTL)) {
    console.log('Using cached branding template')
    return configCache.template
  }

  console.log('Fetching fresh branding template...')
  const template = await fetchBrandingConfig()

  configCache.template = template
  configCache.cachedAt = now

  return template
}
```

#### Step 2: Apply Photo Filters

```typescript
// photo-filters.ts
import sharp from 'sharp'

export type PhotoFilter =
  | 'none'
  | 'vintage'
  | 'noir'
  | 'sepia'
  | 'polaroid'
  | 'berlin'
  | 'cinematic'
  | 'golden_hour'
  | 'cool_blue'
  | 'warm_embrace'
  | 'dreamy'
  | 'pop_art'

export async function applyPhotoFilter(
  imageBuffer: Buffer,
  filterName: PhotoFilter
): Promise<Buffer> {
  let pipeline = sharp(imageBuffer)

  switch (filterName) {
    case 'none':
      // No filter
      break

    case 'vintage':
      pipeline = pipeline
        .modulate({ saturation: 0.7, brightness: 0.9 })
        .tint({ r: 255, g: 240, b: 220 })
      break

    case 'noir':
      pipeline = pipeline
        .grayscale()
        .linear(1.2, -(0.1 * 255))  // Increase contrast
        .gamma(1.1)
      break

    case 'sepia':
      pipeline = pipeline
        .tint({ r: 112, g: 66, b: 20 })
        .modulate({ saturation: 0.8, brightness: 0.9 })
      break

    case 'polaroid':
      pipeline = pipeline
        .modulate({ saturation: 0.6, brightness: 1.1 })
        .tint({ r: 255, g: 250, b: 240 })
      break

    case 'berlin':
      pipeline = pipeline
        .modulate({ saturation: 0.5, brightness: 0.95 })
        .tint({ r: 200, g: 210, b: 220 })
      break

    case 'cinematic':
      pipeline = pipeline
        .modulate({ saturation: 1.2 })
        .tint({ r: 255, g: 230, b: 200 })  // Warm highlights
      break

    case 'golden_hour':
      pipeline = pipeline
        .modulate({ saturation: 1.1, brightness: 1.05 })
        .tint({ r: 255, g: 220, b: 180 })
      break

    case 'cool_blue':
      pipeline = pipeline
        .modulate({ saturation: 0.9, brightness: 0.95 })
        .tint({ r: 200, g: 220, b: 255 })
      break

    case 'warm_embrace':
      pipeline = pipeline
        .modulate({ saturation: 1.3, brightness: 1.02 })
        .tint({ r: 255, g: 210, b: 190 })
      break

    case 'dreamy':
      pipeline = pipeline
        .modulate({ saturation: 0.7, brightness: 1.1 })
        .blur(1)
      break

    case 'pop_art':
      pipeline = pipeline
        .modulate({ saturation: 1.8, brightness: 1.1 })
        .linear(1.3, 0)  // High contrast
      break

    default:
      console.warn(`Unknown filter: ${filterName}, using 'none'`)
  }

  return await pipeline.toBuffer()
}
```

#### Step 3: Render Text Overlay with Playwright

```typescript
// text-renderer.ts
import { chromium } from 'playwright'

interface TextRenderOptions {
  text: string
  width: number
  height: number
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  textAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'center' | 'bottom'
  lineHeight: number
  letterSpacing: number
  shadowEnabled: boolean
  shadowColor?: string
  shadowBlur?: number
  backgroundEnabled: boolean
  backgroundColor?: string
}

export async function renderTextOverlay(
  options: TextRenderOptions
): Promise<Buffer> {
  // Launch Chromium (headless)
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: {
      width: options.width,
      height: options.height
    }
  })

  // Build CSS
  const verticalAlignFlexMap = {
    top: 'flex-start',
    center: 'center',
    bottom: 'flex-end'
  }

  const textShadow = options.shadowEnabled
    ? `${options.shadowColor} 0px 0px ${options.shadowBlur}px`
    : 'none'

  const background = options.backgroundEnabled
    ? options.backgroundColor
    : 'transparent'

  // Create HTML with text
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          width: ${options.width}px;
          height: ${options.height}px;
          display: flex;
          align-items: ${verticalAlignFlexMap[options.verticalAlign]};
          justify-content: center;
          background: transparent;
        }

        .text-container {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: ${verticalAlignFlexMap[options.verticalAlign]};
          padding: 20px;
          background: ${background};
        }

        .text {
          width: 100%;
          font-family: ${options.fontFamily};
          font-size: ${options.fontSize}px;
          font-weight: ${options.fontWeight};
          color: ${options.color};
          text-align: ${options.textAlign};
          line-height: ${options.lineHeight};
          letter-spacing: ${options.letterSpacing}px;
          text-shadow: ${textShadow};
          white-space: pre-wrap;
          word-wrap: break-word;
        }
      </style>
    </head>
    <body>
      <div class="text-container">
        <div class="text">${escapeHtml(options.text)}</div>
      </div>
    </body>
    </html>
  `

  // Set HTML content
  await page.setContent(html)

  // Wait for fonts to load
  await page.evaluate(() => document.fonts.ready)

  // Auto-size text if it doesn't fit
  const fontSize = await autoSizeText(page, options)
  if (fontSize !== options.fontSize) {
    console.log(`Auto-sized text from ${options.fontSize}px to ${fontSize}px`)
    await page.evaluate((newSize) => {
      const textEl = document.querySelector('.text') as HTMLElement
      if (textEl) textEl.style.fontSize = `${newSize}px`
    }, fontSize)
  }

  // Screenshot with transparent background
  const screenshot = await page.screenshot({
    type: 'png',
    omitBackground: true
  })

  await browser.close()

  return screenshot as Buffer
}

async function autoSizeText(
  page: any,
  options: TextRenderOptions
): Promise<number> {
  let fontSize = options.fontSize
  const minFontSize = 12

  while (fontSize >= minFontSize) {
    const { scrollHeight } = await page.evaluate(() => {
      const textEl = document.querySelector('.text') as HTMLElement
      return {
        scrollHeight: textEl.scrollHeight
      }
    })

    if (scrollHeight <= options.height) {
      return fontSize
    }

    fontSize -= 2
    await page.evaluate((newSize: number) => {
      const textEl = document.querySelector('.text') as HTMLElement
      if (textEl) textEl.style.fontSize = `${newSize}px`
    }, fontSize)
  }

  return minFontSize
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>')
}
```

#### Step 4: Composite Final Image

```typescript
// image-composer.ts
import sharp from 'sharp'
import { applyPhotoFilter } from './photo-filters'
import { renderTextOverlay } from './text-renderer'
import type { BrandingTemplate } from './kiosk-config'

export async function renderBrandedImage(
  photoBuffer: Buffer,
  poemText: string,
  template: BrandingTemplate
): Promise<Buffer> {
  console.log('Starting branded image rendering...')
  const startTime = Date.now()

  // Step 1: Create background canvas
  console.log('Creating background canvas...')
  let canvasBuffer: Buffer

  if (template.background_type === 'color') {
    // Solid color background
    canvasBuffer = await sharp({
      create: {
        width: template.output_width,
        height: template.output_height,
        channels: 3,
        background: template.background_color || '#ffffff'
      }
    })
      .png()
      .toBuffer()
  } else if (template.background_image_url) {
    // Image background (download if needed)
    const bgImageBuffer = await fetchImage(template.background_image_url)
    canvasBuffer = await sharp(bgImageBuffer)
      .resize(template.output_width, template.output_height, {
        fit: 'cover'
      })
      .png()
      .toBuffer()
  } else {
    // Fallback to white
    canvasBuffer = await sharp({
      create: {
        width: template.output_width,
        height: template.output_height,
        channels: 3,
        background: '#ffffff'
      }
    })
      .png()
      .toBuffer()
  }

  // Step 2: Process photo
  console.log('Processing photo...')
  let processedPhoto = await sharp(photoBuffer)
    .resize(template.photo_width, template.photo_height, {
      fit: 'cover',
      position: 'center'
    })
    .toBuffer()

  // Apply filter
  if (template.photo_filter && template.photo_filter !== 'none') {
    console.log(`Applying filter: ${template.photo_filter}`)
    processedPhoto = await applyPhotoFilter(
      processedPhoto,
      template.photo_filter as any
    )
  }

  // Add border and round corners
  if (template.photo_border_width > 0 || template.photo_border_radius > 0) {
    console.log('Adding border and rounded corners...')

    const borderSize = template.photo_border_width
    const totalWidth = template.photo_width + borderSize * 2
    const totalHeight = template.photo_height + borderSize * 2

    // Create border background
    const borderBuffer = await sharp({
      create: {
        width: totalWidth,
        height: totalHeight,
        channels: 4,
        background: template.photo_border_color || '#ffffff'
      }
    })
      .png()
      .toBuffer()

    // Composite photo on border
    processedPhoto = await sharp(borderBuffer)
      .composite([{
        input: processedPhoto,
        top: borderSize,
        left: borderSize
      }])
      .toBuffer()

    // Apply rounded corners using SVG mask
    if (template.photo_border_radius > 0) {
      const roundedMask = Buffer.from(
        `<svg width="${totalWidth}" height="${totalHeight}">
          <rect
            x="0"
            y="0"
            width="${totalWidth}"
            height="${totalHeight}"
            rx="${template.photo_border_radius}"
            ry="${template.photo_border_radius}"
            fill="white"
          />
        </svg>`
      )

      processedPhoto = await sharp(processedPhoto)
        .composite([{
          input: roundedMask,
          blend: 'dest-in'
        }])
        .toBuffer()
    }
  }

  // Step 3: Composite photo onto canvas
  console.log('Compositing photo onto canvas...')
  const canvas = sharp(canvasBuffer)

  const compositeSteps: any[] = [
    {
      input: processedPhoto,
      top: template.photo_position_y,
      left: template.photo_position_x
    }
  ]

  // Step 4: Render text overlay
  console.log('Rendering text overlay...')
  const textOverlayBuffer = await renderTextOverlay({
    text: poemText,
    width: template.text_width,
    height: template.text_height,
    fontFamily: template.font_family,
    fontSize: template.font_size,
    fontWeight: template.font_weight,
    color: template.font_color,
    textAlign: template.text_align,
    verticalAlign: template.text_vertical_align,
    lineHeight: template.line_height,
    letterSpacing: template.letter_spacing,
    shadowEnabled: template.text_shadow_enabled,
    shadowColor: template.text_shadow_color,
    shadowBlur: template.text_shadow_blur,
    backgroundEnabled: template.text_background_enabled,
    backgroundColor: template.text_background_color
  })

  // Step 5: Composite text onto canvas
  console.log('Compositing text overlay...')
  compositeSteps.push({
    input: textOverlayBuffer,
    top: template.text_position_y,
    left: template.text_position_x,
    blend: 'over'
  })

  // Step 6: Final composition
  let finalImage = canvas.composite(compositeSteps)

  // Step 7: Export with appropriate quality
  console.log(`Exporting as ${template.output_format}...`)

  if (template.output_format === 'png') {
    finalImage = finalImage.png({
      compressionLevel: 9,
      quality: 100
    })
  } else {
    finalImage = finalImage.jpeg({
      quality: template.output_dpi === 300 ? 95 : 85,
      mozjpeg: true
    })
  }

  const finalBuffer = await finalImage.toBuffer()

  const totalTime = Date.now() - startTime
  console.log(`✅ Rendering complete in ${totalTime}ms`)
  console.log(`Final image size: ${(finalBuffer.length / 1024 / 1024).toFixed(2)} MB`)

  return finalBuffer
}

async function fetchImage(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
```

#### Step 5: Upload to Cloud

```typescript
// upload-session.ts
import { deviceToken } from './device-storage'

export async function uploadRenderedImage(
  sessionId: string,
  bookingId: string | null,
  imageBuffer: Buffer,
  format: 'png' | 'jpeg',
  quality: 'standard' | 'hd'
): Promise<{
  storageUrl: string
  publicViewUrl: string
  expiresAt: string | null
  isPermanent: boolean
}> {
  console.log('Uploading rendered image to cloud...')
  const startTime = Date.now()

  // Convert buffer to base64
  const base64Image = imageBuffer.toString('base64')

  const response = await fetch(
    'https://book.poembooth.com/api/kiosk/upload-session',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deviceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        booking_id: bookingId,
        image_data: base64Image,
        image_format: format,
        quality
      })
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Upload failed')
  }

  const result = await response.json()
  const uploadTime = Date.now() - startTime

  console.log(`✅ Upload complete in ${uploadTime}ms`)
  console.log(`Public URL: ${result.public_view_url}`)

  return {
    storageUrl: result.storage_url,
    publicViewUrl: result.public_view_url,
    expiresAt: result.expires_at,
    isPermanent: result.is_permanent
  }
}
```

#### Step 6: Generate QR Code

```typescript
// qr-generator.ts
import QRCode from 'qrcode'

export async function generateQRCode(url: string): Promise<string> {
  console.log(`Generating QR code for: ${url}`)

  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'H',  // High redundancy (30% damage resistance)
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  })

  console.log('✅ QR code generated')
  return qrDataUrl  // Returns data:image/png;base64,...
}
```

#### Step 7: Complete Workflow

```typescript
// main-workflow.ts
import { getBrandingTemplate } from './kiosk-config'
import { renderBrandedImage } from './image-composer'
import { uploadRenderedImage } from './upload-session'
import { generateQRCode } from './qr-generator'
import { deviceToken, equipmentId } from './device-storage'

export async function processGuestPhoto(
  photoBuffer: Buffer,
  bookingId: string | null
): Promise<void> {
  try {
    // Phase 1: Generate poem (call API)
    console.log('Phase 1: Generating poem...')
    const base64Photo = photoBuffer.toString('base64')

    const poemResponse = await fetch(
      'https://book.poembooth.com/api/kiosk/generate',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${deviceToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          equipment_id: equipmentId,
          booking_id: bookingId,
          image_data: base64Photo,
          image_type: 'image/jpeg'
        })
      }
    )

    if (!poemResponse.ok) {
      throw new Error('Poem generation failed')
    }

    const poemResult = await poemResponse.json()

    // Display poem immediately
    displayPoemText(poemResult.poem)
    showLoadingSpinner('Creating your artwork...')

    // Phase 2: Render branded image locally
    console.log('Phase 2: Rendering branded image locally...')
    const template = poemResult.branding_config.template

    const renderedImage = await renderBrandedImage(
      photoBuffer,
      poemResult.poem,
      template
    )

    // Phase 3: Upload to cloud
    console.log('Phase 3: Uploading to cloud...')
    const uploadResult = await uploadRenderedImage(
      poemResult.session_id,
      bookingId,
      renderedImage,
      template.output_format,
      poemResult.branding_config.quality
    )

    // Phase 4: Generate QR code
    console.log('Phase 4: Generating QR code...')
    const qrCodeDataUrl = await generateQRCode(uploadResult.publicViewUrl)

    // Phase 5: Display final UI
    hideLoadingSpinner()
    displayFinalResult({
      renderedImage,
      qrCodeDataUrl,
      publicViewUrl: uploadResult.publicViewUrl,
      expiresAt: uploadResult.expiresAt,
      isPermanent: uploadResult.isPermanent,
      printingEnabled: template.printing_enabled || false
    })

    console.log('✅ Complete workflow finished')

  } catch (error) {
    console.error('Error in guest photo workflow:', error)
    showErrorScreen(error.message)
  }
}

// UI Functions (implement in your Electron app)
function displayPoemText(poem: string): void {
  // Show poem text in large, readable font
  // Center on screen
  console.log('Displaying poem:', poem)
}

function showLoadingSpinner(message: string): void {
  console.log('Loading:', message)
}

function hideLoadingSpinner(): void {
  console.log('Loading complete')
}

function displayFinalResult(result: {
  renderedImage: Buffer
  qrCodeDataUrl: string
  publicViewUrl: string
  expiresAt: string | null
  isPermanent: boolean
  printingEnabled: boolean
}): void {
  console.log('Displaying final result:', {
    imageSize: result.renderedImage.length,
    qrCode: result.qrCodeDataUrl.substring(0, 50) + '...',
    url: result.publicViewUrl
  })

  // Display:
  // 1. Rendered image (full screen or large preview)
  // 2. QR code below
  // 3. "Scan to download!" message
  // 4. Expiration notice (if applicable)
  // 5. "Long press to print" button (if printingEnabled)
}

function showErrorScreen(message: string): void {
  console.error('Showing error screen:', message)
}
```

### Testing Local Rendering

```typescript
// test-rendering.ts
import * as fs from 'fs'
import { renderBrandedImage } from './image-composer'

async function testRendering() {
  // Load test photo
  const photoBuffer = fs.readFileSync('./test-photo.jpg')

  // Mock branding template
  const template = {
    id: 'test',
    name: 'Test Template',
    background_type: 'color' as const,
    background_color: '#f8f8f8',
    photo_position_x: 100,
    photo_position_y: 100,
    photo_width: 800,
    photo_height: 800,
    photo_border_radius: 20,
    photo_border_width: 10,
    photo_border_color: '#ffffff',
    photo_filter: 'vintage',
    text_position_x: 100,
    text_position_y: 950,
    text_width: 800,
    text_height: 300,
    text_align: 'center' as const,
    text_vertical_align: 'center' as const,
    font_family: 'Georgia, serif',
    font_size: 32,
    font_weight: 400,
    font_color: '#333333',
    line_height: 1.5,
    letter_spacing: 0,
    text_shadow_enabled: true,
    text_shadow_color: '#00000033',
    text_shadow_blur: 4,
    text_background_enabled: false,
    text_background_color: null,
    output_width: 1000,
    output_height: 1400,
    output_dpi: 300,
    output_format: 'png' as const
  }

  const poemText = `In moments captured, love does shine,
Two hearts as one dispel the gloom,
Alice and Bob, on this blessed day,
October 30, 2025, love finds its way.`

  console.log('Starting test render...')
  const startTime = Date.now()

  const renderedImage = await renderBrandedImage(
    photoBuffer,
    poemText,
    template
  )

  const totalTime = Date.now() - startTime
  console.log(`✅ Test render complete in ${totalTime}ms`)

  // Save output
  fs.writeFileSync('./test-output.png', renderedImage)
  console.log('Output saved to test-output.png')
}

testRendering().catch(console.error)
```

---

## 🏠 Local AI Server Setup (Offline Mode)

For events without reliable internet connectivity, you can run a local AI server on a separate machine connected to the kiosk via ethernet.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Kiosk Computer (192.168.1.105)                              │
│  - Electron app                                              │
│  - Local rendering (Sharp + Playwright)                      │
│  - Calls local AI server for poems                           │
│  - Stores images locally (uploads to cloud when online)      │
└─────────────┬────────────────────────────────────────────────┘
              │
              │ Ethernet (192.168.1.0/24)
              │
┌─────────────▼────────────────────────────────────────────────┐
│  Local AI Server (192.168.1.100)                             │
│  - Ollama or LM Studio                                       │
│  - LLaVA 13B (vision model for captions)                     │
│  - Mistral 7B (text model for poems)                         │
│  - OpenAI-compatible API endpoints                           │
│  - Runs on GPU for fast inference                            │
└──────────────────────────────────────────────────────────────┘
```

### Hardware Requirements

#### AI Server Machine

**Minimum Specs:**
- **CPU:** Intel i7-11700K or AMD Ryzen 7 5800X
- **RAM:** 16GB DDR4 (32GB recommended)
- **GPU:** NVIDIA RTX 3060 (12GB VRAM) **required**
- **Storage:** 500GB SSD for models
- **Network:** Gigabit ethernet port
- **OS:** Ubuntu 22.04 LTS (Linux recommended for Ollama)

**Recommended Specs (for faster performance):**
- **CPU:** Intel i9-13900K or AMD Ryzen 9 7950X
- **RAM:** 32GB DDR5
- **GPU:** NVIDIA RTX 4070 Ti (12GB) or RTX 4090 (24GB)
- **Storage:** 1TB NVMe SSD
- **Network:** 2.5GbE or 10GbE

**Why GPU is Required:**
- LLaVA 13B (vision model) requires 12GB VRAM minimum
- CPU-only inference is 10-20x slower (30-60s vs 3-5s per photo)
- Mistral 7B can run on CPU RAM if GPU is busy with LLaVA

#### Kiosk Computer

**Minimum Specs:**
- **CPU:** Intel i5-10400 or AMD Ryzen 5 3600
- **RAM:** 8GB DDR4
- **Storage:** 256GB SSD
- **Network:** Gigabit ethernet
- **USB:** 3.0+ for camera and printer
- **GPU:** Integrated graphics (sufficient for UI and local rendering)

### Ollama Installation & Setup

#### Step 1: Install Ollama

**On Ubuntu/Linux (AI Server):**
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Verify installation
ollama --version
```

**On Windows:**
```powershell
# Download installer from https://ollama.com/download/windows
# Run installer
# Verify in PowerShell:
ollama --version
```

**On macOS:**
```bash
# Method 1: Homebrew (Recommended)
brew install ollama

# Method 2: Download .dmg installer
# Download from https://ollama.com/download/mac
# Drag Ollama.app to Applications
# Launch Ollama from Applications

# Verify installation
ollama --version
```

#### Step 2: Pull AI Models

```bash
# Pull vision model for captions (requires 12GB VRAM)
ollama pull llava:13b

# Pull text model for poems (can use CPU RAM if needed)
ollama pull mistral:7b-instruct

# Alternative: Llama 3 for better poem quality
ollama pull llama3:8b-instruct

# Verify models installed
ollama list
```

**Expected Output:**
```
NAME                   ID              SIZE      MODIFIED
llava:13b              0ff4e55aac4b    7.7 GB    2 minutes ago
mistral:7b-instruct    b8d3c5f0da16    4.1 GB    1 minute ago
```

#### Step 3: Configure Network Access

**On Linux (systemd):**
```bash
# Edit Ollama service
sudo systemctl edit ollama.service

# Add these lines:
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"

# Save and restart
sudo systemctl restart ollama

# Verify it's listening on all interfaces
curl http://localhost:11434/api/tags
```

**On Windows:**
```powershell
# Set environment variable
[System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'Machine')

# Restart Ollama service
Restart-Service Ollama

# Configure Windows Firewall
New-NetFirewallRule -DisplayName "Ollama API" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow
```

**On macOS:**
```bash
# Method 1: Set environment variable in launchd config
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"

# Method 2: Create persistent launchd plist
# Create file: ~/Library/LaunchAgents/com.ollama.server.plist
cat > ~/Library/LaunchAgents/com.ollama.server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ollama.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ollama</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OLLAMA_HOST</key>
    <string>0.0.0.0:11434</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF

# Load the service
launchctl load ~/Library/LaunchAgents/com.ollama.server.plist

# Verify it's listening on all interfaces
curl http://localhost:11434/api/tags

# Note: macOS firewall is usually off by default
# If enabled, allow incoming connections:
# System Settings > Network > Firewall > Options > Add ollama
```

#### Step 4: Test Connectivity

**From AI Server:**
```bash
curl http://localhost:11434/api/tags
```

**From Kiosk:**
```bash
# Replace 192.168.1.100 with your AI server's IP
curl http://192.168.1.100:11434/api/tags
```

**Expected Response:**
```json
{
  "models": [
    {
      "name": "llava:13b",
      "modified_at": "2025-01-04T10:00:00Z",
      "size": 7700000000
    },
    {
      "name": "mistral:7b-instruct",
      "modified_at": "2025-01-04T10:05:00Z",
      "size": 4100000000
    }
  ]
}
```

### Network Configuration

#### Static IP Setup

**On AI Server (Ubuntu):**
```bash
# Edit netplan configuration
sudo nano /etc/netplan/01-netcfg.yaml

# Add:
network:
  version: 2
  ethernets:
    eth0:  # or your interface name (check with: ip link)
      dhcp4: no
      addresses:
        - 192.168.1.100/24
      nameservers:
        addresses: []  # No DNS needed (local only)

# Apply configuration
sudo netplan apply

# Verify
ip addr show eth0
```

**On Kiosk (Ubuntu):**
```bash
# Edit netplan
sudo nano /etc/netplan/01-netcfg.yaml

# Add:
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: no
      addresses:
        - 192.168.1.105/24

# Apply
sudo netplan apply
```

**Test Connectivity:**
```bash
# From kiosk, ping AI server
ping 192.168.1.100

# Expected: Reply from 192.168.1.100: bytes=32 time<1ms TTL=64
```

### Kiosk App Integration

#### Environment Variables

```bash
# .env.local in kiosk Electron app
OFFLINE_MODE_ENABLED=true
LOCAL_AI_SERVER_URL=http://192.168.1.100:11434
FALLBACK_TO_CLOUD=true  # Try cloud if local fails
```

#### Offline Detection Logic

```typescript
// offline-ai-client.ts
const LOCAL_AI_URL = process.env.LOCAL_AI_SERVER_URL || 'http://192.168.1.100:11434'
const CLOUD_API_URL = 'https://book.poembooth.com/api/kiosk/generate'
const OFFLINE_MODE_ENABLED = process.env.OFFLINE_MODE_ENABLED === 'true'

export async function detectAIMode(): Promise<'local' | 'cloud' | 'error'> {
  if (!OFFLINE_MODE_ENABLED) {
    return 'cloud'
  }

  // Test local AI server
  try {
    const response = await fetch(`${LOCAL_AI_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000)  // 3 second timeout
    })

    if (response.ok) {
      console.log('✅ Local AI server available')
      return 'local'
    }
  } catch (error) {
    console.warn('⚠️  Local AI server not reachable:', error.message)
  }

  // Fallback to cloud
  try {
    const response = await fetch('https://book.poembooth.com/api/health', {
      signal: AbortSignal.timeout(3000)
    })

    if (response.ok) {
      console.log('✅ Cloud API available')
      return 'cloud'
    }
  } catch (error) {
    console.error('❌ Cloud API not reachable:', error.message)
  }

  return 'error'
}
```

#### Local Caption Generation

```typescript
// local-caption.ts
export async function generateCaptionLocal(
  imageBuffer: Buffer
): Promise<string> {
  const base64Image = imageBuffer.toString('base64')

  const response = await fetch(`${LOCAL_AI_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llava:13b',
      prompt: 'Describe this photo in 2-3 sentences, focusing on the people, emotions, setting, and atmosphere. Be specific and vivid.',
      images: [base64Image],
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9
      }
    })
  })

  if (!response.ok) {
    throw new Error(`Local AI caption failed: ${response.status}`)
  }

  const result = await response.json()
  return result.response  // Caption text
}
```

#### Local Poem Generation

```typescript
// local-poem.ts
export async function generatePoemLocal(
  caption: string,
  variables: Record<string, string>,
  promptTemplate: string
): Promise<string> {
  // Substitute variables in prompt template
  let finalPrompt = promptTemplate
    .replace('{caption}', caption)

  for (const [key, value] of Object.entries(variables)) {
    finalPrompt = finalPrompt.replace(`{${key}}`, value)
  }

  const response = await fetch(`${LOCAL_AI_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral:7b-instruct',
      prompt: finalPrompt,
      stream: false,
      options: {
        temperature: 0.8,
        top_p: 0.95,
        max_tokens: 500
      }
    })
  })

  if (!response.ok) {
    throw new Error(`Local AI poem failed: ${response.status}`)
  }

  const result = await response.json()
  return result.response  // Poem text
}
```

#### Unified Generation Function

```typescript
// unified-generator.ts
import { detectAIMode } from './offline-ai-client'
import { generateCaptionLocal, generatePoemLocal } from './local-caption'
import { deviceToken, equipmentId } from './device-storage'

export async function generatePoem(
  photoBuffer: Buffer,
  bookingId: string | null
): Promise<{
  caption: string
  poem: string
  sessionId: string
  brandingConfig: any
  mode: 'local' | 'cloud'
}> {
  const mode = await detectAIMode()

  if (mode === 'cloud') {
    // Use cloud API (standard flow)
    return await generatePoemCloud(photoBuffer, bookingId)
  }

  if (mode === 'local') {
    // Use local AI server
    return await generatePoemLocalOffline(photoBuffer, bookingId)
  }

  throw new Error('No AI service available (local or cloud)')
}

async function generatePoemCloud(
  photoBuffer: Buffer,
  bookingId: string | null
): Promise<any> {
  const base64Photo = photoBuffer.toString('base64')

  const response = await fetch(
    'https://book.poembooth.com/api/kiosk/generate',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deviceToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        equipment_id: equipmentId,
        booking_id: bookingId,
        image_data: base64Photo,
        image_type: 'image/jpeg'
      })
    }
  )

  if (!response.ok) {
    throw new Error('Cloud poem generation failed')
  }

  const result = await response.json()
  return {
    caption: result.caption,
    poem: result.poem,
    sessionId: result.session_id,
    brandingConfig: result.branding_config,
    mode: 'cloud'
  }
}

async function generatePoemLocalOffline(
  photoBuffer: Buffer,
  bookingId: string | null
): Promise<any> {
  console.log('Using local AI server (offline mode)')

  // Load cached configuration
  const config = await loadCachedConfig()

  // Generate caption locally
  console.log('Generating caption with LLaVA...')
  const caption = await generateCaptionLocal(photoBuffer)
  console.log('Caption:', caption)

  // Generate poem locally
  console.log('Generating poem with Mistral...')
  const poem = await generatePoemLocal(
    caption,
    config.variables,
    config.poemPrompt
  )
  console.log('Poem:', poem)

  // Create local session ID
  const sessionId = crypto.randomUUID()

  // Store in local SQLite database (for upload later)
  await storeLocalSession({
    sessionId,
    bookingId,
    caption,
    poem,
    timestamp: new Date().toISOString()
  })

  return {
    caption,
    poem,
    sessionId,
    brandingConfig: {
      template: config.brandingTemplate,
      quality: config.quality
    },
    mode: 'local'
  }
}

// Local storage functions
import Database from 'better-sqlite3'
const db = new Database('/opt/poembooth/offline-sessions.db')

db.exec(`
  CREATE TABLE IF NOT EXISTS offline_sessions (
    session_id TEXT PRIMARY KEY,
    booking_id TEXT,
    caption TEXT,
    poem TEXT,
    image_path TEXT,
    timestamp TEXT,
    uploaded_to_cloud INTEGER DEFAULT 0
  )
`)

async function storeLocalSession(session: any): Promise<void> {
  const stmt = db.prepare(`
    INSERT INTO offline_sessions
    (session_id, booking_id, caption, poem, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `)

  stmt.run(
    session.sessionId,
    session.bookingId,
    session.caption,
    session.poem,
    session.timestamp
  )

  console.log('✅ Session stored locally:', session.sessionId)
}

async function loadCachedConfig(): Promise<any> {
  // Load from local file (fetched during last online sync)
  const fs = require('fs')
  const configPath = '/opt/poembooth/cached-config.json'

  if (!fs.existsSync(configPath)) {
    throw new Error('No cached configuration found. Sync while online first.')
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  return config
}
```

#### Post-Event Cloud Sync

```typescript
// cloud-sync.ts
export async function syncOfflineSessionsToCloud(): Promise<void> {
  console.log('Starting offline sessions sync...')

  // Get all unsynced sessions
  const unsyncedSessions = db.prepare(`
    SELECT * FROM offline_sessions
    WHERE uploaded_to_cloud = 0
  `).all()

  console.log(`Found ${unsyncedSessions.length} sessions to sync`)

  for (const session of unsyncedSessions) {
    try {
      // Read rendered image from local storage
      const imagePath = session.image_path
      const imageBuffer = fs.readFileSync(imagePath)

      // Upload to cloud
      const uploadResult = await uploadRenderedImage(
        session.session_id,
        session.booking_id,
        imageBuffer,
        'png',
        'standard'
      )

      console.log(`✅ Uploaded session ${session.session_id}`)

      // Mark as synced
      db.prepare('UPDATE offline_sessions SET uploaded_to_cloud = 1 WHERE session_id = ?')
        .run(session.session_id)

      // Optionally delete local image to save space
      fs.unlinkSync(imagePath)

    } catch (error) {
      console.error(`Failed to sync session ${session.session_id}:`, error)
      // Continue with next session
    }
  }

  console.log('✅ Cloud sync complete')
}

// Run sync when internet connection is restored
setInterval(async () => {
  const isOnline = await detectAIMode()
  if (isOnline === 'cloud') {
    await syncOfflineSessionsToCloud()
  }
}, 5 * 60 * 1000)  // Check every 5 minutes
```

### Performance Expectations

#### On RTX 3060 (12GB VRAM):
| Step | Duration | Notes |
|------|----------|-------|
| Caption (LLaVA 13B) | 3-5 seconds | GPU-bound |
| Poem (Mistral 7B) | 5-8 seconds | Can run on CPU RAM |
| **Total AI Time** | **8-13 seconds** | Per guest |

#### On RTX 4090 (24GB VRAM):
| Step | Duration | Notes |
|------|----------|-------|
| Caption (LLaVA 13B) | 1-2 seconds | Faster GPU |
| Poem (Mistral 7B) | 2-3 seconds | Runs on GPU simultaneously |
| **Total AI Time** | **3-5 seconds** | Per guest |

**Plus local rendering:** 5-10 seconds (same as online mode)

**Total guest experience:** 13-23 seconds (RTX 3060) or 8-15 seconds (RTX 4090)

### Optimization Tips

**For Faster Inference:**
1. Use quantized models (Q4 or Q5):
   ```bash
   ollama pull llava:7b-q4  # Smaller, faster (but lower quality)
   ollama pull mistral:7b-instruct-q5
   ```

2. Pre-warm models on server startup:
   ```bash
   # Run a test generation to load models into VRAM
   ollama run llava:13b "test" <<< "test.jpg"
   ollama run mistral:7b-instruct "test"
   ```

3. Use smaller models for high-volume events:
   ```bash
   ollama pull llava:7b  # Half the size, 2x faster
   ```

### Troubleshooting

**"Local AI server not responding"**
```bash
# Check Ollama service
sudo systemctl status ollama

# Restart if needed
sudo systemctl restart ollama

# Check if models are loaded
ollama list

# Test generation manually
curl http://192.168.1.100:11434/api/generate -d '{
  "model": "mistral:7b-instruct",
  "prompt": "Hello",
  "stream": false
}'
```

**"Out of VRAM"**
```bash
# Check GPU memory
nvidia-smi

# Stop Ollama
sudo systemctl stop ollama

# Clear GPU memory
sudo fuser -k /dev/nvidia0

# Restart Ollama
sudo systemctl start ollama
```

**"Models are too slow"**
- Verify GPU is being used (not CPU fallback):
  ```bash
  watch -n 1 nvidia-smi
  # Should show ollama process using GPU when generating
  ```

- Use quantized models (Q4/Q5)
- Upgrade to faster GPU (RTX 4070 Ti or higher)

---

## 🖨️ Printing Configuration

### Hub Manager Settings

**Location:** Booking detail page → Kiosk Configuration

**Setting:** `printing_enabled` (boolean)
- **Enabled:** Guest can long-press to print after viewing QR code
- **Disabled:** Only QR code is shown (no print option)

**Use Cases:**
- **Enable printing:** Events with "Gedrukte Gedichten" extra ordered
- **Disable printing:** Digital-only events to save printer costs

**Default:** Disabled (must be explicitly enabled per booking)

### Guest Interaction

**Long-Press to Print:**
1. After QR code appears, guest sees hint: "Long press here to print"
2. Guest presses and holds button for 2 seconds
3. Confirmation dialog appears: "Print your poem?"
4. Guest confirms or cancels
5. If confirmed:
   - Kiosk sends print job to connected printer
   - "Printing..." status shown
   - Print count incremented in `session_logs.metadata.print_count`
   - "Printed!" confirmation displayed

**Why Long-Press:**
- Prevents accidental prints (expensive)
- Gives guest explicit control
- Easy to explain: "Hold button to print"

### Printer Setup

#### On Linux (CUPS):

```bash
# Install CUPS
sudo apt install cups

# Add printer (USB or network)
sudo lpadmin -p PoemBoothPrinter -E -v usb://Brother/HL-L2350DW -m everywhere

# Set as default
sudo lpoptions -d PoemBoothPrinter

# Test print
lp -d PoemBoothPrinter test-image.png
```

#### On macOS (CUPS):

```bash
# macOS uses CUPS by default, no installation needed

# Connect USB printer (auto-detected)
# Or add printer via System Settings:
# System Settings > Printers & Scanners > Add Printer

# List available printers
lpstat -p -d

# Add printer via command line
sudo lpadmin -p PoemBoothPrinter -E -v usb://Brother/HL-L2350DW -m everywhere

# Set as default
sudo lpoptions -d PoemBoothPrinter

# Test print
lp -d PoemBoothPrinter test-image.png

# Verify printer status
lpstat -t
```

#### On Windows:

```powershell
# Install printer driver
# Download driver from printer manufacturer website

# Connect USB printer (auto-detected)
# Or add printer via Settings:
# Settings > Bluetooth & devices > Printers & scanners > Add device

# List printers in PowerShell
Get-Printer

# Set default printer
$printerName = "Brother HL-L2350DW"
Set-Printer -Name $printerName -Default

# Test print using mspaint (example)
Start-Process mspaint.exe -ArgumentList "/pt test-image.png $printerName"
```

#### In Electron App:

```typescript
// printer.ts
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function printImage(imagePath: string): Promise<void> {
  const printerName = process.env.PRINTER_NAME || 'PoemBoothPrinter'

  console.log(`Printing image: ${imagePath}`)

  try {
    // Use CUPS lp command
    await execAsync(`lp -d ${printerName} -o fit-to-page -o media=4x6 ${imagePath}`)

    console.log('✅ Print job sent successfully')
  } catch (error) {
    console.error('❌ Print failed:', error)
    throw new Error('Failed to print: ' + error.message)
  }
}

// Alternative: Use Electron's built-in printing
import { BrowserWindow } from 'electron'

export async function printWithElectron(imagePath: string): Promise<void> {
  const win = new BrowserWindow({ show: false })
  await win.loadFile(imagePath)

  const options = {
    silent: true,
    printBackground: false,
    deviceName: process.env.PRINTER_NAME
  }

  win.webContents.print(options, (success, errorType) => {
    if (!success) {
      console.error('Print failed:', errorType)
    }
    win.close()
  })
}
```

#### Print Quality Settings

**Based on branding template DPI:**
- **Standard (72 DPI):** Screen-optimized, fast printing
- **HD (300 DPI):** Print-optimized, higher quality (slower)

**Paper Sizes:**
- **4x6 inches** (postcard) - Most common
- **5x7 inches** (photo) - Larger
- **Custom** - Based on `output_width` / `output_height` ratio

### Print Count Tracking

**Stored in `session_logs.metadata`:**
```json
{
  "session_logs": {
    "id": "session-uuid",
    "metadata": {
      "print_count": 2,
      "first_print_at": "2025-01-04T10:30:00Z",
      "last_print_at": "2025-01-04T10:35:00Z"
    }
  }
}
```

**Analytics Queries:**
```sql
-- Total prints per booking
SELECT
  booking_id,
  SUM((metadata->>'print_count')::int) as total_prints
FROM session_logs
WHERE metadata->>'print_count' IS NOT NULL
GROUP BY booking_id;

-- Most printed poems
SELECT
  id,
  poem,
  (metadata->>'print_count')::int as prints
FROM session_logs
WHERE metadata->>'print_count' IS NOT NULL
ORDER BY prints DESC
LIMIT 10;
```

---

## 🔒 Security & API Protection

### Device Token Security

**Token Format:** JWT (JSON Web Token)

**Signing Algorithm:** HS256 (HMAC with SHA-256)

**Secret Key:** `DEVICE_TOKEN_SECRET` (separate from `SUPABASE_JWT_SECRET`)

**Token Payload:**
```typescript
{
  // Standard claims
  "iss": "poemboothbooking",
  "sub": "equipment:5",
  "iat": 1704384000,
  "exp": 1707062400,  // 30 days

  // Custom claims
  "equipment_id": 5,
  "hub_id": "hub-uuid-amsterdam",
  "device_serial": "PB-005-AMS",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "scope": "kiosk:read kiosk:write storage:upload"
}
```

### RLS Policies for Kiosk Access

**Equipment Inventory:**
```sql
-- Kiosk can only read its own equipment record
CREATE POLICY "Kiosk devices can read own equipment"
ON equipment_inventory FOR SELECT
TO authenticated
USING (
  id = (auth.jwt() ->> 'equipment_id')::integer
);
```

**Session Logs:**
```sql
-- Kiosk can insert sessions for its own equipment
CREATE POLICY "Kiosk devices can create sessions"
ON session_logs FOR INSERT
TO authenticated
WITH CHECK (
  equipment_id = (auth.jwt() ->> 'equipment_id')::integer
);

-- Kiosk can update sessions it created
CREATE POLICY "Kiosk devices can update own sessions"
ON session_logs FOR UPDATE
TO authenticated
USING (
  equipment_id = (auth.jwt() ->> 'equipment_id')::integer
);
```

**Storage Bucket:**
```sql
-- Kiosk can upload to its equipment's folder
CREATE POLICY "Kiosk devices can upload images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'poem-outputs' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM bookings
    WHERE hub_id = (auth.jwt() ->> 'hub_id')::uuid
  )
);
```

### Rate Limiting

**Per Device Token:**
- **Config endpoint:** 10 requests/minute
- **Generate endpoint:** 60 requests/minute (1 per photo)
- **Upload endpoint:** 60 requests/minute

**Implementation:**
```typescript
// rate-limiter.ts
import { LRUCache } from 'lru-cache'

const rateLimitCache = new LRUCache<string, number[]>({
  max: 1000,
  ttl: 60 * 1000  // 1 minute
})

export function checkRateLimit(
  deviceToken: string,
  endpoint: string,
  limit: number
): boolean {
  const key = `${deviceToken}:${endpoint}`
  const timestamps = rateLimitCache.get(key) || []

  const now = Date.now()
  const windowStart = now - 60 * 1000  // 1 minute ago

  // Filter out old timestamps
  const recentTimestamps = timestamps.filter(ts => ts > windowStart)

  if (recentTimestamps.length >= limit) {
    return false  // Rate limit exceeded
  }

  // Add current timestamp
  recentTimestamps.push(now)
  rateLimitCache.set(key, recentTimestamps)

  return true  // Request allowed
}
```

### Token Revocation

**Admin UI:**
- Hub manager can revoke device token from equipment detail page
- Revocation stored in `revoked_device_tokens` table
- API checks revocation on every request

**Database:**
```sql
CREATE TABLE revoked_device_tokens (
  token_hash TEXT PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment_inventory(id),
  revoked_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_by UUID REFERENCES users(id),
  reason TEXT
);
```

**Middleware:**
```typescript
// check-revocation.ts
import { createHmac } from 'crypto'

export async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = createHmac('sha256', process.env.DEVICE_TOKEN_SECRET!)
    .update(token)
    .digest('hex')

  const { data } = await supabase
    .from('revoked_device_tokens')
    .select('token_hash')
    .eq('token_hash', tokenHash)
    .single()

  return !!data  // Returns true if revoked
}
```

### Audit Logging

**All kiosk API requests logged:**
```typescript
interface AuditLog {
  id: string
  timestamp: string
  equipment_id: number
  endpoint: string
  method: string
  ip_address: string
  user_agent: string
  request_body_size: number
  response_status: number
  response_time_ms: number
  error_message?: string
}
```

**Stored in `kiosk_audit_logs` table:**
```sql
CREATE TABLE kiosk_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  equipment_id INTEGER REFERENCES equipment_inventory(id),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  request_body_size INTEGER,
  response_status INTEGER,
  response_time_ms INTEGER,
  error_message TEXT
);

CREATE INDEX idx_kiosk_audit_logs_equipment ON kiosk_audit_logs(equipment_id);
CREATE INDEX idx_kiosk_audit_logs_timestamp ON kiosk_audit_logs(timestamp);
```

---

## 🐛 Troubleshooting

### Device Pairing Issues

**"Invalid pairing code"**
- ✅ Check code was typed correctly (case-sensitive)
- ✅ Verify code hasn't expired (5 minutes)
- ✅ Regenerate new QR code in admin portal
- ✅ Check device clock is synchronized (NTP)

**"Device already paired"**
- ✅ Unpair device first in admin portal
- ✅ Or revoke existing token
- ✅ Then generate new pairing code

**"Failed to scan QR code"**
- ✅ Ensure adequate lighting on QR code
- ✅ Clean camera lens
- ✅ Zoom camera closer to QR code
- ✅ Use manual code entry as fallback

### Authentication Errors

**"Unauthorized" (401)**
- ✅ Check device token is stored correctly
- ✅ Verify token hasn't expired (check expiry date)
- ✅ Try refreshing token: `POST /api/kiosk/refresh-token`
- ✅ If refresh fails, re-pair device

**"Forbidden" (403)**
- ✅ Verify token matches equipment_id in request
- ✅ Check equipment status is "available" or "in_use"
- ✅ Verify hub manager hasn't revoked token

### Generation Errors

**"No poem style configured"**
- ✅ Hub manager must assign default style to equipment
- ✅ Navigate to Equipment Detail → Assign Poem Style
- ✅ Style must be marked as "public"

**"AI generation failed" (502)**
- ✅ Check AI provider status (Anthropic, Google, OpenAI)
- ✅ Verify API keys are configured in backend
- ✅ Try switching to different AI model
- ✅ Check backend logs for detailed error

**"Local AI server not responding"**
- ✅ Ping AI server: `ping 192.168.1.100`
- ✅ Check Ollama service: `sudo systemctl status ollama`
- ✅ Verify models are loaded: `ollama list`
- ✅ Test manually: `curl http://192.168.1.100:11434/api/tags`
- ✅ Check firewall allows port 11434

### Rendering Issues

**"Chromium not found"**
- ✅ Run: `npx playwright install chromium`
- ✅ Verify:
  - Linux: `ls ~/.cache/ms-playwright/chromium-*`
  - macOS: `ls ~/Library/Caches/ms-playwright/chromium-*`
  - Windows: `dir "$env:LOCALAPPDATA\ms-playwright\chromium-*"`
- ✅ Check disk space (Chromium requires ~280MB)

**"Sharp installation failed"**
- ✅ Install build tools:
  - Linux (Ubuntu): `sudo apt install build-essential`
  - macOS: `xcode-select --install` (install Xcode Command Line Tools)
  - Windows: Install Visual Studio Build Tools
- ✅ Clear npm cache: `npm cache clean --force`
- ✅ Reinstall: `npm install sharp --force`

**"Text rendering failed"**
- ✅ Check Playwright browser process isn't stuck:
  ```bash
  ps aux | grep chromium
  pkill chromium  # If stuck
  ```
- ✅ Verify font family exists on system
- ✅ Use fallback font: "Arial, sans-serif"

**"Image rendering is slow"**
- ✅ Reduce output dimensions (e.g., 800x1200 instead of 1000x1400)
- ✅ Use JPEG instead of PNG (faster compression)
- ✅ Disable photo filters for faster processing
- ✅ Upgrade hardware (faster CPU, more RAM)

### Upload Errors

**"Upload failed" (500)**
- ✅ Check internet connectivity
- ✅ Verify Supabase Storage bucket exists: `poem-outputs`
- ✅ Check file size (must be < 10MB)
- ✅ Try reducing image quality or dimensions
- ✅ Check backend logs for Storage API errors

**"Image too large" (413)**
- ✅ Reduce output dimensions in branding template
- ✅ Use JPEG with lower quality (e.g., 85 instead of 95)
- ✅ Remove photo filters (they can increase file size)
- ✅ Compress image before upload:
  ```typescript
  await sharp(imageBuffer)
    .resize(1000, 1400, { fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer()
  ```

### Printing Issues

**"Printer not found"**
- ✅ Check printer is connected (USB cable or network)
- ✅ Verify printer is powered on
- ✅ Check printer name: `lpstat -p -d`
- ✅ Update `PRINTER_NAME` environment variable

**"Print job failed"**
- ✅ Check CUPS logs: `sudo tail -f /var/log/cups/error_log`
- ✅ Verify printer has paper and ink
- ✅ Test manual print: `lp -d PoemBoothPrinter test.png`
- ✅ Restart CUPS: `sudo systemctl restart cups`

**"Printed image is blurry"**
- ✅ Use HD quality setting (300 DPI)
- ✅ Check paper size matches template dimensions
- ✅ Verify printer settings (high quality mode)
- ✅ Use PNG format instead of JPEG

### Performance Issues

**"Guest experience is too slow"**

**Total time breakdown:**
- Poem generation: 3-5 seconds
- Local rendering: 5-10 seconds
- Upload to cloud: 1-2 seconds
- **Total: 9-17 seconds**

**If slower than this:**
- ✅ Check CPU usage during rendering: `htop`
- ✅ Verify adequate RAM (>4GB free)
- ✅ Use faster AI models (Gemini Flash, Claude Haiku)
- ✅ Reduce branding template complexity
- ✅ Disable photo filters
- ✅ Use local AI server (3-5 seconds for poem)
- ✅ Upgrade hardware (faster CPU, SSD)

### Network Issues

**"No internet connection"**
- ✅ Check ethernet cable is connected
- ✅ Ping gateway: `ping 192.168.1.1`
- ✅ Test DNS: `nslookup google.com`
- ✅ Check firewall/proxy settings
- ✅ Switch to local AI server mode

**"Local network unreachable"**
- ✅ Verify static IP configuration
- ✅ Check subnet mask (should be 255.255.255.0)
- ✅ Ping AI server: `ping 192.168.1.100`
- ✅ Check ethernet switch/router
- ✅ Try different ethernet port

---

## 📞 Support

### For Kiosk Integration Issues:
- **Technical Support:** justus@poembooth.com
- **Documentation:** https://book.poembooth.com/docs/kiosk
- **GitHub Issues:** https://github.com/poemBooth/booking-system/issues

### For AI Server Setup:
- **Ollama Docs:** https://ollama.com/docs
- **LM Studio Docs:** https://lmstudio.ai/docs
- **Model Hub:** https://ollama.com/library

### For Hardware Recommendations:
- **GPU Compatibility:** Check NVIDIA CUDA support
- **Printer Compatibility:** Check CUPS printer database
- **Network Equipment:** Gigabit ethernet switches recommended

---

## 🚀 Quick Start Checklist

### Initial Setup (One-Time)

- [ ] **Hardware Ready:**
  - [ ] Kiosk computer with 8GB+ RAM, SSD
  - [ ] Camera connected (USB 3.0)
  - [ ] Printer connected (optional)
  - [ ] Ethernet connected

- [ ] **Software Installed:**
  - [ ] Node.js 18+
  - [ ] npm packages: `sharp`, `playwright`, `qrcode`
  - [ ] Playwright Chromium: `npx playwright install chromium`

- [ ] **Configuration:**
  - [ ] Equipment created in admin portal
  - [ ] Default poem style assigned
  - [ ] Default branding template assigned
  - [ ] Device paired via QR code

- [ ] **Testing:**
  - [ ] Take test photo
  - [ ] Generate test poem
  - [ ] Verify branded image renders
  - [ ] Scan QR code → Opens public viewer
  - [ ] Test printing (if enabled)

### Per-Event Setup

- [ ] **Booking Configuration:**
  - [ ] Poem style assigned to booking
  - [ ] Custom variables filled in
  - [ ] Branding template selected
  - [ ] Printing enabled/disabled
  - [ ] Quality setting (standard/hd)

- [ ] **Test Run:**
  - [ ] Admin tests poem generation
  - [ ] Preview branded output
  - [ ] Verify QR code works
  - [ ] Test print quality

- [ ] **Go Live:**
  - [ ] Kiosk displays "Ready" screen
  - [ ] First guest test successful
  - [ ] Monitor for errors
  - [ ] Check print count (if applicable)

### Offline Mode Setup (Optional)

- [ ] **AI Server:**
  - [ ] Separate machine with RTX 3060+ GPU
  - [ ] Ubuntu 22.04 installed
  - [ ] Ollama installed
  - [ ] Models pulled: LLaVA 13B, Mistral 7B
  - [ ] Network configured (static IP 192.168.1.100)
  - [ ] Firewall allows port 11434

- [ ] **Kiosk Configuration:**
  - [ ] Environment variables set: `OFFLINE_MODE_ENABLED=true`
  - [ ] Local AI server URL: `LOCAL_AI_SERVER_URL=http://192.168.1.100:11434`
  - [ ] Network configured (static IP 192.168.1.105)

- [ ] **Testing:**
  - [ ] Ping AI server from kiosk
  - [ ] Test caption generation
  - [ ] Test poem generation
  - [ ] Verify offline mode detection
  - [ ] Test cloud sync after going back online

---

## 📝 Changelog

### Version 2.0 (2025-01-04) - Local Rendering Architecture

**🎯 Major Changes:**
- ✅ **Local rendering** - Kiosks now render branded images on-device
- ✅ **Device pairing** - QR code-based setup with JWT tokens
- ✅ **Progressive UX** - Show poem immediately, then image + QR
- ✅ **Local AI support** - Offline mode with Ollama/LM Studio
- ✅ **Smart printing** - Hub manager enables, guest long-presses
- ✅ **Async upload** - Kiosk uploads rendered images to cloud

**🔄 API Changes:**
- `POST /api/kiosk/generate` - Now returns poem only (no rendering)
- `POST /api/kiosk/upload-session` - New endpoint for image upload
- `POST /api/admin/equipment/[id]/generate-pairing-code` - New endpoint
- `POST /api/kiosk/pair` - New endpoint for device pairing
- `POST /api/kiosk/refresh-token` - New endpoint for token renewal

**🗑️ Removed:**
- Firebase/Firestore integration (legacy)
- WiFi Settings configuration panel
- Server-side branding rendering in `/generate` endpoint

**📚 Documentation:**
- Complete local rendering guide with code examples
- Local AI server setup (Ollama, LM Studio)
- Device pairing workflow
- Printing configuration
- Offline mode architecture

### Version 1.0 (2025-10-03) - Initial Release

- Server-side rendering with Fly.io
- Basic kiosk configuration
- Public viewer page
- 24-hour expiration
- Digitaal pakket support

---

**Happy Building! 🎨📸**
