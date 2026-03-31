# Repository Guidelines

## Project Structure & Module Organization
- `src/main/` hosts the Electron main process, IPC wiring, and service bootstrapping—keep browser-only APIs out.
- `src/renderer/` contains the kiosk UI and only touches privileged work through `window.electronAPI` (see `src/main/preload.js`).
- `src/services/` bundles backend, hardware, WiFi, rendering, and printer logic; keep new integrations as focused classes invoked over IPC.
- `assets/` stores fonts, icons, and Lottie files; `certificates/` holds sample certs included at build time (real certs live in the platform paths from `DEVICE_PROVISIONING.md`).

## Build, Test, and Development Commands
- `npm install` — Installs dependencies plus Playwright Chromium during `postinstall`.
- `npm run dev` — Windowed build with DevTools, debug overlays, and mock hardware (Space/Enter, arrow keys).
- `npm start` — Fullscreen kiosk mode, cursor hidden.
- `npm run build` / `npm run build:win` — Electron Builder outputs in `dist/` (NSIS + unpacked).
- `node test-certificates.js` — Verifies cert presence and expiry before hitting the backend.

## Coding Style & Naming Conventions
- CommonJS modules, 2-space indentation, single quotes, and `const` by default (see `src/main/main.js`).
- Renderer code stays UI-only; route privileged work through IPC channels named `domain:action` (e.g., `printer:print`).
- Use lowercase filenames with camelCase suffixes (`renderingService.js`) and mirror directory intent; collect reusable helpers under `src/shared/` when needed.

## Testing Guidelines
- There is no formal test harness yet; run flows with `npm run dev`, log assertions, and add Node-based checks beside the feature (e.g., `src/services/__tests__/renderingService.test.js`) that stub IPC.
- Execute `node test-certificates.js`, printer smoke tests, and WiFi probes before imaging a device.
- Record manual steps in `FIXES_APPLIED.md` or `docs/testing-*.md` so field teams can replay them.

## Commit & Pull Request Guidelines
- Favor short, present-tense subjects scoped by subsystem (`renderer: align countdown copy`, `services: bail on empty certs`) plus bodies that call out intent, risk, and fallback.
- PRs should list kiosk mode exercised (dev/full), OS build, certificate scenario (test vs prod), and any screenshots or clips for UI changes; link backend tickets or hub requests when they exist.

## Security & Configuration Tips
- Never commit production certificates or device tokens. Real installs should load from `C:\ProgramData\PoemBooth`, `/etc/poembooth`, or `/Library/Application Support/PoemBooth/`, ideally with OS-level ACLs and BitLocker.
- Preserve `nodeIntegration: false`, `contextIsolation: true`, validate IPC payloads, and bundle third-party scripts locally to avoid CDN injection at live events.
