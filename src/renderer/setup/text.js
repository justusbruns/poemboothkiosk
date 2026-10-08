import { t } from '../translations/index.js';
import { elements } from '../state.js';

// =============================================================================
// Device Pairing (Smart-TV style)
// =============================================================================
//
// The booth asks the backend for a short code, shows it with a QR code that
// opens <dashboard>/pair?code=XXXX-XXXX, and polls until an operator has
// logged in on their phone and linked this booth to their hub. The secret
// device_code lives in the main process; the renderer only ever sees the
// user-facing code.

// Apply the active language to the setup screens (language / WiFi / pairing)
export function applySetupText() {
  if (elements.languageTitle) elements.languageTitle.textContent = t('setup.chooseLanguage');
  if (elements.languageHint) elements.languageHint.textContent = t('setup.languageHint');
  const wifiTitle = document.querySelector('#wifi-screen h1');
  const wifiInstruction = document.querySelector('#wifi-screen p');
  if (wifiTitle) wifiTitle.textContent = t('wifi.setupRequired');
  if (wifiInstruction) wifiInstruction.textContent = t('wifi.holdQRCode');
  if (elements.pairingTitle) elements.pairingTitle.textContent = t('setup.pairingTitle');
  if (elements.pairingIntro) elements.pairingIntro.textContent = t('setup.pairingIntro');
}

// Tiny placeholder helper for setup strings: "{name}" → value
export function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (values && values[k] != null ? values[k] : m));
}

// First-boot language picker. Knob (or arrow keys) toggles, button (or
