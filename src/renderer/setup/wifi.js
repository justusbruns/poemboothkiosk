import { t } from '../translations/index.js';
import { initializeApp } from '../app.js';
import { elements, state } from '../state.js';

// =============================================================================
// WiFi Setup
// =============================================================================

// Install the active booking's venue WiFi (from backend config) as a saved
// Windows profile so the device can auto-connect to it later when in range.
// This does NOT switch the active connection mid-session — it only pre-loads
// the network. No-op when the booking has no WiFi configured or it was already
// installed this session.
export async function applyBookingWifi(config) {
  try {
    const creds = config && config.wifi_credentials;
    if (!creds || !creds.ssid) return;

    // Already installed this exact network — skip
    if (state.installedWifiSsid === creds.ssid) return;

    console.log('[CONFIG] Installing booking WiFi profile (SSID: [REDACTED])');
    const result = await window.electronAPI.wifiInstallProfile({
      ssid: creds.ssid,
      password: creds.password || ''
    });

    if (result && result.success) {
      state.installedWifiSsid = creds.ssid;
      console.log('[CONFIG] Booking WiFi profile installed successfully');
    } else {
      console.warn('[CONFIG] Booking WiFi profile install did not succeed:', result && result.error);
    }
  } catch (error) {
    // Best-effort only — never block the kiosk on this
    console.error('[CONFIG] Error installing booking WiFi profile:', error);
  }
}

// Detach the scanner video; stop the tracks only when the scanner opened its
// own stream (never the shared booth camera stream).
export function releaseWifiScannerStream() {
  if (!elements.wifiVideo || !elements.wifiVideo.srcObject) return;
  if (state.wifiOwnStream) {
    elements.wifiVideo.srcObject.getTracks().forEach(track => track.stop());
  }
  elements.wifiVideo.srcObject = null;
  state.wifiOwnStream = false;
}

export async function initializeWiFiSetup() {
  try {
    elements.wifiStatus.textContent = t('wifi.waiting');

    // Make re-entry safe: stop any previous scan loop and camera stream first.
    // Without this, the --force-wifi retry loop (and production reconnect
    // retries) would open a NEW camera stream on every pass while leaking the
    // old ones, progressively starving the camera until QR detection silently
    // stops working — which looks like "scanning got worse over time".
    if (state.wifiScanInterval) {
      clearTimeout(state.wifiScanInterval);
      state.wifiScanInterval = null;
    }
    releaseWifiScannerStream();

    // The booth camera may already be running (it starts in parallel with the
    // network checks on a paired booth). Reuse that stream rather than opening
    // the same webcam a second time; otherwise open a modest stream of our own.
    let stream = null;
    if (state.cameraReady) {
      try { await state.cameraReady; } catch (e) { /* fall through to own stream */ }
    }
    if (state.cameraStream && state.cameraStream.active) {
      stream = state.cameraStream;
      state.wifiOwnStream = false;
      console.log('[WIFI] Reusing the booth camera stream for QR scanning');
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      state.wifiOwnStream = true;
    }

    elements.wifiVideo.srcObject = stream;

    // Wait for video metadata, then make sure it is actually playing
    await new Promise((resolve) => {
      if (elements.wifiVideo.readyState >= 1) return resolve();
      elements.wifiVideo.onloadedmetadata = () => resolve();
    });
    try { await elements.wifiVideo.play(); } catch (e) { /* autoplay normally covers this */ }

    console.log('[WIFI] QR scanner started');

    // Start QR scanning loop
    scanForWiFiQR();

  } catch (error) {
    console.error('[WIFI] Setup error:', error);
    elements.wifiStatus.textContent = `Error: ${error.message}`;
  }
}

