# PoemBooth Kiosk

AI-powered photo booth kiosk application that creates personalized poems from guest photos at events.

## Overview

PoemBooth Kiosk is an Electron-based application designed to run unattended at events, providing guests with a unique interactive experience:

1. **Photo Capture** - Guests take a selfie using the built-in camera
2. **AI Poetry Generation** - Advanced AI creates a personalized poem inspired by the photo
3. **Beautiful Rendering** - The poem is artistically overlaid on the photo with custom branding
4. **Instant Digital Delivery** - Guests receive a QR code to download their creation
5. **Optional Printing** - Physical prints available via integrated photo printer

## Quick Start

### Deploy on a Fresh PC (5-10 minutes)

**Prerequisites:**
- Windows 10/11 PC
- Node.js 18+ ([Download](https://nodejs.org))
- OpenSSL ([Download](https://slproweb.com/products/Win32OpenSSL.html))
- Administrator access

**One-Click Deployment:**

1. Double-click `BuildBooth.bat`
2. Enter device Asset Tag (e.g., PB-005)
3. Enter Hub ID (from booking system)
4. Enter Supabase Service Role Key when prompted
5. Wait ~5-10 minutes for complete setup
6. Reboot - kiosk will start automatically

✅ **That's it!** The deployment script handles:
- Certificate generation (with secure credential handling)
- Application installation
- Auto-start configuration
- Windows kiosk mode setup

📖 **Detailed instructions:** See [QUICK_DEPLOYMENT.md](QUICK_DEPLOYMENT.md)

## Key Features

### 🎨 Fully Customizable Branding
- Custom logos, fonts, colors, and filters
- Multiple poetry styles per event
- Remote configuration updates without restart

### 🔒 Enterprise-Grade Security
- Certificate-based authentication (X.509)
- Zero-touch device provisioning
- Secure communication with backend

### 📱 Zero-Configuration WiFi Setup
- QR code-based WiFi connection
- No keyboard or manual network setup needed
- Perfect for non-technical event staff

### 🖨️ Professional Photo Printing
- Two-tier rendering system
- High-resolution (1200x1200px @ 300 DPI) for printing
- Web-optimized images for digital delivery

### 🌐 Multilingual Support
- Built-in internationalization (i18n)
- Remote language switching via backend
- Support for multiple languages

### 🎛️ Physical Hardware Integration
- Physical button for photo capture
- Rotary encoder for style selection
- Long-press printing interaction
- Raspberry Pi GPIO support

## Technology Stack

- **Electron 28.x** - Cross-platform desktop framework
- **Sharp** - High-performance image processing
- **Playwright** - Text rendering with custom fonts
- **node-wifi** - WiFi management
- **QR Code** - Digital delivery system

## Installation

### Method 1: Unified Deployment (Recommended for Production)

Use `BuildBooth.bat` for complete automated deployment. This is the fastest way to set up a new kiosk device.

**Prerequisites:**
- Windows 10/11, Linux, or macOS
- Node.js 18+ ([nodejs.org](https://nodejs.org))
- OpenSSL ([Windows Download](https://slproweb.com/products/Win32OpenSSL.html))
- Webcam or USB camera
- Internet connection
- Administrator access

**Deployment:**

```bash
# Windows: Double-click BuildBooth.bat
# Or run via PowerShell:
.\installer\Deploy-PoemBoothKiosk.ps1 -AssetTag "PB-005" -HubId "<hub-uuid>"
```

**What This Does:**
1. ✅ Generates device certificates with secure Supabase credential handling
2. ✅ Installs certificates to platform-specific location
3. ✅ Installs PoemBooth Kiosk application
4. ✅ Configures auto-start (Task Scheduler on Windows)
5. ✅ Sets up Windows kiosk mode (disables updates, sleep, etc.)
6. ✅ Validates installation
7. ✅ Securely removes all sensitive credentials from memory

**See [QUICK_DEPLOYMENT.md](QUICK_DEPLOYMENT.md) for complete deployment guide.**

### Method 2: Manual Installation (Development)

For development or custom deployments:

**Step 1: Install Dependencies**

```bash
# Install dependencies (includes Playwright Chromium ~500MB)
npm install

# Playwright is auto-installed via postinstall script
# If needed, manually install: npx playwright install chromium
```

**Step 2: Certificate Provisioning**

Before first run, devices must be provisioned with X.509 certificates.

**Certificate Locations:**
- **Windows:** `C:\ProgramData\PoemBooth\`
- **Linux:** `/etc/poembooth/`
- **macOS:** `/Library/Application Support/PoemBooth/`

**Required Files:**
- `device.crt` - Device certificate
- `device.key` - Private key (600 permissions, highly secure!)
- `ca.crt` - Root CA certificate

**See [DEVICE_PROVISIONING.md](DEVICE_PROVISIONING.md) for certificate generation instructions.**

## Usage

### Development Mode

Run with windowed display and developer tools:

```bash
npm run dev
```

**Dev mode features:**
- Windowed display (540x960px, portrait)
- Chrome DevTools enabled
- Debug panel with device info
- Keyboard shortcuts for hardware simulation
- Cursor visible

**Keyboard shortcuts:**
- `Space` or `Enter` - Capture photo
- `Left` / `Right` arrows - Cycle poetry styles
- `P` hold (3 sec) - Simulate print
- `R` - Return to booth screen

### Production Mode

Run in fullscreen kiosk mode:

```bash
npm start
```

**Production features:**
- Fullscreen, no window chrome
- Cursor hidden
- Cannot close or minimize
- No DevTools
- Hardware button integration

### Building

Package as Windows installer:

```bash
npm run build:win
```

Output: `dist/PoemBooth Kiosk Setup.exe`

## Architecture

### Process Separation

This Electron app uses strict process separation for security:

1. **Main Process** - Certificate handling, API calls, image rendering
2. **Renderer Process** - UI, camera access, user interaction
3. **Preload Bridge** - Secure IPC communication

### Service Layer

All privileged operations run in the main process:

- **ApiClient** - Backend communication with certificate auth
- **RenderingService** - Sharp + Playwright image compositing
- **WiFiService** - QR-based WiFi configuration
- **HardwareService** - GPIO button/encoder (Raspberry Pi)
- **MockHardwareService** - Keyboard simulation (dev/Windows)
- **PrinterService** - Photo printer integration

### Backend API

Connects to `https://book.poembooth.com`:

- `POST /api/devices/register` - Device registration with certificate
- `GET /api/kiosk/config` - Fetch configuration (polled every 2 min)
- `POST /api/kiosk/generate-poem` - AI poem generation
- `POST /api/kiosk/upload` - Upload rendered image
- `POST /api/kiosk/log-print` - Log print action

## Configuration

Configuration is managed remotely via backend API. Example config:

```json
{
  "ai_provider": "anthropic",
  "ai_model": "claude-3-5-sonnet",
  "printing_enabled": true,
  "camera_rotation": 90,
  "kiosk_language": "en",
  "style_configs": [
    {
      "poem_style": {
        "id": 1,
        "name": "Romantic",
        "action_button_text": "Create Your Poem"
      }
    }
  ],
  "branding": {
    "theme": "elegant",
    "filter": "warm",
    "text": {
      "fontFamily": "Georgia, serif",
      "fontSize": "24px",
      "textColor": "#ffffff"
    },
    "logo": {
      "url": "https://example.com/logo.png",
      "position": "top-right",
      "size": 100
    }
  }
}
```

Configuration updates are automatically applied without restart.

## Deployment

### Unified Deployment System

PoemBooth Kiosk now includes a streamlined deployment system that reduces setup time from 30+ minutes to under 10 minutes per device.

**Deployment Tools:**
- **`BuildBooth.bat`** - Double-click installer (Windows)
- **`installer/Deploy-PoemBoothKiosk.ps1`** - PowerShell deployment script (all platforms)
- **`QUICK_DEPLOYMENT.md`** - Comprehensive deployment guide

### Typical Deployment Flow

#### Option A: Workshop Pre-Configuration (Recommended)

1. **Run BuildBooth.bat** - Complete automated setup on fresh PC
   - Generates certificates with secure credential input
   - Installs application
   - Configures auto-start and kiosk mode
2. **Test Device** - Verify camera, printing, connectivity
3. **Ship Device** - Pre-configured, ready for deployment
4. **On-Site Setup** - Hub manager scans WiFi QR code (if needed)
5. **Auto-Start** - Device boots directly into kiosk on power-on

#### Option B: Manual Deployment

1. **Workshop Provisioning** - Generate certificates, install app manually
2. **Configure Auto-Start** - Set up Task Scheduler or startup script
3. **Shipping** - Device ships with certificates pre-installed
4. **On-Site Setup** - Hub manager scans WiFi QR code
5. **Auto-Configuration** - Device connects, registers, downloads config
6. **Ready to Use** - Kiosk starts automatically, no further setup

### Hub Assignment

**Flexible Hub Management:**
- Devices can be reassigned to different hubs without regenerating certificates
- Hub assignment is managed in the database (`equipment_inventory.hub_id`)
- Update via admin portal or direct SQL:
  ```sql
  UPDATE equipment_inventory
  SET hub_id = '<new-hub-uuid>'
  WHERE asset_tag = 'PB-005';
  ```
- Changes take effect on next config poll (~2 minutes)

### Production Hardware

**Recommended:**
- **Raspberry Pi 4** (8GB) for Linux deployments
- **Windows 10/11 PC** with USB webcam for Windows deployments
- **Physical button** via Pico USB HID (sends Enter key)
- **Rotary encoder** for style selection (optional)
- **Photo printer** (DNP DS620, Mitsubishi CP-D90DW, etc.)

## Troubleshooting

### Certificates Not Found

Check certificate location:
```bash
# Windows
dir "C:\ProgramData\PoemBooth"

# Linux
ls -la /etc/poembooth/

# macOS
ls -la "/Library/Application Support/PoemBooth/"
```

### Camera Not Working

Grant camera permissions in OS settings:
- **Windows:** Settings → Privacy → Camera
- **Linux:** Add user to `video` group
- **macOS:** System Preferences → Security & Privacy → Camera

### Backend Connection Issues

Test connectivity:
```bash
curl https://book.poembooth.com/api/health
```

Verify certificate validity:
```bash
openssl x509 -in device.crt -noout -dates
```

### Sharp Installation Failed

Rebuild native binaries:
```bash
npm rebuild sharp --verbose
```

### Playwright Download Issues

Manually install Chromium:
```bash
npx playwright install chromium
```

## Development

### Project Structure

```
kiosk-app/
├── src/
│   ├── main/              # Main process (Electron)
│   ├── renderer/          # Renderer process (UI)
│   └── services/          # Backend services
├── assets/                # Images, fonts, animations
└── package.json
```

### Key Files

- `src/main/main.js` - Electron main process, window lifecycle
- `src/main/preload.js` - IPC security bridge
- `src/renderer/renderer.js` - UI logic and state machine
- `src/services/apiClient.js` - Backend API with cert auth
- `src/services/renderingService.js` - Image compositing

### Adding New Features

1. **Service Operations** - Add to main process services
2. **IPC Handlers** - Expose via preload.js bridge
3. **UI Logic** - Implement in renderer.js state machine
4. **Security** - Never expose certificates to renderer

## Security

### Certificate Security

- **Private keys** must have 600 permissions (owner only)
- **Never commit** certificates to version control
- **Securely delete** keys after provisioning
- **Rotate certificates** before 3-year expiry (10-year validity by default)

### Secure Credential Handling (Deployment)

The unified deployment system implements strict security for sensitive credentials:

**During Certificate Generation:**
- ✅ Supabase Service Role Key prompted securely (masked input)
- ✅ Stored only in memory (PowerShell SecureString)
- ✅ Never written to disk or logs
- ✅ Automatically cleared after certificate generation
- ✅ PowerShell history cleaned to remove traces

**Post-Deployment:**
- ✅ Source certificate files securely wiped (Windows cipher.exe)
- ✅ All environment variables cleared
- ✅ Garbage collection forced to clear memory

**Service Role Key Usage:**
- Only required once during initial device provisioning
- Used to create database records and upload CA certificate
- Not needed for runtime kiosk operation
- Should be rotated periodically by administrators

### Process Isolation

- `nodeIntegration: false` - Renderer cannot access Node.js
- `contextIsolation: true` - Isolated JavaScript contexts
- IPC bridge only exposes whitelisted operations
- All file I/O and network operations in main process
- Certificates never exposed to renderer process

### Error Handling

- Guest-facing errors are user-friendly (no stack traces)
- Detailed errors logged in dev mode only
- Sensitive data redacted from logs
- Credentials never logged or displayed

## Contributing

This is proprietary software for PoemBooth events. For issues or feature requests, contact the development team.

## License

Proprietary - PoemBooth © 2025

## Support

- **Technical Support:** support@poembooth.com
- **Security Issues:** security@poembooth.com

### Documentation

- **[QUICK_DEPLOYMENT.md](QUICK_DEPLOYMENT.md)** - Fast deployment guide with troubleshooting
- **[DEVICE_PROVISIONING.md](DEVICE_PROVISIONING.md)** - Complete certificate provisioning guide
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Comprehensive deployment documentation
- **[CLAUDE.md](CLAUDE.md)** - Project architecture and technical overview
- **[KIOSK_INTEGRATION_GUIDE.md](KIOSK_INTEGRATION_GUIDE.md)** - Full system integration guide

---

**Built with ❤️ for creating memorable event experiences**
