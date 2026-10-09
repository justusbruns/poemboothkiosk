import { t, loadTranslations } from './translations/index.js';
import { updatePriceBadge, updateTermsNotice } from './booth/badges.js';
import { applyCameraRotation, initializeCamera } from './booth/camera.js';
import { buildStyleCoverflow, startCtaRotation, updateActionLabel } from './booth/coverflow.js';
import { setupEventListeners } from './booth/events.js';
import { startConfigPolling } from './config.js';
import { updateDebugInfo } from './debug.js';
import { initLoadingLottie } from './lottie.js';
import { updateResultActionLabel } from './result/ui.js';
import { screenHardware, showScreen } from './screens.js';
import { showLanguageScreen } from './setup/language.js';
import { handleAuthInvalid, startPairingFlow } from './setup/pairing.js';
import { applySetupText } from './setup/text.js';
import { applyBookingWifi, initializeWiFiSetup, scanForWiFiQR } from './setup/wifi.js';
import { elements, state } from './state.js';
import { formatCameraResolution, showError, updateStatus } from './ui.js';
import { handleUpdateInstall, showUpdateScreen } from './update.js';

// =============================================================================
// UI Text Update (for i18n)
// =============================================================================

export function updateUIText() {
  // Update static text elements with translations
  console.log('[i18n] Updating UI text with current language');

  // WiFi screen (but rarely seen)
  const wifiTitle = document.querySelector('#wifi-screen h1');
  const wifiInstruction = document.querySelector('#wifi-screen p');
  if (wifiTitle) wifiTitle.textContent = t('wifi.setupRequired');
  if (wifiInstruction) wifiInstruction.textContent = t('wifi.holdQRCode');

  // Booth screen - "Press for Poetry" comes from poem_style.action_button_text instead
  // Style hint
  if (elements.styleHint) {
    elements.styleHint.textContent = t('booth.turnKnob');
  }

  // Result screen - QR label (adaptive: print & save when a printer is connected)
  updateResultActionLabel();

  // Result screen - hold-to-print label
  if (elements.printLabel) {
    elements.printLabel.textContent = t('result.holdToPrint');
  }

  // Booth screen - turn-knob hint + (re)start the rotating hero CTA in the active language
  updateActionLabel();
  startCtaRotation();

  // Booth screen - terms notice text (keep in sync with the active language)
  updateTermsNotice();

  // Booth screen - price badge (currency formatting follows the active language)
  updatePriceBadge();

  // Error screen
  const errorTitle = document.querySelector('#error-screen h1');
  const errorInstructions = document.querySelector('.hardware-instructions strong');
  if (errorTitle) errorTitle.textContent = t('error.somethingWentWrong');
  if (errorInstructions) errorInstructions.textContent = t('error.buttonTryAgain');

  console.log('[i18n] UI text updated successfully');
}

// =============================================================================
// App Initialization
// =============================================================================

// Open the booth camera without waiting for anything else. Safe to call more
// than once; the promise is kept so the booth can await it later.
export function startCameraEarly() {
  if (state.cameraReady) return state.cameraReady;
  if (state.cameraStream && state.cameraStream.active) {
    state.cameraReady = Promise.resolve(true);
    return state.cameraReady;
  }
  state.cameraReady = initializeCamera(elements.cameraVideo);
  // Errors are surfaced where the camera is awaited (ensureCamera), not here
  state.cameraReady.catch(() => {});
  return state.cameraReady;
}

export async function ensureCamera() {
  // An in-flight initialisation must be awaited in full: initializeCamera sets
  // state.cameraStream before the 4K switch and metadata are done.
  if (!state.cameraReady && state.cameraStream && state.cameraStream.active) return true;
  try {
    return await startCameraEarly();
  } catch (error) {
    // One retry: a stream that failed early may have been a transient device busy
    state.cameraReady = null;
    console.warn('[CAMERA] Early camera start failed, retrying once:', error.message);
    return initializeCamera(elements.cameraVideo);
  }
}

