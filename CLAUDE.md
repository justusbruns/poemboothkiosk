# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Electron-based kiosk application** for AI-powered photo booth experiences at events. The system uses **certificate-based authentication** for zero-touch device provisioning and secure backend communication.

**Key Technology Stack:**
- Electron 28.x (main + renderer processes with IPC bridge)
- Sharp (server-side image processing)
- Playwright (text rendering for poem overlays)
- node-wifi (WiFi auto-configuration)
- Certificate-based auth (X.509 certificates)

## Development Commands

```bash
# Install dependencies (includes Playwright Chromium ~500MB via postinstall)
npm install

# Development mode (windowed, DevTools enabled, cursor visible)
npm run dev

# Dev with staging backend
npm run dev:staging

# Dev with real printer (mock printer is default in dev)
npm run dev:real-printer

# Dev with staging + real printer
npm run dev:staging-printer

# Production kiosk mode (fullscreen, no chrome, cursor hidden)
npm start

# Build Windows installer → dist/PoemBooth Kiosk Setup.exe
npm run build:win
```

### CLI Flags

These flags can be combined with `electron .`:
- `--dev` — Windowed mode, DevTools, debug panel, cursor visible
- `--staging` — Use staging backend instead of production
- `--mock-printer` — Force mock printer (default in dev mode)
- `--real-printer` — Force real printer in dev mode
- `--force-wifi` — Force WiFi setup screen

## Architecture Overview

### Process Architecture

This is an **Electron app with strict process separation**:

1. **Main Process** (`src/main/main.js`):
   - Manages window lifecycle and system integration
   - Handles all certificate I/O from platform-specific paths
   - Hosts service classes (ApiClient, RenderingService, WiFiService)
   - Exposes IPC handlers for renderer communication
   - Security: `nodeIntegration: false`, `contextIsolation: true`

2. **Renderer Process** (`src/renderer/renderer.js`):
   - UI logic and state management
   - Camera access via browser APIs (getUserMedia)
   - QR code scanning for WiFi setup
   - Communicates with main process via `window.electronAPI` (preload bridge)

3. **Preload Script** (`src/main/preload.js`):
   - Security bridge between main and renderer
   - Exposes whitelisted IPC channels to renderer

### Service Layer Architecture

All heavy services run in the **main process** to isolate privileged operations:

**`apiClient.js`** - Backend communication:
- Certificate-based authentication (`Authorization: Bearer {base64_cert}`)
- Endpoints: `/api/devices/register`, `/api/kiosk/config`, `/api/kiosk/generate-poem`, `/api/kiosk/upload`
- Backend URL: `https://book.poembooth.com`

**`renderingService.js`** - Local image compositing:
- Uses Sharp for image manipulation (filters, overlays, resizing)
- Uses Playwright (headless Chromium) for text rendering with custom fonts/styling
- Generates final branded poem image locally before upload

**`wifiService.js`** - Network management:
- Connects device to WiFi via QR code scan (standard WiFi QR format)
- Platform-specific implementations (node-wifi library)

**`hardwareService.js`** / **`mockHardwareService.js`** - Hardware integration:
- Real GPIO support for Raspberry Pi (physical button, rotary encoder)
- Mock service for dev/Windows (keyboard events simulate hardware)
- Pico USB HID button sends Enter key events in production

**`printerService.js`** - Printing:
- Two-tier rendering: high-res (1200x1200px @ 300 DPI) for printing, web-optimized (template size @ 85%) for upload
- Manages printer status and print jobs

**`cameraService.js`** - Camera capture:
- Currently implemented inline in renderer using browser APIs
- Uses `navigator.mediaDevices.getUserMedia`

**`applyFilter.js`** / **`photoFilters.js`** - Photo filters:
- 12 curated filter presets (Sharp-based: brightness, contrast, saturation)
- Ported from TypeScript backend (`apply-filter.ts`, `photo-filters.ts`)

**`mockPrinterService.js`** - Dev printer simulation:
- Used by default in dev mode (override with `--real-printer`)

### Security Library

**`src/lib/certificatePinning.js`** - TLS certificate pinning:
- Staging uses hardcoded SHA-256 fingerprints
- Production uses TOFU (Trust On First Use)
- Has emergency bypass support for incident response

## Certificate-Based Authentication System

### Certificate Locations (Platform-Specific)