export function scanForWiFiQR() {
  // Gate on the live camera stream, NOT on state.screen. When transitioning
  // from the loading screen, showScreen() sets state.screen='wifi' only after
  // a 1s fade-out, but the camera can start scanning before that — gating on
  // state.screen would make the loop bail out and never restart (a race that
  // caused intermittent "scanner not responding"). The stream is set in
  // initializeWiFiSetup and cleared when we leave the screen, so it is the
  // reliable signal that scanning should be active.
  if (!elements.wifiVideo || !elements.wifiVideo.srcObject) return;

  try {
    const video = elements.wifiVideo;

    // Only attempt detection once the camera is actually producing frames.
    // Drawing a 0x0 frame makes jsQR find nothing with no error, which looks
    // like the scanner is dead.
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Try to detect QR code using jsQR (loaded via vendor bundle in HTML)
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data) {
          console.log('[WIFI] QR code detected:', code.data);
          handleWiFiQRDetected(code.data);
          return;
        }
      }
    }
  } catch (error) {
    console.error('[WIFI] QR scan error:', error);
  }

  // Continue scanning
  state.wifiScanInterval = setTimeout(scanForWiFiQR, 100);
}

export async function handleWiFiQRDetected(qrData) {
  // Stop scanning
  if (state.wifiScanInterval) {
    clearTimeout(state.wifiScanInterval);
  }

  elements.wifiStatus.textContent = t('wifi.detected');

  try {
    // Parse WiFi config
    const wifiConfig = parseWiFiQR(qrData);

    if (!wifiConfig) {
      throw new Error('Invalid WiFi QR code format');
    }

    // Connect to WiFi (via main process)
    const result = await window.electronAPI.wifiConnect(wifiConfig);

    if (!result.success) {
      throw new Error(result.error || 'WiFi connection failed');
    }

    elements.wifiStatus.textContent = t('wifi.connected');

    // Release the QR-scanning camera before continuing (only if it was our own
    // stream; a shared booth stream must keep running).
    releaseWifiScannerStream();

    // Restart initialization now that we have connectivity
    await initializeApp();

  } catch (error) {
    console.error('[WIFI] Connection error:', error);
    elements.wifiStatus.textContent = `${t('wifi.failed')}: ${error.message}`;

    // Restart scanning after 3 seconds
    setTimeout(() => {
      elements.wifiStatus.textContent = t('wifi.waiting');
      scanForWiFiQR();
    }, 3000);
  }
}

export function parseWiFiQR(qrData) {
  try {
    if (!qrData) return null;
    const data = qrData.trim();

    // Standard WiFi QR format:  WIFI:S:<ssid>;T:<WPA|WEP|nopass|SAE>;P:<pw>;H:<bool>;;
    //
    // IMPORTANT: field order is NOT fixed. Android phones typically emit
    // S;T;P (SSID first) while iOS emits T;S;P. The previous regex assumed a
    // fixed T;S;P order and silently rejected Android codes. We also honour the
    // spec's backslash escaping (\\  \;  \,  \:  \") so passwords/SSIDs that
    // contain those characters are read correctly.
    if (/^WIFI:/i.test(data)) {
      const body = data.substring(5); // strip "WIFI:"
      const fields = {};
      let key = null;
      let buf = '';
      let parsingKey = true;

      for (let i = 0; i < body.length; i++) {
        const ch = body[i];

        // Backslash escape — take the next character literally
        if (ch === '\\' && i + 1 < body.length) {
          buf += body[i + 1];
          i++;
          continue;
        }

        // First unescaped ':' separates key from value
        if (parsingKey && ch === ':') {
          key = buf.toUpperCase();
          buf = '';
          parsingKey = false;
          continue;
        }

        // Unescaped ';' ends the current field
        if (ch === ';') {
          if (key !== null) fields[key] = buf;
          key = null;
          buf = '';
          parsingKey = true;
          continue;
        }

        buf += ch;
      }
      // Flush a trailing field if the string didn't end with ';'
      if (key !== null && !parsingKey) fields[key] = buf;

      if (fields.S) {
        return {
          security: (fields.T || 'WPA2').toUpperCase(),
          ssid: fields.S,
          password: fields.P || '',
          hidden: /^true$/i.test(fields.H || '')
        };
      }
    }

    // Alternative: JSON format
    try {
      const json = JSON.parse(data);
      if (json.ssid) {
        return {
          security: json.security || 'WPA2',
          ssid: json.ssid,
          password: json.password || ''
        };
      }
    } catch (e) {
      // Not JSON
    }

    return null;
  } catch (error) {
    console.error('[WIFI] Parse error:', error);
    return null;
  }
}