// Check for updates after the booth is up. If one is available, wait until
// the booth is idle (no capture/processing/result in progress) before
// showing the update prompt, so a guest is never interrupted.
export function scheduleBackgroundUpdateCheck() {
  if (state.updateCheckScheduled) return;
  state.updateCheckScheduled = true;

  setTimeout(async () => {
    let updateResult;
    try {
      updateResult = await window.electronAPI.updateCheck();
    } catch (error) {
      console.warn('[UPDATE] Background update check failed:', error.message);
      return;
    }

    if (!updateResult || !updateResult.available || !updateResult.info) {
      console.log('[RENDERER] No update available, current version:', updateResult && updateResult.currentVersion);
      return;
    }

    console.log('[RENDERER] Update available:', updateResult.info.version, '— waiting for an idle booth');
    state.updateAvailable = true;
    state.updateInfo = updateResult.info;

    const tryPrompt = async () => {
      const idle = state.screen === 'booth' && !state.isProcessing && !state.isCapturing && !state.glassWiping;
      if (!idle) {
        setTimeout(tryPrompt, 5000);
        return;
      }
      const shouldUpdate = await showUpdateScreen(updateResult.currentVersion, updateResult.info.version);
      if (shouldUpdate) {
        await handleUpdateInstall();
        return; // App restarts after install
      }
      console.log('[RENDERER] User skipped update, continuing...');
      await window.electronAPI.updateSkip();
      showScreen('booth');
    };
    tryPrompt();
  }, 3000);
}