**Windows:** `C:\ProgramData\PoemBooth\`
**Linux:** `/etc/poembooth/`
**macOS:** `/Library/Application Support/PoemBooth/`

Required files:
- `device.crt` - Device public certificate (644 permissions)
- `device.key` - Device private key (600 permissions, KEEP SECURE)
- `ca.crt` - Root CA certificate (644 permissions)

### Authentication Flow

1. **First Boot:**
   - Check if certificates exist
   - If no internet → Show WiFi QR scanner
   - Hub manager scans WiFi QR code from admin portal
   - Device connects to WiFi automatically

2. **Registration:**
   - Device reads certificates from filesystem
   - Calls `/api/devices/register` with cert in `Authorization` header (base64-encoded)
   - Backend validates certificate, extracts device_id/equipment_id from certificate SANs
   - Returns device config and kiosk settings

3. **Subsequent Requests:**
   - All API calls include certificate in `Authorization: Bearer {base64_cert}`
   - Optional device token in `X-Device-Token` header

### Device Provisioning

Devices must be provisioned BEFORE deployment using the setup script in the booking system repository. See `DEVICE_PROVISIONING.md` for complete provisioning workflow.

**Never hardcode credentials** - all authentication is certificate-based.

## Application Workflow

### State Machine

```
[loading] → [wifi] → [booth] → [processing] → [result]
                ↓         ↓                        ↓
              [error] ← ← ← ← ← ← ← ← ← ← ← ← ← ←
```

**loading:** Certificate check, API initialization, device registration
**wifi:** QR code scanner for WiFi auto-setup (if no internet)
**booth:** Main photo capture screen with countdown
**processing:** AI poem generation + local rendering + upload (with progress)
**result:** Display rendered image + QR code for download
**error:** Error screen with retry option

### Guest Experience Flow

1. Guest presses "Take Photo"
2. 3-second countdown
3. Photo captured via `getUserMedia` → canvas → data URL
4. Preview shown (retake or confirm)
5. After confirm:
   - Send photo to backend via `/api/kiosk/generate-poem`
   - Backend calls AI (Anthropic/OpenAI/Google) to generate poem
   - Kiosk renders final image locally using Sharp + Playwright
   - Upload rendered image to backend storage via `/api/kiosk/upload`
   - Display result with QR code
6. Guest scans QR or long-presses to print
7. "Take Another Photo" to restart

## Configuration

Configuration is fetched from backend on registration (`/api/kiosk/config`) and polled every 2 minutes for live updates (camera rotation, poetry styles, branding, language). No restart needed for config changes.

## Hardware Integration

### Physical Hardware (Raspberry Pi)

- **Button:** GPIO-connected, triggers photo capture
- **Rotary Encoder:** GPIO-connected, cycles through poetry styles
- **Long Press:** 3-second hold to print

### Mock Hardware (Dev/Windows)

- **Space/Enter:** Capture photo (booth screen)
- **Left/Right Arrow:** Cycle poetry styles
- **P Key Hold:** Simulate 3-second hold to print
- **R Key:** Return to booth from result screen

### Pico USB HID Button (Production Windows)

The physical button sends Enter key events via USB HID. Key events are:
1. Captured in renderer process (`keydown`/`keyup` listeners)
2. Forwarded to main process via IPC (`hardware:keyEvent`)
3. Handled by `MockHardwareService` which emits events
4. Events trigger appropriate UI actions (capture, print, etc.)

## Development Mode Features

Enable dev mode with `npm run dev` or `--dev` flag:

- Windowed display (540x960, 50% scale portrait) instead of fullscreen
- Chrome DevTools enabled
- Debug panel visible in UI (shows device ID, equipment ID, connection status)
- Cursor shown
- Quit button enabled
- Window closable/minimizable
- Keyboard shortcuts for hardware simulation

## Security Model

- Renderer has `nodeIntegration: false` and `contextIsolation: true` — all privileged operations (file I/O, network, certificates) must go through IPC to the main process
- Certificate private keys must have 600 permissions — never commit to version control
- Navigation is restricted to `file://` URLs in production
- Detailed error info is only logged in dev mode

## Important Notes

- This is a **kiosk application** - production mode is designed to run fullscreen and unattended
- All AI processing happens on the **backend** - kiosk only does local rendering/compositing
- Devices are **pre-provisioned** in workshop before shipping to hubs
- Hub managers only need to scan WiFi QR code - no manual configuration
- Certificate validity: 3 years (plan renewal at 2.5 years)
