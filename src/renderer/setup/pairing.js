import { t } from '../translations/index.js';
import { initializeApp, isNetworkError } from '../app.js';
import { showScreen } from '../screens.js';
import { applySetupText, fill } from './text.js';
import { elements, state } from '../state.js';

export function stopPairingPolling() {
  if (state.pairingPollTimer) {
    clearTimeout(state.pairingPollTimer);
    state.pairingPollTimer = null;
  }
  state.pairingActive = false;
}

export function renderPairingQr(url) {
  if (!elements.pairingQr) return;
  elements.pairingQr.innerHTML = '';
  if (typeof QRCodeStyling === 'undefined') {
    elements.pairingQr.textContent = url;
    return;
  }
  const qr = new QRCodeStyling({
    type: 'canvas',
    shape: 'square',
    width: 320,
    height: 320,
    data: url,
    margin: 0,
    qrOptions: { typeNumber: '0', mode: 'Byte', errorCorrectionLevel: 'M' },
    dotsOptions: { type: 'rounded', color: '#000000', roundSize: true },
    cornersSquareOptions: { type: 'extra-rounded', color: '#000000' },
    backgroundOptions: { color: '#ffffff' }
  });
  qr.append(elements.pairingQr);
}

export async function startPairingFlow() {
  stopPairingPolling();
  state.pairingActive = true;

  if (elements.pairingEnv) {
    const flags = await window.electronAPI.getFlags();
    elements.pairingEnv.style.display = flags.isStaging ? 'block' : 'none';
  }

  applySetupText();
  elements.pairingStatus.textContent = t('setup.pairingRequesting');
  elements.pairingCode.textContent = '····-····';
  elements.pairingUrl.textContent = '';
  if (elements.pairingQr) elements.pairingQr.innerHTML = '';

  let pairing;
  try {
    pairing = await window.electronAPI.pairingStart();
  } catch (error) {
    console.error('[PAIRING] Failed to start pairing:', error);
    if (!state.pairingActive) return;
    if (isNetworkError(error)) {
      elements.pairingStatus.textContent = t('setup.pairingNoConnection');
    } else {
      elements.pairingStatus.textContent = fill(t('setup.pairingError'), { error: error.message });
    }
    state.pairingPollTimer = setTimeout(startPairingFlow, 8000);
    return;
  }

  console.log('[PAIRING] Code', pairing.user_code, '→', pairing.verification_url_complete);
  elements.pairingCode.textContent = pairing.user_code;
  elements.pairingUrl.textContent = (pairing.verification_url || '').replace(/^https?:\/\//, '');
  renderPairingQr(pairing.verification_url_complete || pairing.verification_url);
  elements.pairingStatus.textContent = t('setup.pairingWaiting');

  const intervalMs = Math.max(2000, (pairing.interval || 5) * 1000);
  const expiresAt = Date.now() + (pairing.expires_in || 600) * 1000;

  const poll = async () => {
    if (!state.pairingActive) return;

    if (Date.now() > expiresAt) {
      console.log('[PAIRING] Code expired locally, requesting a new one');
      startPairingFlow();
      return;
    }

    let result;
    try {
      result = await window.electronAPI.pairingPoll();
    } catch (error) {
      console.warn('[PAIRING] Poll failed:', error.message);
      elements.pairingStatus.textContent = t('setup.pairingHiccup');
      state.pairingPollTimer = setTimeout(poll, intervalMs);
      return;
    }

    if (!state.pairingActive) return;

    switch (result.status) {
      case 'approved':
        console.log('[PAIRING] Approved:', result.device);
        stopPairingPolling();
        state.deviceConfig = result.device;
        elements.pairingStatus.textContent = fill(t('setup.pairingConnected'), { name: result.device.equipment_name || 'booth' });
        // Give the operator a moment to read the confirmation, then boot normally
        setTimeout(() => {
          // Leave via the loading screen so the usual fade/flow applies
          showScreen('loading');
          initializeApp();
        }, 1500);
        return;

      case 'pending':
        elements.pairingStatus.textContent = t('setup.pairingWaiting');
        state.pairingPollTimer = setTimeout(poll, result.slow_down ? intervalMs * 2 : intervalMs);
        return;

      case 'expired':
      case 'not_found':
      case 'claimed':
      case 'denied':
      case 'not_started':
        console.log('[PAIRING] Code', result.status, '— requesting a new one');
        elements.pairingStatus.textContent = t('setup.pairingExpired');
        state.pairingPollTimer = setTimeout(startPairingFlow, 1500);
        return;

      default:
        console.warn('[PAIRING] Unexpected poll result:', result);
        elements.pairingStatus.textContent = fill(t('setup.pairingError'), { error: result.error || result.status });
        state.pairingPollTimer = setTimeout(startPairingFlow, 8000);
        return;
    }
  };

  state.pairingPollTimer = setTimeout(poll, intervalMs);
}

// Stored credentials stopped working (device revoked / re-paired elsewhere):
// drop everything and go back to the pairing screen.
export function handleAuthInvalid(reason) {
  console.warn('[RENDERER] Device credentials invalid:', reason);
  if (state.screen === 'pairing' && state.pairingActive) return;
  if (state.configPollingInterval) {
    clearInterval(state.configPollingInterval);
    state.configPollingInterval = null;
  }
  stopPairingPolling();
  // Re-run the normal start sequence: it lands on language (if never chosen),
  // WiFi (if offline) or the pairing screen.
  showScreen('loading');
  initializeApp();
}