// Detect whether an error is caused by lack of network/internet (vs a real
// application error). Used to route to the WiFi setup screen instead of the
// red error screen. Note: errors crossing the IPC boundary lose their .code,
// so we also match on the message text.
// Diagnostics (--perf-probe): every 3 s log the requestAnimationFrame rate, the
// camera's delivered frame rate, dropped/total video frames and long tasks, so
// engine versions and Chromium flags can be compared by numbers.
function startPerfProbe() {
  const video = elements.cameraVideo;
  let rafFrames = 0;
  let videoFrames = 0;
  let longTasks = 0;
  let prevDropped = 0;
  let prevTotal = 0;
  let last = performance.now();

  const rafTick = () => { rafFrames++; requestAnimationFrame(rafTick); };
  requestAnimationFrame(rafTick);

  if (video && typeof video.requestVideoFrameCallback === 'function') {
    const onFrame = () => { videoFrames++; video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  }
  try {
    new PerformanceObserver((list) => { longTasks += list.getEntries().length; })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { /* unsupported */ }

  setInterval(() => {
    const now = performance.now();
    const secs = (now - last) / 1000;
    last = now;
    let dropped = -1, total = -1;
    try {
      const q = video.getVideoPlaybackQuality();
      dropped = q.droppedVideoFrames - prevDropped;
      total = q.totalVideoFrames - prevTotal;
      prevDropped = q.droppedVideoFrames;
      prevTotal = q.totalVideoFrames;
    } catch (e) { /* ignore */ }
    console.log(`[PERF] screen=${state.screen} raf=${(rafFrames / secs).toFixed(1)}fps camera=${(videoFrames / secs).toFixed(1)}fps dropped=${dropped}/${total} longTasks=${longTasks}`);
    rafFrames = 0; videoFrames = 0; longTasks = 0;
  }, 3000);
}

export function isNetworkError(error) {
  if (!error) return false;
  const codes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE'];
  if (error.code && codes.includes(error.code)) return true;
  const msg = (error.message || '').toLowerCase();
  return codes.some(c => msg.includes(c.toLowerCase())) ||
    msg.includes('getaddrinfo') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('request timeout');
}

export async function initializeApp() {
  try {
    updateStatus('loading', 'Starting...');

    // Get debug flags from main process
    const flags = await window.electronAPI.getFlags();
    console.log('[RENDERER] Debug flags:', flags);

    // Check for force WiFi mode (for testing)
    if (flags.forceWifi) {
      console.log('[RENDERER] Force WiFi mode enabled - showing WiFi screen for testing');
      showScreen('wifi');
      await initializeWiFiSetup();
      return;
    }

    // Initialize API client (in main process). Loads stored device
    // credentials or legacy certificate files; never fails just because the
    // booth has not been paired yet.
    const initResult = await window.electronAPI.apiInitialize();
    if (!initResult.success) {
      throw new Error(`API initialization failed: ${initResult.error}`);
    }

    // Local check (no network): does this booth already have credentials?
    const authStatus = await window.electronAPI.apiGetAuthStatus();
    console.log('[RENDERER] Auth status:', authStatus.mode, authStatus.paired ? `(equipment ${authStatus.equipment_id})` : '');
    const forcePair = flags.forcePair && !state.pairingForcedOnce;
    const needsSetup = !authStatus.paired || forcePair;

    // A paired booth is going to need the camera; open it now, in parallel
    // with the network steps below, instead of after them (the 4K switch
    // alone takes ~3.5 s). Setup flows (WiFi/pairing) share this stream.
    if (!needsSetup) startCameraEarly();

    // First-boot setup, step 1: language (NL/EN) for the setup screens.
    // Paired booths take their language from the backend config instead.
    let setupLanguage = await window.electronAPI.setupGetLanguage();
    if (needsSetup && !setupLanguage) {
      setupLanguage = await showLanguageScreen();
      await window.electronAPI.setupSetLanguage(setupLanguage);
      showScreen('loading');
    }
    // Operator-facing screens (WiFi, pairing, update) follow the setup
    // language whenever one was chosen; guest UI follows the backend config.
    if (setupLanguage) {
      loadTranslations(setupLanguage);
      applySetupText();
    }

    updateStatus('loading', t('loading.checkingNetwork'));

    // Step 2: connectivity. An unpaired booth still needs WiFi before it can
    // show a pairing code; a paired booth needs it to fetch its config.
    const connResult = await window.electronAPI.apiCheckConnectivity();
    if (!connResult.isOnline) {
      // Show WiFi setup screen
      showScreen('wifi');
      await initializeWiFiSetup();
      return;
    }

    // Step 3: not paired yet (no stored credentials, no certificate)? Show the
    // Smart-TV style pairing screen and come back here once approved.
    if (needsSetup) {
      state.pairingForcedOnce = true;
      showScreen('pairing');
      await startPairingFlow();
      return;
    }

    updateStatus('loading', 'Registering device...');

    // Register device
    const deviceData = await window.electronAPI.apiRegisterDevice();
    state.deviceConfig = deviceData.device;

    updateStatus('loading', 'Fetching configuration...');

    // Get kiosk configuration
    state.kioskConfig = await window.electronAPI.apiGetConfig();

    // Operator language from the dashboard (equipment setting) wins over the
    // locally chosen setup language. Stored so WiFi/pairing screens use it
    // on later boots too, and applied now so the update prompt is in it.
    const operatorLanguage = state.kioskConfig.operator_language;
    if (operatorLanguage && operatorLanguage !== setupLanguage) {
      console.log('[RENDERER] Operator language from config:', operatorLanguage);
      const saved = await window.electronAPI.setupSetLanguage(operatorLanguage);
      if (!saved || !saved.success) console.warn('[RENDERER] Could not persist operator language:', saved && saved.error);
      setupLanguage = operatorLanguage;
    }
    if (setupLanguage) {
      loadTranslations(setupLanguage);
      applySetupText();
    }

    // Pre-install the active booking's venue WiFi as a saved profile (no switch).
    // Not awaited: it is a netsh call that has nothing to do with showing the booth.
    applyBookingWifi(state.kioskConfig).catch((e) => console.warn('[CONFIG] Booking WiFi install failed:', e.message));

    // Load camera rotation from config
    state.cameraRotation = state.kioskConfig.camera_rotation || 0;
    console.log('[RENDERER] Camera rotation from backend:', state.cameraRotation, 'degrees');

    // How many kiosk prints are allowed per photo (default 1)
    state.maxPrints = Math.max(1, parseInt(state.kioskConfig.max_prints_per_photo, 10) || 1);
    console.log('[RENDERER] Max prints per photo:', state.maxPrints);

    // Load language from config (new field from backend)
    if (state.kioskConfig.kiosk_language) {
      loadTranslations(state.kioskConfig.kiosk_language);
      console.log('[RENDERER] Loaded UI language:', state.kioskConfig.kiosk_language);
    } else {
      // Fallback to English if not provided
      loadTranslations('en');
      console.log('[RENDERER] No kiosk_language in config, defaulting to English');
    }

    // Update UI text with loaded translations
    updateUIText();

    // Show terms notice on the booth screen if enabled in config
    updateTermsNotice();

    // Load available poetry styles from config
    if (state.kioskConfig.style_configs && Array.isArray(state.kioskConfig.style_configs)) {
      // Extract poem_style from each style_config
      state.availableStyles = state.kioskConfig.style_configs.map(sc => sc.poem_style);
      console.log('[RENDERER] Loaded poetry styles:', state.availableStyles.map(s => s.name).join(', '));

      // Debug: Log action button text for each style
      console.log('[RENDERER] Action button texts:', state.availableStyles.map(s => s.action_button_text || 'MISSING').join(', '));

      // Set initial action button text from first style
      if (state.availableStyles.length > 0 && state.availableStyles[0].action_button_text) {
        if (elements.actionButtonText) {
          elements.actionButtonText.innerHTML = state.availableStyles[0].action_button_text;
          console.log('[RENDERER] Initial action button text set to:', state.availableStyles[0].action_button_text);
        }
      } else {
        console.log('[RENDERER] ⚠️ First style missing action_button_text');
      }

      // Show style hint only if multiple styles available
      if (state.availableStyles.length > 1 && elements.styleHint) {
        elements.styleHint.style.display = 'block';
      }

      // Build the coverflow of style cards
      state.currentStyleIndex = 0;
      buildStyleCoverflow();
    } else {
      console.log('[RENDERER] No poetry styles configured, using default');
      state.availableStyles = [];
    }

    updateStatus('loading', 'Initializing camera...');

    // Camera: started early (see above); wait for it and apply the rotation
    // that only became known with the config.
    await ensureCamera();
    applyCameraRotation(elements.cameraVideo);

    // Show the real capture resolution on the loading screen so a sub-par camera
    // setup is visible at a glance on the kiosk itself
    updateStatus('loading', `Starting kiosk... (camera ${formatCameraResolution()})`);
    if (state.bootStartedAt) {
      console.log(`[BOOT] page load → booth: ${Math.round(performance.now() - state.bootStartedAt)}ms`);
    }

    // Show main booth screen (showScreen fades the loading screen out itself)
    showScreen('booth');
    setupEventListeners();

    // Start periodic config polling (check every 2 minutes)
    startConfigPolling();

    // Updates are checked off the critical path; the prompt only appears
    // while the booth is idle.
    scheduleBackgroundUpdateCheck();

    // --perf-probe: log rAF rate, camera frame rate, dropped frames and long tasks
    if (flags && flags.perfProbe) startPerfProbe();

  } catch (error) {
    console.error('[RENDERER] Initialization error:', error);

    // No internet / no WiFi → guide the user to connect instead of showing
    // the red error screen. Covers both first boot offline and the case where
    // DNS resolves but the backend is unreachable.
    if (isNetworkError(error)) {
      console.log('[RENDERER] Network error during init → showing WiFi setup screen');
      if (state.screen !== 'wifi') {
        showScreen('wifi');
        await initializeWiFiSetup();
      } else {
        // Already on the WiFi screen (e.g. retry after connecting) — keep scanning
        elements.wifiStatus.textContent = t('wifi.stillOffline');
        scanForWiFiQR();
      }
      return;
    }

    // Stored credentials were rejected during startup: the main process has
    // already cleared them and sent auth:invalid, which re-runs this flow and
    // lands on the pairing screen. Don't flash the red error screen first.
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('re-pairing required') || msg.includes('not paired')) {
      console.log('[RENDERER] Credentials rejected during init → pairing flow takes over');
      return;
    }

    showError('Initialization failed', error.message, error);
  }
}

// =============================================================================
// App Lifecycle
// =============================================================================

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  state.bootStartedAt = performance.now();
  console.log('[RENDERER] DOM loaded, initializing app...');
  // Warm the poem font (only used on the result screen) so the first poem never
  // flashes in a fallback serif, then log which bundled faces are in use.
  if (document.fonts) {
    Promise.all([
      document.fonts.load('400 16px "EB Garamond"'),
      document.fonts.load('italic 400 16px "EB Garamond"'),
      document.fonts.load('600 16px Inter')
    ]).catch(() => {}).finally(() => {
      const loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.style} ${f.weight}`);
      console.log(`[FONTS] Inter ${document.fonts.check('600 16px Inter') ? 'ok' : 'MISSING'}, EB Garamond ${document.fonts.check('400 16px "EB Garamond"') ? 'ok' : 'MISSING'}; loaded: ${loaded.join('; ') || 'none'}`);
    });
  }
  console.log('[RENDERER] electronAPI available:', !!window.electronAPI);
  console.log('[RENDERER] Camera video element:', !!elements.cameraVideo);

  // Initialize loading screen Lottie animation
  initLoadingLottie();

  initializeApp();
});

// Main process reports that the stored device credentials no longer work
if (window.electronAPI.onAuthInvalid) {
  window.electronAPI.onAuthInvalid((reason) => handleAuthInvalid(reason));
}

// Generation stream events from the backend (via main) - registered once,
// routed to the handler of the generation in progress.
window.electronAPI.onGenerateEvent((evt) => {
  if (state.generateHandler) state.generateHandler(evt);
});

// Knob/button for the modal setup screens (update, language) - registered once,
// routed to whichever screen has claimed them (see claimScreenHardware).
window.electronAPI.onKnobRotate((data) => {
  if (screenHardware.knob) screenHardware.knob(data);
});
window.electronAPI.onButtonPress(() => {
  if (screenHardware.button) screenHardware.button();
});

// Handle online/offline events
window.addEventListener('online', () => {
  console.log('[RENDERER] Network online');
  updateDebugInfo();
});

window.addEventListener('offline', () => {
  console.log('[RENDERER] Network offline');
  updateDebugInfo();
});

// Prevent accidental page unload
window.addEventListener('beforeunload', (e) => {
  if (state.isProcessing) {
    e.preventDefault();
    e.returnValue = '';
  }
});

console.log('[RENDERER] Renderer initialized');
