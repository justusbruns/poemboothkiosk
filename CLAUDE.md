# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Electron-based kiosk application** for AI-powered photo booth experiences at events. The system uses **certificate-based authentication** for zero-touch device provisioning and secure backend communication.

**Key Technology Stack:**
- Electron (main + renderer processes with IPC bridge)
- Sharp (printer image metadata + 2x6 strip layout only)
- node-wifi / netsh (WiFi auto-configuration)
- Device pairing (Supabase device session) with legacy X.509 certificate fallback

The poem image is **rendered on the backend** (Fly.io renderer, called from `/api/kiosk/generate`). The kiosk does no image compositing and ships no browser engine.

## Development Commands

```bash
# Install dependencies (no browser download; electron-builder rebuilds native deps)
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
- `--force-pair` — Show the device pairing screen even if credentials are stored (re-pair this booth)

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
- Auth modes: `device_token` (paired, `Authorization: Bearer <supabase access token>`, auto-refresh via `/api/device-auth/refresh`), `certificate` (legacy `Bearer {base64_cert}`), `none` (needs pairing)
- Endpoints: `/api/device-auth/*`, `/api/kiosk/config`, `/api/kiosk/generate` (streaming), `/api/kiosk/print-jobs`, `/api/kiosk/printer-status`
- Backend URL: `https://book.poembooth.com` (`--staging` → Vercel staging deployment)
- All requests have timeouts (30 s JSON, 60–90 s multipart); response bodies are never logged

**Generate stream** (`apiClient.generateContent` → IPC `generate:event` → renderer `handleGenerateEvent`):
`POST /api/kiosk/generate` multipart (`photo` downscaled to ≤2048 px / q0.85, `equipment_id`, `hub_id`, `style_id`, `stream=1`) with `Accept: application/x-ndjson`. The backend answers with one JSON object per line:
- `start` {session_id, booking_id, generation_type, caption} → result screen, typing starts
- `poem_delta` {text} … → typed as they arrive; `poem_done` {poem, caption, metadata}
- `image_result` {…same fields as the image JSON…} (image styles)
- `render` {public_view_url, rendered_image_url, print_image_url, print_format, print_orientation, width, height} → QR shown, main prefetches the print asset
- `render_error` {error} → poem stays, toast, no QR/print
- `error` {error, code} (only after the stream opened; earlier failures are plain HTTP JSON errors) · `done`
A plain JSON response (older backend) is converted into the same events by the client. The captured frame is already rotated by the kiosk, so `photo_rotation` is not sent.

**`credentialStore.js`** - Pairing credentials (encrypted with `safeStorage`, per environment)

**`wifiService.js`** - Network management:
- Connects device to WiFi via QR code scan (standard WiFi QR format)
- Platform-specific implementations (node-wifi library)

**`hardwareService.js`** / **`mockHardwareService.js`** - Hardware integration:
- Real GPIO support for Raspberry Pi (physical button, rotary encoder)
- Mock service for dev/Windows (keyboard events simulate hardware)
- Pico USB HID button sends Enter key events in production

**`printerService.js`** - Printing:
- Prints the backend's print asset (`print_image_url` from the `render` event, prefetched and cached in main; IPC `printer:print-session`) or, for image styles, the generated image buffer
- Portal print jobs (`printJobService.js`) download `rendered_image_url` of the job
- Manages printer status and supply telemetry

**Camera capture** lives in the renderer (`getUserMedia` → canvas, captured at ≤2048 px); there is no camera service in main.

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
[loading] → [language] → [wifi] → [pairing] → [booth] → [processing] → [result]
                ↓         ↓                        ↓
              [error] ← ← ← ← ← ← ← ← ← ← ← ← ← ←
```

**loading:** API initialization (stored device credentials or legacy certificate), device registration
**language:** First-boot only (unpaired booth, no `userData/setup.json` yet): pick NL/EN for the setup screens with knob/button or arrow keys + Enter. Paired booths use the backend config language.
**wifi:** QR code scanner for WiFi auto-setup (if no internet)
**pairing:** Smart-TV style pairing when the booth has no credentials: shows a short code + QR (`<dashboard>/pair?code=…`); the operator logs in on their phone, picks/creates the booth, and the kiosk polls `/api/device-auth/poll` until approved. Credentials (Supabase device session) are stored encrypted in `userData/device-credentials.<env>.json` via `credentialStore.js`.
**booth:** Main photo capture screen with countdown
**processing:** photo upload; switches to `result` as soon as the stream's `start` event arrives
**result:** Display rendered image + QR code for download
**error:** Error screen with retry option

### Guest Experience Flow

1. Guest presses "Take Photo"
2. 3-second countdown
3. Photo captured via `getUserMedia` → canvas → data URL
4. Preview shown (retake or confirm)
5. After capture:
   - Send the (downscaled) photo to `/api/kiosk/generate` as an NDJSON stream request
   - Backend calls AI (Anthropic/OpenAI/Google); the poem is streamed and typed on screen while it is written
   - Backend renders the branded image on Fly.io, stores web + print versions, streams `render`
   - Kiosk shows the QR code; main prefetches the print asset
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
- All AI processing **and image rendering** happen on the backend; the kiosk only captures, streams the poem to the screen, shows the QR and prints
- Devices are **pre-provisioned** in workshop before shipping to hubs
- Hub managers only need to scan WiFi QR code - no manual configuration
- Certificate validity: 3 years (plan renewal at 2.5 years)
