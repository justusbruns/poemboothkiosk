// Renderer Process - Main UI Logic (using IPC bridge)

// Import translation system
import { t, loadTranslations, getCurrentLanguage } from './translations/index.js';

// State management
const state = {
  screen: 'loading',
  deviceConfig: null,
  kioskConfig: null,
  currentPhoto: null,
  currentSession: null,
  currentPrintBuffer: null, // High-resolution image buffer for printing
  currentPrintFormat: '4x6', // Paper size from API (e.g., '4x6', '4x3', '4x4', '2x6')
  currentPrintOrientation: 'portrait', // Print orientation from API ('portrait' or 'landscape')
  isProcessing: false,
  isPrinting: false, // Mutex flag to prevent duplicate print jobs
  isDev: window.location.search.includes('dev'),
  cameraStream: null,
  wifiScanInterval: null,
  currentStyleIndex: 0,
  availableStyles: [],
  printHoldStart: null,
  printHoldInterval: null,
  timerAnimationFrame: null, // 30-second auto-return timer
  lottieAnimation: null,
  loadingLottieAnimation: null,
  printerStatus: { available: false, status: 'unknown' },
  cameraRotation: 0, // Camera rotation from backend config (0, 90, 180, 270)
  installedWifiSsid: null, // SSID of the booking WiFi profile already installed (dedup)
  loadingTextInterval: null,
  loadingTextIndex: 0,
  typingTimeoutId: null,      // Current pending typing animation timeout
  typingSessionId: null,      // Unique ID for current typing session
  // Update state
  updateAvailable: false,
  updateInfo: null,
  updateSelectedOption: 'install' // 'skip' or 'install'
};

// DOM Elements
const screens = {
  loading: document.getElementById('loading-screen'),
  update: document.getElementById('update-screen'),
  wifi: document.getElementById('wifi-screen'),
  booth: document.getElementById('booth-screen'),
  processing: document.getElementById('processing-screen'),
  result: document.getElementById('result-screen'),
  error: document.getElementById('error-screen')
};

const elements = {
  loadingLottie: document.getElementById('loading-lottie'),
  boothBrand: document.getElementById('booth-brand'),
  boothBrandLogo: document.getElementById('booth-brand-logo'),
  loadingStatus: document.getElementById('loading-status'),
  wifiStatus: document.getElementById('wifi-status'),
  wifiVideo: document.getElementById('wifi-scanner-video'),
  cameraVideo: document.getElementById('camera-video'),
  cameraCanvas: document.getElementById('camera-canvas'),
  countdownOverlay: document.getElementById('countdown-overlay'),
  countdownNumber: document.querySelector('.countdown-number'),
  whiteFlash: document.getElementById('white-flash'),
  countdownLottie: document.getElementById('countdown-lottie'),
  actionButtonText: document.getElementById('action-button-text'),
  styleHint: document.getElementById('style-hint'),
  priceBadge: document.getElementById('price-badge'),
  priceAmount: document.getElementById('price-amount'),
  resultWatermark: document.getElementById('result-watermark'),
  processingPhoto: document.getElementById('processing-photo'),
  processingStatus: document.getElementById('processing-status'),
  progressFill: document.getElementById('progress-fill'),
  resultPhoto: document.getElementById('result-photo'),
  resultCamera: document.getElementById('result-camera'),
  poemText: document.getElementById('poem-text'),
  resultQr: document.getElementById('result-qr'),
  qrLabel: document.getElementById('qr-label'),
  termsNotice: document.getElementById('terms-notice'),
  termsText: document.getElementById('terms-text'),
  timerCircle: document.getElementById('timer-circle'),
  glassWipe: document.getElementById('glass-wipe'),
  qrStatus: document.getElementById('qr-status'),
  resultQrContainer: document.getElementById('result-qr-container'),
  qrInstruction: document.getElementById('qr-instruction'),
  errorMessage: document.getElementById('error-message'),
  errorDetails: document.getElementById('error-details'),
  debugPanel: document.getElementById('debug-panel'),
  debugContent: document.getElementById('debug-content'),
  lottieContainer: document.getElementById('lottie-animation'),
  notificationToast: document.getElementById('notification-toast'),
  notificationMessage: document.getElementById('notification-message'),
  loadingStatusText: document.getElementById('loading-status-text'),
  // Update screen elements
  updateTitle: document.getElementById('update-title'),
  updateVersionInfo: document.getElementById('update-version-info'),
  updateSkip: document.getElementById('update-skip'),
  updateInstall: document.getElementById('update-install'),
  updateProgress: document.getElementById('update-progress'),
  updateProgressFill: document.getElementById('update-progress-fill'),
  updateProgressText: document.getElementById('update-progress-text')
};

// =============================================================================
// Camera Service (Inline - uses browser APIs)
// =============================================================================

// Apply camera rotation - size for POST-rotation dimensions
// extraScale (optional) zooms the feed slightly, e.g. to hide blurred edges on the result background
function applyCameraRotation(videoElement, extraScale = 1) {
  const rotation = state.cameraRotation || 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  videoElement.style.position = 'absolute';
  videoElement.style.top = '50%';
  videoElement.style.left = '50%';
  videoElement.style.objectFit = 'cover';
  videoElement.style.objectPosition = 'center';
  videoElement.style.transformOrigin = 'center center';

  // KEY INSIGHT: For 90°/270°, the video element needs to be TALLER than the viewport
  // so that after rotation, its WIDTH fills the viewport height
  if (rotation === 90 || rotation === 270) {
    // Video needs to be rotated, so pre-size it for post-rotation fit
    // After 90° rotation: video width becomes visual height, video height becomes visual width
    // To fill portrait viewport (vw × vh), pre-rotation video needs:
    // - width = vh (will become height after rotation)
    // - height = vw (will become width after rotation)
    videoElement.style.width = vh + 'px';
    videoElement.style.height = vw + 'px';
    console.log(`[CAMERA] Portrait pre-rotation sizing: ${vh}×${vw}px (swapped for rotation)`);
  } else {
    // No rotation, normal viewport fill
    videoElement.style.width = vw + 'px';
    videoElement.style.height = vh + 'px';
    console.log(`[CAMERA] Landscape sizing: ${vw}×${vh}px`);
  }

  const scalePart = (extraScale && extraScale !== 1) ? ` scale(${extraScale})` : '';
  videoElement.style.transform = `translate(-50%, -50%) scaleX(-1) rotate(${rotation}deg)${scalePart}`;
}

async function initializeCamera(videoElement) {
  try {
    console.log('[CAMERA] Initializing camera...');

    // Always request landscape resolution (camera hardware is landscape)
    const constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: 'user'
      },
      audio: false
    };

    state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = state.cameraStream;

    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => resolve();
    });

    // Apply camera rotation from backend config
    applyCameraRotation(videoElement);

    console.log('[CAMERA] Camera initialized:',
      videoElement.videoWidth, 'x', videoElement.videoHeight,
      'rotation:', state.cameraRotation + '°');

    return true;
  } catch (error) {
    console.error('[CAMERA] Initialization error:', error);
    throw new Error(`Camera initialization failed: ${error.message}`);
  }
}

async function capturePhoto(videoElement, canvasElement) {
  try {
    console.log('[CAMERA] Capturing photo...');

    if (!state.cameraStream) {
      throw new Error('Camera not initialized');
    }

    const width = videoElement.videoWidth;
    const height = videoElement.videoHeight;
    const rotation = state.cameraRotation || 0;

    // Adjust canvas size based on rotation
    if (rotation === 90 || rotation === 270) {
      // Swap width/height for 90° or 270° rotation
      canvasElement.width = height;
      canvasElement.height = width;
    } else {
      canvasElement.width = width;
      canvasElement.height = height;
    }

    const ctx = canvasElement.getContext('2d');
    ctx.save();

    // Apply transformations in CORRECT order
    // 1. Move to center
    ctx.translate(canvasElement.width / 2, canvasElement.height / 2);

    // 2. Un-mirror FIRST (before rotation, so X axis is still horizontal)
    ctx.scale(-1, 1);

    // 3. THEN rotate (maintains correct mirror axis)
    ctx.rotate((rotation * Math.PI) / 180);

    // 4. Draw image centered
    ctx.drawImage(videoElement, -width / 2, -height / 2, width, height);

    ctx.restore();

    const dataURL = canvasElement.toDataURL('image/jpeg', 0.95);

    console.log('[CAMERA] Photo captured:', canvasElement.width, 'x', canvasElement.height,
                'with', rotation, '° rotation');
    return dataURL;
  } catch (error) {
    console.error('[CAMERA] Capture error:', error);
    throw error;
  }
}

// =============================================================================
// Lottie Animation Service
// =============================================================================

async function initializeLottieAnimation() {
  console.log('[LOTTIE] === FUNCTION CALLED ===');

  try {
    console.log('[LOTTIE] Starting initialization...');
    console.log('[LOTTIE] Container element:', elements.lottieContainer ? 'EXISTS' : 'NULL');
    console.log('[LOTTIE] Lottie library:', typeof lottie);

    // Destroy existing animation if present
    if (state.lottieAnimation) {
      console.log('[LOTTIE] Destroying existing animation');
      state.lottieAnimation.destroy();
      state.lottieAnimation = null;
    }

    // Check if lottie library is loaded
    if (typeof lottie === 'undefined') {
      console.error('[LOTTIE] ERROR: Lottie library not loaded!');
      throw new Error('Lottie library not available');
    }

    // Check if container exists
    if (!elements.lottieContainer) {
      console.error('[LOTTIE] ERROR: Container element not found!');
      throw new Error('Lottie container element missing');
    }

    // Fetch animation data
    console.log('[LOTTIE] Fetching animation data from ./assets/pb-animated-logo.json...');
    console.log('[LOTTIE] Current location:', window.location.href);
    console.log('[LOTTIE] Base URL:', window.location.origin);

    let response, animationData;
    try {
      response = await fetch('./assets/pb-animated-logo.json');
      console.log('[LOTTIE] Fetch response status:', response.status, response.statusText);
      console.log('[LOTTIE] Response OK:', response.ok);
      console.log('[LOTTIE] Response URL:', response.url);
      console.log('[LOTTIE] Content-Type:', response.headers.get('content-type'));

      if (!response.ok) {
        throw new Error(`Failed to fetch animation: ${response.status} ${response.statusText}`);
      }

      animationData = await response.json();
      console.log('[LOTTIE] Animation data loaded successfully, size:', JSON.stringify(animationData).length, 'chars');
      console.log('[LOTTIE] Animation version:', animationData.v);
      console.log('[LOTTIE] Animation dimensions:', animationData.w, 'x', animationData.h);
    } catch (fetchError) {
      console.error('[LOTTIE] FETCH FAILED:', fetchError.message);
      console.error('[LOTTIE] Error type:', fetchError.name);
      throw fetchError;
    }

    // Load and play animation with data
    console.log('[LOTTIE] Creating Lottie animation with CANVAS renderer (Electron compatibility)...');
    state.lottieAnimation = lottie.loadAnimation({
      container: elements.lottieContainer,
      renderer: 'canvas', // Use canvas instead of svg for Electron compatibility
      loop: true,
      autoplay: true,
      animationData: animationData,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: true,
        progressiveLoad: false,
        hideOnTransparent: true
      }
    });

    console.log('[LOTTIE] Animation object created:', !!state.lottieAnimation);

    // Defensive: restart animation if it completes while still on processing screen
    state.lottieAnimation.addEventListener('complete', () => {
      if (state.screen === 'processing' && state.lottieAnimation) {
        console.log('[LOTTIE] Animation complete but still processing - restarting');
        state.lottieAnimation.goToAndPlay(0, true);
      }
    });

    // Wait a moment for canvas to render, then verify it exists with retry logic
    await new Promise((resolve) => {
      let retryCount = 0;
      const maxRetries = 3;

      function verifyCanvas() {
        console.log('[LOTTIE] === CANVAS VERIFICATION START ===');
        const canvas = elements.lottieContainer.querySelector('canvas');
        if (canvas) {
          console.log('[LOTTIE] ✅ CANVAS FOUND!');
          console.log('[LOTTIE] Canvas width attribute:', canvas.width);
          console.log('[LOTTIE] Canvas height attribute:', canvas.height);
          console.log('[LOTTIE] Canvas computed width:', canvas.getBoundingClientRect().width);
          console.log('[LOTTIE] Canvas computed height:', canvas.getBoundingClientRect().height);
          console.log('[LOTTIE] Canvas style.display:', window.getComputedStyle(canvas).display);
          console.log('[LOTTIE] Canvas style.visibility:', window.getComputedStyle(canvas).visibility);
          console.log('[LOTTIE] Canvas style.opacity:', window.getComputedStyle(canvas).opacity);
          console.log('[LOTTIE] === CANVAS VERIFICATION END ===');
          resolve();
        } else if (retryCount < maxRetries) {
          retryCount++;
          console.warn(`[LOTTIE] Canvas not ready, retry ${retryCount}/${maxRetries}...`);
          console.log('[LOTTIE] Container innerHTML length:', elements.lottieContainer.innerHTML.length);
          setTimeout(verifyCanvas, 100);
        } else {
          console.error('[LOTTIE] ❌ Canvas failed to appear after retries');
          console.log('[LOTTIE] Container innerHTML length:', elements.lottieContainer.innerHTML.length);
          console.log('[LOTTIE] Container innerHTML preview:', elements.lottieContainer.innerHTML.substring(0, 200));
          console.log('[LOTTIE] Container computed width:', elements.lottieContainer.getBoundingClientRect().width);
          console.log('[LOTTIE] Container computed height:', elements.lottieContainer.getBoundingClientRect().height);
          console.log('[LOTTIE] === CANVAS VERIFICATION END ===');
          resolve(); // Continue anyway to not block processing
        }
      }

      setTimeout(verifyCanvas, 100);
    });

    console.log('[LOTTIE] ✅ Animation initialized and playing');
  } catch (error) {
    console.error('[LOTTIE] ❌ Initialization error:', error);
    console.error('[LOTTIE] Error stack:', error.stack);
    throw error; // Re-throw so caller knows it failed
  }
}

function destroyLottieAnimation() {
  stopLoadingTextRotation();

  // Destroy processing screen animation
  if (state.lottieAnimation) {
    console.log('[LOTTIE] Destroying processing animation...');
    state.lottieAnimation.destroy();
    state.lottieAnimation = null;
  }

  // Also destroy loading screen animation if it exists (prevent interference)
  if (state.loadingLottieAnimation) {
    console.log('[LOTTIE] Destroying loading animation...');
    state.loadingLottieAnimation.destroy();
    state.loadingLottieAnimation = null;
  }
}

// =============================================================================
// Loading Text Rotation (Processing Screen)
// =============================================================================

function startLoadingTextRotation() {
  const messages = t('processing.loadingMessages');
  if (!messages || !Array.isArray(messages)) {
    console.log('[LOADING] No loading messages found in translations');
    return;
  }

  // Start at random index
  state.loadingTextIndex = Math.floor(Math.random() * messages.length);
  updateLoadingText();

  // Rotate every 5 seconds
  state.loadingTextInterval = setInterval(() => {
    state.loadingTextIndex = (state.loadingTextIndex + 1) % messages.length;
    updateLoadingText();
  }, 5000);

  console.log('[LOADING] Started loading text rotation with', messages.length, 'messages');
}

function updateLoadingText() {
  const messages = t('processing.loadingMessages');
  if (elements.loadingStatusText && messages && Array.isArray(messages)) {
    // Trigger animation restart by removing and re-adding
    elements.loadingStatusText.style.animation = 'none';
    elements.loadingStatusText.offsetHeight; // Trigger reflow
    elements.loadingStatusText.style.animation = '';
    elements.loadingStatusText.textContent = messages[state.loadingTextIndex];
  }
}

function stopLoadingTextRotation() {
  if (state.loadingTextInterval) {
    clearInterval(state.loadingTextInterval);
    state.loadingTextInterval = null;
    console.log('[LOADING] Stopped loading text rotation');
  }
  if (elements.loadingStatusText) {
    elements.loadingStatusText.textContent = '';
  }
}

// =============================================================================
// UI Text Update (for i18n)
// =============================================================================

function updateUIText() {
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
// Update Screen Logic
// =============================================================================

/**
 * Show update screen and wait for user decision
 * @returns {Promise<boolean>} true if user wants to install, false to skip
 */
async function showUpdateScreen(currentVersion, newVersion) {
  return new Promise((resolve) => {
    // Update version info
    if (elements.updateVersionInfo) {
      elements.updateVersionInfo.textContent = `v${currentVersion} → v${newVersion}`;
    }

    // Reset selection to install
    state.updateSelectedOption = 'install';
    updateUpdateSelection();

    // Show update screen
    showScreen('update');

    // Set up hardware event listeners for update screen
    const handleKnobRotate = (data) => {
      if (state.screen !== 'update') return;

      // Toggle between skip and install
      if (data.direction === 'left') {
        state.updateSelectedOption = 'skip';
      } else {
        state.updateSelectedOption = 'install';
      }
      updateUpdateSelection();
    };

    const handleButtonPress = () => {
      if (state.screen !== 'update') return;

      // Remove listeners
      window.electronAPI.onKnobRotate(() => {});

      // Resolve based on selection
      resolve(state.updateSelectedOption === 'install');
    };

    // Listen for hardware events
    window.electronAPI.onKnobRotate(handleKnobRotate);
    window.electronAPI.onButtonPress(handleButtonPress);

    // Also handle keyboard for dev mode
    const keyHandler = (e) => {
      if (state.screen !== 'update') return;

      if (e.code === 'ArrowLeft') {
        state.updateSelectedOption = 'skip';
        updateUpdateSelection();
      } else if (e.code === 'ArrowRight') {
        state.updateSelectedOption = 'install';
        updateUpdateSelection();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        document.removeEventListener('keydown', keyHandler);
        resolve(state.updateSelectedOption === 'install');
      }
    };
    document.addEventListener('keydown', keyHandler);
  });
}

/**
 * Update visual selection on update screen
 */
function updateUpdateSelection() {
  if (elements.updateSkip && elements.updateInstall) {
    if (state.updateSelectedOption === 'skip') {
      elements.updateSkip.classList.add('selected');
      elements.updateInstall.classList.remove('selected');
    } else {
      elements.updateSkip.classList.remove('selected');
      elements.updateInstall.classList.add('selected');
    }
  }
}

/**
 * Handle update download and installation
 */
async function handleUpdateInstall() {
  // Show progress UI
  if (elements.updateProgress) {
    elements.updateProgress.style.display = 'block';
  }

  // Hide options during download
  const updateOptions = document.querySelector('.update-options');
  const updateHint = document.querySelector('.update-hint');
  if (updateOptions) updateOptions.style.display = 'none';
  if (updateHint) updateHint.style.display = 'none';

  // Update title
  if (elements.updateTitle) {
    elements.updateTitle.textContent = 'Updating...';
  }

  // Listen for download progress
  window.electronAPI.onUpdateProgress((progress) => {
    console.log('[RENDERER] Update download progress:', progress + '%');
    if (elements.updateProgressFill) {
      elements.updateProgressFill.style.width = progress + '%';
    }
    if (elements.updateProgressText) {
      elements.updateProgressText.textContent = `Downloaden... ${progress}%`;
    }
  });

  // Listen for download complete
  window.electronAPI.onUpdateDownloaded((info) => {
    console.log('[RENDERER] Update downloaded, installing...');
    if (elements.updateProgressText) {
      elements.updateProgressText.textContent = 'Installeren...';
    }

    // Small delay then install
    setTimeout(async () => {
      await window.electronAPI.updateInstall();
    }, 1000);
  });

  // Start download
  const downloadResult = await window.electronAPI.updateDownload();
  if (!downloadResult.success) {
    console.error('[RENDERER] Update download failed:', downloadResult.error);
    if (elements.updateProgressText) {
      elements.updateProgressText.textContent = 'Download mislukt: ' + downloadResult.error;
    }

    // Show retry option after 3 seconds
    setTimeout(() => {
      // Reset and allow retry or skip
      if (updateOptions) updateOptions.style.display = 'flex';
      if (updateHint) updateHint.style.display = 'block';
      if (elements.updateTitle) elements.updateTitle.textContent = 'Update Beschikbaar';
      if (elements.updateProgress) elements.updateProgress.style.display = 'none';
    }, 3000);
  }
}

// =============================================================================
// App Initialization
// =============================================================================

// Detect whether an error is caused by lack of network/internet (vs a real
// application error). Used to route to the WiFi setup screen instead of the
// red error screen. Note: errors crossing the IPC boundary lose their .code,
// so we also match on the message text.
function isNetworkError(error) {
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

async function initializeApp() {
  try {
    updateStatus('loading', 'Checking certificates...');

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

    // Check if certificates exist
    const certsExist = await window.electronAPI.certificatesExist();

    if (!certsExist) {
      throw new Error('Device certificates not found. Please provision this device first.');
    }

    updateStatus('loading', 'Loading certificates...');

    // Initialize API client (in main process)
    const initResult = await window.electronAPI.apiInitialize();
    if (!initResult.success) {
      throw new Error(`API initialization failed: ${initResult.error}`);
    }

    updateStatus('loading', 'Checking network connection...');

    // Check connectivity
    const connResult = await window.electronAPI.apiCheckConnectivity();
    if (!connResult.isOnline) {
      // Show WiFi setup screen
      showScreen('wifi');
      await initializeWiFiSetup();
      return;
    }

    updateStatus('loading', 'Registering device...');

    // Register device
    const deviceData = await window.electronAPI.apiRegisterDevice();
    state.deviceConfig = deviceData.device;

    updateStatus('loading', 'Fetching configuration...');

    // Get kiosk configuration
    state.kioskConfig = await window.electronAPI.apiGetConfig();

    // Pre-install the active booking's venue WiFi as a saved profile (no switch)
    await applyBookingWifi(state.kioskConfig);

    // Check for updates before proceeding
    updateStatus('loading', 'Checking for updates...');
    const updateResult = await window.electronAPI.updateCheck();

    if (updateResult.available && updateResult.info) {
      console.log('[RENDERER] Update available:', updateResult.info.version);
      state.updateAvailable = true;
      state.updateInfo = updateResult.info;

      // Show update screen and wait for user decision
      const shouldUpdate = await showUpdateScreen(updateResult.currentVersion, updateResult.info.version);

      if (shouldUpdate) {
        // User chose to install - download and install
        await handleUpdateInstall();
        return; // App will restart after install
      } else {
        // User chose to skip
        console.log('[RENDERER] User skipped update, continuing...');
        await window.electronAPI.updateSkip();
      }
    } else {
      console.log('[RENDERER] No update available, current version:', updateResult.currentVersion);
    }

    // Load camera rotation from config
    state.cameraRotation = state.kioskConfig.camera_rotation || 0;
    console.log('[RENDERER] Camera rotation from backend:', state.cameraRotation, 'degrees');

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

    // Initialize camera
    await initializeCamera(elements.cameraVideo);

    updateStatus('loading', 'Starting kiosk...');

    // Show main booth screen
    setTimeout(() => {
      showScreen('booth');
      setupEventListeners();

      // Start periodic config polling (check every 2 minutes)
      startConfigPolling();
    }, 1000);

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
        elements.wifiStatus.textContent = 'Still no internet — hold your WiFi QR code in front of the camera';
        scanForWiFiQR();
      }
      return;
    }

    showError('Initialization failed', error.message, error);
  }
}

// =============================================================================
// WiFi Setup
// =============================================================================

// Install the active booking's venue WiFi (from backend config) as a saved
// Windows profile so the device can auto-connect to it later when in range.
// This does NOT switch the active connection mid-session — it only pre-loads
// the network. No-op when the booking has no WiFi configured or it was already
// installed this session.
async function applyBookingWifi(config) {
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

async function initializeWiFiSetup() {
  try {
    elements.wifiStatus.textContent = 'Waiting for your WiFi QR code...';

    // Make re-entry safe: stop any previous scan loop and camera stream first.
    // Without this, the --force-wifi retry loop (and production reconnect
    // retries) would open a NEW camera stream on every pass while leaking the
    // old ones, progressively starving the camera until QR detection silently
    // stops working — which looks like "scanning got worse over time".
    if (state.wifiScanInterval) {
      clearTimeout(state.wifiScanInterval);
      state.wifiScanInterval = null;
    }
    if (elements.wifiVideo.srcObject) {
      elements.wifiVideo.srcObject.getTracks().forEach(track => track.stop());
      elements.wifiVideo.srcObject = null;
    }

    // Start camera for QR scanning
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

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

function scanForWiFiQR() {
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

async function handleWiFiQRDetected(qrData) {
  // Stop scanning
  if (state.wifiScanInterval) {
    clearTimeout(state.wifiScanInterval);
  }

  elements.wifiStatus.textContent = 'QR code detected! Connecting...';

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

    elements.wifiStatus.textContent = 'Connected! Registering device...';

    // Release the QR-scanning camera before continuing so it doesn't stay
    // open behind the booth camera.
    if (elements.wifiVideo.srcObject) {
      elements.wifiVideo.srcObject.getTracks().forEach(track => track.stop());
      elements.wifiVideo.srcObject = null;
    }

    // Restart initialization now that we have connectivity
    await initializeApp();

  } catch (error) {
    console.error('[WIFI] Connection error:', error);
    elements.wifiStatus.textContent = `Connection failed: ${error.message}`;

    // Restart scanning after 3 seconds
    setTimeout(() => {
      elements.wifiStatus.textContent = 'Waiting for your WiFi QR code...';
      scanForWiFiQR();
    }, 3000);
  }
}

function parseWiFiQR(qrData) {
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

// =============================================================================
// Hardware Event Listeners
// =============================================================================

function setupEventListeners() {
  console.log('[RENDERER] Setting up hardware event listeners...');

  // PRODUCTION-READY: Forward ALL Space/Enter/Arrow key events to main process via IPC
  // This works in both dev and production for Pico USB HID button and rotary encoder
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      console.log('[RENDERER] Forwarding keydown to main:', e.code);
      window.electronAPI.sendKeyEvent('keydown', e.code, e.key);
    }
  }, true); // Use capture phase to catch before other handlers

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      console.log('[RENDERER] Forwarding keyup to main:', e.code);
      window.electronAPI.sendKeyEvent('keyup', e.code, e.key);
    }
  }, true);

  console.log('[RENDERER] ✓ Key event forwarders attached');

  // Hardware button press - capture photo (booth screen) or start print hold (result screen)
  window.electronAPI.onButtonPress(() => {
    console.log('[HARDWARE] Button press event received, screen:', state.screen, 'processing:', state.isProcessing, 'printing:', state.isPrinting);

    // Dismiss notification if visible
    if (elements.notificationToast.style.display === 'block') {
      dismissNotification();
    }

    if (state.screen === 'booth' && !state.isProcessing) {
      console.log('[HARDWARE] Calling handleCapture()...');
      handleCapture();
    } else if (state.screen === 'result' && !state.isProcessing) {
      // Result screen: the physical button returns to booth for the next guest.
      // Printing is done from the guest's phone via the QR code, not on the kiosk.
      console.log('[HARDWARE] Button on result screen - returning to booth');
      cancel30SecondTimer();
      triggerGlassWipe();
    } else {
      console.log('[HARDWARE] Ignoring button press - wrong screen or already processing');
    }
  });

  // Hardware button release - retry from error screen
  // (Result-screen return-to-booth is handled on button PRESS now; printing moved to the phone.)
  window.electronAPI.onButtonRelease((data) => {
    console.log('[HARDWARE] Button release event received:', data);

    // Small delay to avoid race conditions with screen transitions
    setTimeout(() => {
      if (state.screen === 'error') {
        // Retry from error screen
        showScreen('booth');
      }
    }, 100);
  });

  // Hardware long press event (from MockHardwareService after 2s hold)
  // NOTE: Print hold is now driven by buttonPress/buttonRelease for instant visual feedback
  // This handler is kept for logging and potential future use
  window.electronAPI.onLongPress(() => {
    console.log('[HARDWARE] Long press event received (print hold should already be in progress via buttonPress)');
    // Print hold is managed by buttonPress handler - this event just confirms the hold completed
    if (state.printHoldStart) {
      console.log('[HARDWARE] Print hold already active - timing managed by renderer');
    }
  });

  // Hardware knob rotation - cycle through poetry styles
  window.electronAPI.onKnobRotate((data) => {
    console.log('[HARDWARE] Knob rotate event received:', data);
    if (state.screen === 'booth' && !state.isProcessing && state.availableStyles.length > 0) {
      handleStyleChange(data.direction);
    }
  });

  // Printer status changes
  window.electronAPI.onPrinterStatusChange((status) => {
    console.log('[PRINTER] Status change received:', status);
    updatePrinterStatus(status);
  });

  // Get initial printer status with retry for race condition protection
  async function getInitialPrinterStatus(retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
      const status = await window.electronAPI.printerGetStatus();
      if (status.status !== 'not_initialized') {
        return status;
      }
      console.log(`[PRINTER] Status not_initialized, retry ${i + 1}/${retries}...`);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return { available: false, status: 'not_initialized', printerName: 'Unknown' };
  }

  getInitialPrinterStatus().then((status) => {
    console.log('[PRINTER] Initial status:', status);
    updatePrinterStatus(status);
  }).catch((error) => {
    console.error('[PRINTER] Failed to get initial status:', error);
  });

  // Debug panel (dev mode)
  if (state.isDev) {
    elements.debugPanel.style.display = 'block';
    document.body.style.cursor = 'auto';

    document.getElementById('quit-app').addEventListener('click', async () => {
      await window.electronAPI.quitApp();
    });

    updateDebugInfo();
    setInterval(updateDebugInfo, 5000);

    // Keyboard controls for dev mode
    document.addEventListener('keydown', (e) => {
      // ALWAYS prevent default for Enter to avoid form submission
      if (e.code === 'Enter') {
        e.preventDefault();
      }

      // Spacebar OR Enter - capture photo (booth screen)
      // Enter is for physical button from Pico
      if ((e.code === 'Space' || e.code === 'Enter') && state.screen === 'booth' && !state.isProcessing) {
        e.preventDefault();
        console.log('[HARDWARE] Enter/Space detected on booth screen, calling handleCapture()');
        handleCapture();
      }

      // Enter (physical button) on result screen - return to booth for the next guest
      if (e.code === 'Enter' && state.screen === 'result' && !e.repeat) {
        e.preventDefault();
        console.log('[HARDWARE] Enter on result screen - returning to booth');
        cancel30SecondTimer();
        triggerGlassWipe();
      }

      // Arrow keys - change style (booth screen)
      if (state.screen === 'booth' && !state.isProcessing) {
        if (e.code === 'ArrowRight') {
          e.preventDefault();
          handleStyleChange('clockwise');
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          handleStyleChange('counter-clockwise');
        }
      }

      // 'R' key - return to booth from result screen
      if (e.code === 'KeyR' && state.screen === 'result') {
        e.preventDefault();
        triggerGlassWipe();
      }
    });

  }
}

// Carousel turning timeout for fade-out of adjacent options
let turningTimeout = null;

// Handle style selection with knob rotation (coverflow-style carousel)
function handleStyleChange(direction) {
  if (state.availableStyles.length === 0) return;

  // Calculate new index
  if (direction === 'clockwise') {
    state.currentStyleIndex = (state.currentStyleIndex + 1) % state.availableStyles.length;
  } else {
    state.currentStyleIndex = (state.currentStyleIndex - 1 + state.availableStyles.length) % state.availableStyles.length;
  }

  const currentStyle = state.availableStyles[state.currentStyleIndex];
  console.log('[STYLE] Selected:', currentStyle.name, `(${state.currentStyleIndex + 1}/${state.availableStyles.length})`);

  // Reposition the coverflow + update the style name label (CSS transitions animate the move)
  positionStyleCoverflow();
  updateActionLabel();
  updateDebugInfo();
}

// Build the coverflow cards from the available styles.
// Image styles show their example output image; poem styles show a "record sleeve" name card.
function buildStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (!cf) return;
  cf.innerHTML = '';

  state.availableStyles.forEach((style) => {
    const card = document.createElement('div');
    card.className = 'style-card';

    const outUrl = style && style.example_output_image_url;
    if (outUrl) {
      const img = document.createElement('img');
      img.src = outUrl;
      img.alt = style.name || '';
      // If the image fails to load, fall back to a name card
      img.onerror = () => makePoemCard(card, style);
      card.appendChild(img);
    } else {
      makePoemCard(card, style);
    }

    cf.appendChild(card);
  });

  positionStyleCoverflow();
  updateActionLabel();
}

// Turn a card into a poem "record sleeve" with the poet/style name
function makePoemCard(card, style) {
  card.classList.add('style-card-poem');
  card.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'poet-name';
  name.textContent = (style && (style.name || style.action_button_text)) || '';
  card.appendChild(name);
}

// Position each card in the coverflow based on its circular distance from the current style
function positionStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (!cf) return;
  const cards = cf.children;
  const N = state.availableStyles.length;

  for (let i = 0; i < cards.length; i++) {
    let o = i - state.currentStyleIndex;
    if (N > 0) {
      // shortest way around the ring so neighbours appear on both sides
      if (o > N / 2) o -= N;
      if (o < -N / 2) o += N;
    }
    const ao = Math.abs(o);
    const dir = Math.sign(o); // -1 = left, +1 = right

    // 3D cover-flow: side cards sit closer together and tilt inward toward the centre,
    // so many more styles fit on screen at once.
    let x, angle, scale, opacity, z;
    if (ao === 0)      { x = 0;   angle = 0;  scale = 1.0;  opacity = 1;    z = 30; }
    else if (ao === 1) { x = 92;  angle = 45; scale = 0.82; opacity = 0.85; z = 20; }
    else if (ao === 2) { x = 150; angle = 52; scale = 0.66; opacity = 0.5;  z = 12; }
    else if (ao === 3) { x = 196; angle = 55; scale = 0.55; opacity = 0.28; z = 6; }
    else               { x = 236; angle = 55; scale = 0.5;  opacity = 0;    z = 0; }

    const tx = dir * x;
    const rotY = -dir * angle; // left cards face right, right cards face left

    const card = cards[i];
    card.style.transform = `translateX(${tx}px) rotateY(${rotY}deg) scale(${scale})`;
    card.style.opacity = String(opacity);
    card.style.zIndex = String(z);
  }
}

// Update the call-to-action under the coverflow based on how many styles there are
function updateActionLabel() {
  // The small "turn the knob" hint only appears when there's more than one style
  if (elements.styleHint) {
    elements.styleHint.textContent = t('booth.turnKnob');
    elements.styleHint.style.display = state.availableStyles.length > 1 ? 'block' : 'none';
  }
}

// Rotating hero CTA — cycles through inspiring phrases to invite people to use the booth
let ctaRotationInterval = null;
let ctaPhraseIndex = 0;

function getCtaPhrases() {
  const phrases = [t('booth.cta1')];
  // "Trying is Free" only makes sense when guests actually have to pay
  if (isPaymentActive()) phrases.push(t('booth.cta2'));
  phrases.push(t('booth.cta3'));
  return phrases;
}

function renderCtaPhrase() {
  if (!elements.actionButtonText) return;
  const phrases = getCtaPhrases();
  elements.actionButtonText.innerHTML = phrases[ctaPhraseIndex % phrases.length];
  // Re-trigger the slide-in animation every time the phrase changes
  elements.actionButtonText.style.animation = 'none';
  void elements.actionButtonText.offsetWidth; // reflow so the animation restarts
  elements.actionButtonText.style.animation = 'ctaSlideIn 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
}

function startCtaRotation() {
  stopCtaRotation();
  ctaPhraseIndex = 0;
  if (elements.actionButtonText) elements.actionButtonText.style.opacity = '1';
  renderCtaPhrase();
  ctaRotationInterval = setInterval(() => {
    // Skip while capturing or off the booth screen so we don't fight the fade-out
    if (!elements.actionButtonText || state.isProcessing || state.screen !== 'booth') return;
    ctaPhraseIndex = (ctaPhraseIndex + 1) % getCtaPhrases().length;
    renderCtaPhrase();
  }, 2800);
}

function stopCtaRotation() {
  if (ctaRotationInterval) { clearInterval(ctaRotationInterval); ctaRotationInterval = null; }
}

// On capture: the selected card rushes toward the viewer, then the countdown begins.
function flyOutSelectedCard() {
  return new Promise((resolve) => {
    const cf = document.getElementById('style-coverflow');
    if (!cf || !cf.children.length) { resolve(); return; }
    const cards = cf.children;

    // Fade out the surrounding cards and the labels
    for (let i = 0; i < cards.length; i++) {
      if (i !== state.currentStyleIndex) {
        cards[i].style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        cards[i].style.opacity = '0';
      }
    }
    if (elements.styleHint) elements.styleHint.style.opacity = '0';
    if (elements.actionButtonText) elements.actionButtonText.style.opacity = '0';
    if (elements.termsNotice) {
      elements.termsNotice.style.transition = 'opacity 0.3s ease';
      elements.termsNotice.style.opacity = '0';
    }

    // Hide the pulsating circles for the countdown
    const pulse = document.querySelector('.pulsating-circles');
    if (pulse) {
      pulse.style.transition = 'opacity 0.3s ease';
      pulse.style.opacity = '0';
    }

    // Fade out the price badge with the coverflow
    if (elements.priceBadge) {
      elements.priceBadge.style.transition = 'opacity 0.3s ease';
      elements.priceBadge.style.opacity = '0';
    }

    // The selected card flies toward the viewer and fades out
    const center = cards[state.currentStyleIndex];
    if (center) {
      center.style.transition = 'transform 0.7s cubic-bezier(0.5, 0, 0.75, 0), opacity 0.7s ease';
      center.style.transform = 'translateX(0) rotateY(0deg) scale(2.8)';
      center.style.opacity = '0';
      center.style.zIndex = '40';
    }

    setTimeout(resolve, 600);
  });
}

// Restore the coverflow to its resting state after returning to the booth
function resetStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (cf && cf.children.length) {
    const cards = cf.children;
    for (let i = 0; i < cards.length; i++) cards[i].style.transition = 'none';
    positionStyleCoverflow();
    void cf.offsetWidth; // reflow so the snap-back isn't animated
    for (let i = 0; i < cards.length; i++) cards[i].style.transition = '';
  }
  if (elements.styleHint) elements.styleHint.style.opacity = '';
  if (elements.actionButtonText) elements.actionButtonText.style.opacity = '';
  const pulse = document.querySelector('.pulsating-circles');
  if (pulse) pulse.style.opacity = '';
  if (elements.priceBadge) elements.priceBadge.style.opacity = '';
  if (elements.termsNotice) elements.termsNotice.style.opacity = '';
  updateActionLabel();
  startCtaRotation();
}

// =============================================================================
// Photo Capture Flow
// =============================================================================

// Cache of the raw countdown animation data (loaded once, text localized per play)
let countdownBaseData = null;

function loadJsonXHR(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'json';
    xhr.onload = () => {
      // file:// returns status 0 on success
      if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
      else reject(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = () => reject(new Error('XHR error loading ' + url));
    xhr.send();
  });
}

// Load the countdown animation and swap its baked text layers for the active language
async function getLocalizedCountdownData() {
  if (!countdownBaseData) {
    countdownBaseData = await loadJsonXHR('./assets/pb_countdown.json');
  }
  const data = JSON.parse(JSON.stringify(countdownBaseData)); // clone so the cached base stays clean
  const map = {
    txt_look: t('countdown.look'),
    txt_ready: t('countdown.ready'),
    txt_pose: t('countdown.pose'),
    txt_smile: t('countdown.smile')
  };
  (data.layers || []).forEach((layer) => {
    if (layer.ty === 5 && map[layer.nm] != null) {
      try { layer.t.d.k[0].s.t = map[layer.nm]; } catch (e) { /* keep baked text on failure */ }
    }
  });
  return data;
}

// Play the countdown Lottie over the live camera and capture the photo during its flash.
// The animation is 1080x1920 (9:16), 30fps, 276 frames (9.2s, 5-4-3-2-1); the flash reaches
// full white at frame 269, which is exactly when we grab the camera frame.
async function playCountdownAndCapture() {
  const CAPTURE_FRAME = 269;
  const container = elements.countdownLottie;

  let animData = null;
  try { animData = await getLocalizedCountdownData(); }
  catch (e) { console.error('[RENDERER] Could not load countdown animation:', e); }

  return new Promise((resolve) => {
    // Fallback: if the animation can't run, just capture immediately
    if (!container || typeof lottie === 'undefined' || !animData) {
      capturePhoto(elements.cameraVideo, elements.cameraCanvas)
        .then((url) => { state.currentPhoto = url; })
        .catch((e) => console.error('[RENDERER] Fallback capture failed:', e))
        .finally(resolve);
      return;
    }

    container.innerHTML = '';
    container.style.display = 'block';

    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      animationData: animData,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice' }
    });

    let captureStarted = false;
    let capturePromise = Promise.resolve();

    const doCapture = () => {
      captureStarted = true;
      console.log('[RENDERER] Countdown flash reached — capturing photo');
      capturePromise = capturePhoto(elements.cameraVideo, elements.cameraCanvas)
        .then((url) => { state.currentPhoto = url; })
        .catch((e) => console.error('[RENDERER] Capture during flash failed:', e));
    };

    anim.addEventListener('enterFrame', (e) => {
      if (!captureStarted && e.currentTime >= CAPTURE_FRAME) doCapture();
    });

    const finish = async () => {
      if (!captureStarted) doCapture();   // safety net if we never hit the frame event
      try { await capturePromise; } catch (e) {}
      try { anim.destroy(); } catch (e) {}
      container.style.display = 'none';
      container.innerHTML = '';
      resolve();
    };

    anim.addEventListener('complete', finish);
    anim.addEventListener('data_failed', () => {
      console.error('[RENDERER] Countdown animation failed to load');
      finish();
    });
  });
}

async function handleCapture() {
  console.log('[RENDERER] handleCapture() called, isProcessing:', state.isProcessing);

  if (state.isProcessing) {
    console.log('[RENDERER] Already processing, ignoring capture request');
    return;
  }
  state.isProcessing = true;

  try {
    // Selected style card flies toward the viewer before the countdown
    console.log('[RENDERER] Flying out selected style card...');
    await flyOutSelectedCard();

    // Play the new countdown animation over the live camera; it captures the photo during its flash
    console.log('[RENDERER] Playing countdown animation...');
    await playCountdownAndCapture();
    console.log('[RENDERER] Photo captured during flash, length:', state.currentPhoto ? state.currentPhoto.length : 0);

    // Auto-proceed to processing (no confirmation needed)
    console.log('[RENDERER] Proceeding automatically to processPhoto()...');
    await processPhoto();

  } catch (error) {
    console.error('[RENDERER] Capture error:', error);
    if (elements.countdownLottie) {
      elements.countdownLottie.style.display = 'none';
      elements.countdownLottie.innerHTML = '';
    }
    if (elements.whiteFlash) elements.whiteFlash.style.display = 'none';
    state.isProcessing = false;
    showError('Capture failed', error.message, error);
  }
}

async function processPhoto() {
  try {
    // Cancel any in-progress typing animation from previous session
    cancelTypingAnimation();

    // Validate we have a photo
    if (!state.currentPhoto) {
      console.error('[RENDERER] ERROR: No photo captured! Cannot generate content.');
      throw new Error('No photo captured');
    }

    console.log('[RENDERER] Processing photo, length:', state.currentPhoto.length);

    // Show processing screen with captured photo
    showScreen('processing');

    // Display the captured photo full-screen
    elements.processingPhoto.src = state.currentPhoto;

    // Start loading text rotation
    startLoadingTextRotation();

    // Initialize and play Lottie animation
    console.log('[RENDERER] About to call initializeLottieAnimation()');
    try {
      await initializeLottieAnimation();
      console.log('[RENDERER] Lottie animation initialization complete');
    } catch (lottieError) {
      console.error('[RENDERER] Lottie animation failed:', lottieError);
      // Continue even if animation fails
    }

    updateProgress('Sending photo to AI...', 10);

    // Get selected style (if available)
    const selectedStyle = state.availableStyles.length > 0
      ? state.availableStyles[state.currentStyleIndex]
      : null;

    const metadata = {
      equipment_id: state.deviceConfig.equipment_id,
      hub_id: state.deviceConfig.hub_id
    };

    // Include style in metadata if selected
    if (selectedStyle) {
      metadata.style = selectedStyle.id || selectedStyle.name;
      console.log('[RENDERER] Using selected style:', selectedStyle.name);
    }

    // Call unified API to generate content (via main process)
    console.log('[RENDERER] Calling API to generate content...');
    const response = await window.electronAPI.apiGenerateContent(
      state.currentPhoto,
      metadata
    );

    // Detect content type from response
    const generationType = response.generation_type || 'poem';
    console.log('[RENDERER] Generation type:', generationType);

    // Dispatch to appropriate handler based on content type
    if (generationType === 'image') {
      await processImageGeneration(response);
    } else if (generationType === 'poem') {
      await processPoemGeneration(response);
    } else {
      console.error('[RENDERER] Unknown generation type:', generationType);
      throw new Error(`Unsupported content type: ${generationType}`);
    }

  } catch (error) {
    console.error('[RENDERER] Process error:', error);
    state.isProcessing = false;  // Explicit reset on error
    destroyLottieAnimation();    // Clean up animation
    showNotification(t('error.processingFailed'));
  }
}

// Process poem generation response
async function processPoemGeneration(response) {
  try {
    // Extract poem data from response
    state.currentSession = response.session || { id: response.session_id };
    const sessionId = response.session_id || response.session?.id;
    const poemText = response.poem?.text || response.poem;
    const brandingConfig = response.branding_config || response.branding || state.kioskConfig?.branding;

    // Validate poem data
    if (!poemText) {
      throw new Error('No poem text received from backend');
    }

    // Extract branding template from config (API returns nested structure)
    const brandingTemplate = brandingConfig?.template || brandingConfig;

    // Extract print config from API response
    state.currentPrintFormat = brandingTemplate?.print_format || '4x6';
    state.currentPrintOrientation = brandingTemplate?.print_orientation || 'portrait';

    console.log('[RENDERER] Poem generated, session ID:', sessionId);
    console.log('[RENDERER] Poem text length:', poemText.length, 'chars');
    console.log('[RENDERER] Print format:', state.currentPrintFormat, 'orientation:', state.currentPrintOrientation);
    console.log('[RENDERER] Template output:', brandingTemplate?.output_width, 'x', brandingTemplate?.output_height, '@', brandingTemplate?.output_dpi, 'DPI');

    // Show poem text immediately with typing effect
    showPoemWithTypingEffect(poemText);

    updateProgress('Creating artwork...', 60);

    // === STEP 1: Render HIGH-QUALITY image for printing (300 DPI metadata) ===
    const printImageBuffer = await window.electronAPI.renderPoemImage(
      state.currentPhoto,
      { text: poemText },
      brandingTemplate,
      { quality: 'hd' }
    );

    state.currentPrintBuffer = printImageBuffer;
    console.log('[RENDERER] ✅ Print buffer created:', printImageBuffer.length, 'bytes',
                '(' + (printImageBuffer.length / 1024 / 1024).toFixed(2) + ' MB)');

    updateProgress('Optimizing for web...', 70);

    // === STEP 2: Render image for backend upload (template DPI metadata) ===
    const webImageBuffer = await window.electronAPI.renderPoemImage(
      state.currentPhoto,
      { text: poemText },
      brandingTemplate,
      { quality: 'standard' }
    );

    console.log('[RENDERER] ✅ Web buffer created:', webImageBuffer.length, 'bytes',
                '(' + (webImageBuffer.length / 1024 / 1024).toFixed(2) + ' MB)');

    updateProgress('Uploading image...', 80);

    // Get quality from branding config
    const quality = brandingConfig?.quality || 'standard';

    // Upload web-optimized image to backend (via main process)
    const uploadResponse = await window.electronAPI.apiUploadImage(
      webImageBuffer,
      sessionId,
      quality
    );

    updateProgress('Complete!', 100);

    // Reset processing state IMMEDIATELY (not inside setTimeout)
    // This prevents race conditions where state remains true after function "completes"
    state.isProcessing = false;

    // Show QR code with slight delay for visual effect
    setTimeout(() => {
      showQRCode(uploadResponse.public_view_url || uploadResponse.public_url);
    }, 500);

  } catch (error) {
    console.error('[RENDERER] Poem processing error:', error);
    state.isProcessing = false;  // Explicit reset on error
    destroyLottieAnimation();    // Clean up animation
    showNotification(t('error.generationFailed'));
    return; // Don't re-throw, gracefully handle
  }
}

// Process image generation response
async function processImageGeneration(response) {
  try {
    // Extract image data from response
    state.currentSession = response.session || { id: response.session_id };
    const sessionId = response.session_id || response.session?.id;
    const generatedImage = response.generated_image;
    const imageType = response.generated_image_type || 'image/png';

    // Extract print config for image styles
    const printConfig = response.print_config || {};
    state.currentPrintFormat = printConfig.paper_size || '4x3';
    // Derive orientation from aspect ratio if not explicitly provided
    const aspectRatio = printConfig.aspect_ratio || '2:3';
    const [w, h] = aspectRatio.split(':').map(Number);
    state.currentPrintOrientation = (w > h) ? 'landscape' : 'portrait';

    console.log('[RENDERER] AI image generated, session ID:', sessionId);
    console.log('[RENDERER] Response keys:', Object.keys(response));
    console.log('[RENDERER] Has generated_image:', !!generatedImage);
    console.log('[RENDERER] Has storage_url:', !!response.storage_url);
    console.log('[RENDERER] Has rendered_image_url:', !!response.rendered_image_url);
    console.log('[RENDERER] Print format:', state.currentPrintFormat, 'orientation:', state.currentPrintOrientation);

    // Handle two scenarios:
    // 1. Backend returns image data directly (generated_image field)
    // 2. Backend generates and uploads image, returns URL only
    let imageDataUrl;
    let imageBuffer;

    if (generatedImage) {
      // Scenario 1: Backend returned base64 image data
      console.log('[RENDERER] Using generated_image from response');

      // Convert base64 to data URL
      imageDataUrl = `data:${imageType};base64,${generatedImage}`;

      // Convert base64 to ArrayBuffer (browser-compatible)
      const binaryString = atob(generatedImage);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      imageBuffer = bytes.buffer;

      console.log('[RENDERER] ✅ Image buffer created:', bytes.length, 'bytes',
                  '(' + (bytes.length / 1024 / 1024).toFixed(2) + ' MB)');
    } else if (response.storage_url || response.rendered_image_url) {
      // Scenario 2: Backend uploaded image, only URL provided
      const imageUrl = response.storage_url || response.rendered_image_url;
      console.log('[RENDERER] Fetching image from URL:', imageUrl);

      updateProgress('Downloading image...', 50);

      try {
        // Fetch the image from the URL
        const fetchResponse = await fetch(imageUrl);
        if (!fetchResponse.ok) {
          throw new Error(`Failed to fetch image: ${fetchResponse.status}`);
        }

        const blob = await fetchResponse.blob();
        imageBuffer = await blob.arrayBuffer();

        // Convert to data URL for display
        imageDataUrl = URL.createObjectURL(blob);

        console.log('[RENDERER] ✅ Image fetched from URL:', imageBuffer.byteLength, 'bytes',
                    '(' + (imageBuffer.byteLength / 1024 / 1024).toFixed(2) + ' MB)');
      } catch (fetchError) {
        console.error('[RENDERER] Failed to fetch image from URL:', fetchError);
        throw new Error(`Could not download image: ${fetchError.message}`);
      }
    } else {
      // No image data or URL provided
      console.error('[RENDERER] Response missing both generated_image and storage_url');
      throw new Error('No image data or URL received from backend');
    }

    updateProgress('Preparing image...', 60);

    // Store for printing (print directly, no re-rendering)
    state.currentPrintBuffer = imageBuffer;

    // Destroy loading animation
    destroyLottieAnimation();

    // Show result screen FIRST before setting image sources
    showScreen('result');

    // Display image in result screen (reuse poem display layout)
    // Clear any poem text
    if (elements.poemText) {
      elements.poemText.textContent = '';
      elements.poemText.classList.remove('typing-complete');
    }

    // For AI-generated images, swap the black background for the live blurred camera feed
    if (elements.resultPhoto) {
      elements.resultPhoto.src = '';
      elements.resultPhoto.style.display = 'none';
    }
    showResultCameraBackground();

    // Display centered image on result overlay
    // Show the image in the poem text area, but as an <img> instead of text
    if (elements.poemText) {
      // Add centering class to overlay
      const poemOverlay = elements.poemText.parentElement;
      if (poemOverlay) {
        poemOverlay.classList.add('image-display');
      }
      elements.poemText.innerHTML = ''; // Clear text

      // Wrap the image so the watermark can be clipped to the image bounds
      const wrap = document.createElement('div');
      wrap.className = 'result-image-wrap';
      const imageElement = document.createElement('img');
      imageElement.src = imageDataUrl;
      imageElement.alt = '';
      wrap.appendChild(imageElement);
      // The watermark lives inside the wrap so overflow:hidden trims anything past the image
      if (elements.resultWatermark) wrap.appendChild(elements.resultWatermark);
      elements.poemText.appendChild(wrap);

      // Apply paid-mode extras (watermark) now that it sits inside the image wrap
      updateResultPaymentUI();

      // Hide blinking cursor for image generation (cursor is for poem typing effect)
      elements.poemText.classList.add('typing-complete');
    }

    // Adapt the QR label to the printer state (print & save vs save)
    updateResultActionLabel();

    // If image was already uploaded by backend, skip upload step
    if (response.storage_url || response.rendered_image_url) {
      console.log('[RENDERER] Image already uploaded by backend, skipping upload');
      updateProgress('Complete!', 100);

      // Reset processing state IMMEDIATELY (not inside setTimeout)
      state.isProcessing = false;

      // Show QR code with slight delay for visual effect
      setTimeout(() => {
        showQRCode(response.public_view_url || response.public_url);
      }, 500);
    } else {
      // Upload AI-generated image if not already uploaded
      updateProgress('Uploading image...', 80);

      const quality = state.kioskConfig?.branding?.quality || 'standard';
      const uploadResponse = await window.electronAPI.apiUploadImage(
        imageBuffer,
        sessionId,
        quality
      );

      updateProgress('Complete!', 100);

      // Reset processing state IMMEDIATELY (not inside setTimeout)
      state.isProcessing = false;

      // Show QR code with slight delay for visual effect
      setTimeout(() => {
        showQRCode(uploadResponse.public_view_url || uploadResponse.public_url);
      }, 500);
    }

  } catch (error) {
    console.error('[RENDERER] Image processing error:', error);
    state.isProcessing = false;  // Explicit reset on error
    destroyLottieAnimation();    // Clean up animation
    showNotification(t('error.generationFailed'));
    return; // Don't re-throw, gracefully handle
  }
}

// =============================================================================
// Result Display
// =============================================================================

/**
 * Calculate optimal font size that fits text within container
 * Uses container dimensions and iteratively finds the largest font size that fits
 * Ensures text never overflows by measuring actual available space
 *
 * @param {string} poemText - The poem text to analyze
 * @returns {string} - Font size in px (e.g., "24px")
 */
function calculatePoemFontSize(poemText) {
  // Get container dimensions
  const container = document.querySelector('.poem-overlay');
  if (!container) {
    console.warn('[RENDERER] Poem container not found, using fallback size');
    return '20px';
  }

  // Get available space (subtract padding)
  const containerHeight = container.clientHeight;
  const containerWidth = container.clientWidth;
  const computedStyle = window.getComputedStyle(container);
  const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
  const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(computedStyle.paddingRight) || 0;

  const availableHeight = containerHeight - paddingTop - paddingBottom;
  const availableWidth = containerWidth - paddingLeft - paddingRight;

  console.log(`[RENDERER] Container dimensions: ${containerWidth}x${containerHeight}px`);
  console.log(`[RENDERER] Available space: ${availableWidth}x${availableHeight}px`);

  // Constants
  const LINE_HEIGHT = 1.6; // Match CSS line-height
  const START_FONT_SIZE = 40; // Start at 40px and work down (increased for better visibility)
  const MIN_FONT_SIZE = 18; // Minimum readable size (increased)
  const AVG_CHAR_WIDTH_RATIO = 0.6; // Approximate character width

  // Try different font sizes, starting large and working down
  let fontSize = START_FONT_SIZE;
  let bestFit = MIN_FONT_SIZE;

  while (fontSize >= MIN_FONT_SIZE) {
    // Calculate approximate characters per line at this font size
    const charWidth = fontSize * AVG_CHAR_WIDTH_RATIO;
    const maxCharsPerLine = Math.floor(availableWidth / charWidth);

    // Word-wrap the text
    const lines = poemText.split('\n');
    const wrappedLines = [];

    for (const line of lines) {
      if (line.trim() === '') {
        wrappedLines.push('');
        continue;
      }

      const words = line.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        if (testLine.length > maxCharsPerLine && currentLine) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        wrappedLines.push(currentLine);
      }
    }

    // Calculate total height needed
    const lineSpacing = fontSize * LINE_HEIGHT;
    const totalHeight = wrappedLines.length * lineSpacing;

    console.log(`[RENDERER] Testing ${fontSize}px: ${wrappedLines.length} lines, ${totalHeight.toFixed(0)}px height (available: ${availableHeight}px)`);

    // Check if it fits
    if (totalHeight <= availableHeight) {
      bestFit = fontSize;
      console.log(`[RENDERER] ✓ Font size ${fontSize}px fits!`);
      break; // Found the largest size that fits
    }

    // Try smaller
    fontSize -= 1;
  }

  console.log(`[RENDERER] Final font size: ${bestFit}px`);
  return `${bestFit}px`;
}

// Cancel any in-progress typing animation
function cancelTypingAnimation() {
  if (state.typingTimeoutId) {
    clearTimeout(state.typingTimeoutId);
    state.typingTimeoutId = null;
  }
  state.typingSessionId = null;
}

/**
 * Convert minimal markdown (`# heading`, `**bold**`, `*italic*`) into safe HTML so the
 * on-screen poem matches the rendered image styling.
 */
function parseMarkdownPoem(text) {
  if (!text) return '';
  // Escape HTML first to neutralize anything in AI-generated text
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.split('\n').map(line => {
    if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
    return line;
  }).join('\n');

  // Bold before italic so ** wins over *
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  return html;
}

/**
 * Strip markdown markers so the typing animation can run on plain text.
 * Per-char `<span>` wrapping breaks browser word-wrap (line break can occur between
 * any two spans, making the poem look shrunk). Typing plain text via textContent
 * keeps natural word wrap; we swap in formatted HTML once typing completes.
 */
function stripMarkdownMarkers(text) {
  if (!text) return '';
  return text
    .split('\n').map(line => {
      if (line.startsWith('### ')) return line.slice(4);
      if (line.startsWith('## ')) return line.slice(3);
      if (line.startsWith('# ')) return line.slice(2);
      return line;
    }).join('\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1');
}

function showPoemWithTypingEffect(poemText) {
  // Cancel any existing typing animation to prevent race conditions
  cancelTypingAnimation();

  // Generate unique session ID for this typing animation
  const sessionId = Date.now() + Math.random();
  state.typingSessionId = sessionId;

  // Destroy loading animation
  destroyLottieAnimation();

  // Show result screen
  showScreen('result');

  // Display blurred photo background (ensure visible in case hidden from image generation)
  hideResultCameraBackground();
  elements.resultPhoto.style.display = '';
  elements.resultPhoto.src = state.currentPhoto;
  elements.resultPhoto.classList.add('blurred');

  // Type the plain (markers-stripped) version of the poem character by character so
  // browser word wrap stays natural. After typing completes we swap in the formatted
  // markdown HTML so headings/bold/italic appear. Markers are never visible.
  const plainPoem = stripMarkdownMarkers(poemText);
  elements.poemText.textContent = '';
  elements.poemText.classList.remove('typing-complete');

  // Remove image-display class when showing poem text (restores poem layout)
  const poemOverlay = elements.poemText.parentElement;
  if (poemOverlay) {
    poemOverlay.classList.remove('image-display');
  }
  // Make sure the paid watermark from a previous image result isn't shown over a poem
  updateResultPaymentUI();

  // Calculate and apply optimal font size based on the plain text (what's actually displayed)
  const fontSize = calculatePoemFontSize(plainPoem);
  elements.poemText.style.fontSize = fontSize;
  console.log(`[RENDERER] Applied font size: ${fontSize}`);

  // Adapt the QR label to the printer state (print & save vs save)
  updateResultActionLabel();

  // Add typing effect with human-like timing
  let charIndex = 0;
  const baseSpeed = 30; // base milliseconds per character

  function typeNextChar() {
    // Guard: only proceed if this is still the active typing session
    if (state.typingSessionId !== sessionId) {
      return; // Abort - a new typing session has started
    }

    if (charIndex < plainPoem.length) {
      elements.poemText.textContent += plainPoem.charAt(charIndex);
      const lastChar = plainPoem.charAt(charIndex);
      charIndex++;

      // Calculate delay with human-like variation
      let delay = baseSpeed;

      // Add random "thinking" pauses (about 8% chance) to simulate natural typing
      if (Math.random() < 0.08) {
        delay += Math.random() * 250 + 100; // Add 100-350ms pause
      }
      if (['.', '!', '?'].includes(lastChar)) {
        delay += 120; // Longer pause after sentence endings
      } else if ([',', ';', ':'].includes(lastChar)) {
        delay += 60; // Medium pause after commas
      } else if (lastChar === '\n') {
        delay += 150; // Pause at line breaks
      }

      // Store timeout ID in state so it can be cancelled
      state.typingTimeoutId = setTimeout(typeNextChar, delay);
    } else {
      // Typing complete — swap plain text for markdown-formatted HTML so headings/bold/italic appear
      elements.poemText.innerHTML = parseMarkdownPoem(poemText);
      elements.poemText.classList.add('typing-complete');
      state.typingTimeoutId = null;
    }
  }

  typeNextChar();
}

// True when the guest has to pay (a positive print or download price is configured)
function isPaymentActive() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  if (!pay) return false;
  const printPaid = pay.print_enabled && pay.print_tiers &&
    Object.values(pay.print_tiers).some(v => Number(v) > 0);
  const downloadPaid = pay.download_enabled && Number(pay.download_price) > 0;
  return !!(printPaid || downloadPaid);
}

// Cents for a single print (first/smallest tier = most expensive per print), or null
function getFirstPrintPriceCents() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  if (!pay || !pay.print_tiers) return null;
  const qtys = Object.keys(pay.print_tiers).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  return qtys.length ? pay.print_tiers[String(qtys[0])] : null;
}

// Format a price (in minor units / cents) with the right currency for the active language
function formatPrice(cents, currency) {
  const amount = (cents || 0) / 100;
  const locale = getCurrentLanguage() || 'nl';
  try {
    const opts = { style: 'currency', currency: currency || 'EUR' };
    if (Number.isInteger(amount)) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = 0; }
    return new Intl.NumberFormat(locale, opts).format(amount);
  } catch (e) {
    return (currency === 'EUR' ? '€ ' : '') + amount.toFixed(2);
  }
}

// Show the single-print price badge on the booth when paid printing is enabled.
// Shows the first tier (one print) — the most expensive per-print rate.
function updatePriceBadge() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  const firstTierCents = getFirstPrintPriceCents();

  // Price circle on the booth (single-print cost)
  if (elements.priceBadge && elements.priceAmount) {
    if (pay && pay.print_enabled && firstTierCents && firstTierCents > 0) {
      elements.priceAmount.textContent = formatPrice(firstTierCents, pay.currency);
      elements.priceBadge.style.display = 'flex';
    } else {
      elements.priceBadge.style.display = 'none';
    }
  }

}

// Show/hide the terms notice (small text + mini QR) under the booth action button.
// Driven by config.terms.enabled; content.url / content.text override the defaults.
// Dev preview: pass --force-terms to show it without flipping the backend flag.
function updateTermsNotice() {
  if (!elements.termsNotice) return;

  const terms = state.kioskConfig && state.kioskConfig.terms;
  const forceShow = window.location.search.includes('forceTerms');
  const enabled = !!(terms && terms.enabled) || forceShow;

  if (!enabled) {
    elements.termsNotice.style.display = 'none';
    return;
  }

  const content = (terms && terms.content) || {};
  const url = content.url || 'https://poembooth.com/terms';
  const text = content.text || t('terms.agree');
  const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  // URL sits inline at the end of the same sentence, no separate styling
  if (elements.termsText) elements.termsText.textContent = `${text} ${displayUrl}`;

  elements.termsNotice.style.display = 'flex';
}

// Set the QR action label based on whether a printer is currently connected.
// Printing now happens from the guest's phone (portal print button), so when a
// printer is available the QR does both — otherwise it only offers save.
function updateResultActionLabel() {
  if (!elements.qrLabel) return;

  // Paid mode: a stronger call-to-action with the price ("Print for just €4 / Scan the QR code now")
  if (isPaymentActive()) {
    const cents = getFirstPrintPriceCents();
    const pay = state.kioskConfig && state.kioskConfig.payment;
    const priceLabel = (cents && cents > 0) ? formatPrice(cents, pay && pay.currency) : '';
    const line1 = priceLabel
      ? `${t('result.printForJust')} ${priceLabel}`
      : t('result.scanToPrintAndSave');
    elements.qrLabel.innerHTML = `${line1}<br/>${t('result.scanQrNow')}`;
    return;
  }

  const canPrint = state.printerStatus && state.printerStatus.available &&
    (state.printerStatus.status === 'ready' || state.printerStatus.status === 'printing');
  // innerHTML: the print&save label uses a <br/> to sit nicely on two lines
  elements.qrLabel.innerHTML = canPrint
    ? t('result.scanToPrintAndSave')
    : t('result.scanToSave');
}

// Watermark over the result — only on generated images in paid mode (never on poems)
function updateResultPaymentUI() {
  const paid = isPaymentActive();
  const overlay = elements.poemText && elements.poemText.parentElement;
  const isImage = overlay && overlay.classList.contains('image-display');

  if (elements.resultWatermark) {
    elements.resultWatermark.style.display = (paid && isImage) ? 'flex' : 'none';
  }
}

// Show the live, blurred camera feed as the result background (for generated images)
function showResultCameraBackground() {
  if (!elements.resultCamera) return;
  if (state.cameraStream && elements.resultCamera.srcObject !== state.cameraStream) {
    elements.resultCamera.srcObject = state.cameraStream;
    const p = elements.resultCamera.play && elements.resultCamera.play();
    if (p && p.catch) p.catch(() => {});
  }
  elements.resultCamera.style.display = 'block';
  // Match the booth camera's rotation + mirroring (extra zoom hides the blurred edges)
  applyCameraRotation(elements.resultCamera, 1.12);
}

function hideResultCameraBackground() {
  if (elements.resultCamera) elements.resultCamera.style.display = 'none';
}

function showQRCode(publicViewUrl) {
  console.log('[RENDERER] Showing QR code for:', publicViewUrl);

  // Generate styled QR code using qr-code-styling library
  if (typeof QRCodeStyling !== 'undefined') {
    try {
      // Clear any existing QR code
      elements.resultQr.innerHTML = '';

      // Create styled QR code
      const qrCode = new QRCodeStyling({
        type: "canvas",
        shape: "square",
        width: 140,
        height: 140,
        data: publicViewUrl,
        margin: 0,
        qrOptions: {
          typeNumber: "0",
          mode: "Byte",
          errorCorrectionLevel: "Q"
        },
        imageOptions: {
          saveAsBlob: true,
          hideBackgroundDots: false,
          imageSize: 0.4,
          margin: 0
        },
        dotsOptions: {
          type: "dots",
          color: "#000000",
          roundSize: true
        },
        backgroundOptions: {
          round: 0,
          color: "#ffffff"
        },
        image: null,
        cornersSquareOptions: {
          type: "extra-rounded",
          color: "#000000"
        },
        cornersDotOptions: {
          type: "dot",
          color: "#000000"
        }
      });

      // Append QR code to container
      qrCode.append(elements.resultQr);

      console.log('[QR] Styled QR code generated successfully');

      // Show QR circle with pop animation after QR code is generated
      const qrCircle = document.getElementById('qr-circle');

      setTimeout(() => {
        if (qrCircle) {
          qrCircle.classList.add('show');
        }
      }, 100);
    } catch (error) {
      console.error('[QR] Generation error:', error);
    }
  } else {
    console.error('[QR] QR Code Styling library not loaded');
  }

  // Adapt the QR label to the printer state (print & save vs save)
  updateResultActionLabel();

  // Paid-mode extras: watermark over the image + pulsing attention glow
  updateResultPaymentUI();

  // Start countdown timer (longer in paid mode)
  start30SecondTimer();
}

// 30-second countdown with glass wipe animation
function start30SecondTimer() {
  // Paid mode gives guests more time to scan, pay, save and print
  const TIMER_DURATION = isPaymentActive() ? 60000 : 30000; // 60s when paying, else 30s
  const circumference = 440; // Match CSS stroke-dasharray value (r=70px)
  let startTime = Date.now();

  // Interpolate color from green → yellow → red based on progress (1→0)
  function getCountdownColor(progress) {
    // progress: 1 = full time, 0 = expired
    // green (120°) → yellow (60°) → red (0°)
    const hue = progress * 120; // 120 at start, 0 at end
    return `hsl(${hue}, 80%, 55%)`;
  }

  // Animate the timer circle
  function updateTimer() {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, TIMER_DURATION - elapsed);
    const linearProgress = Math.min(1, elapsed / TIMER_DURATION); // 0→1 as time passes

    // Linear progress - no easing so the timer completes exactly when time runs out
    const offset = circumference * (1 - linearProgress);
    elements.timerCircle.style.strokeDashoffset = offset;

    // Update color based on time remaining (1→0)
    const timeProgress = remaining / TIMER_DURATION;
    elements.timerCircle.style.stroke = getCountdownColor(timeProgress);

    if (remaining > 0) {
      state.timerAnimationFrame = requestAnimationFrame(updateTimer);
    } else {
      // Timer expired - check if print is in progress
      if (state.printHoldStart || state.isPrinting) {
        console.log('[RENDERER] Countdown expired but print in progress - waiting...');
        // Keep checking until print completes
        state.timerAnimationFrame = requestAnimationFrame(() => {
          if (!state.printHoldStart && !state.isPrinting) {
            console.log('[RENDERER] Print complete - now triggering glass wipe');
            state.timerAnimationFrame = null;
            triggerGlassWipe();
          } else {
            // Still printing, continue waiting
            updateTimer();
          }
        });
      } else {
        // No print in progress - trigger glass wipe animation
        state.timerAnimationFrame = null;
        triggerGlassWipe();
      }
    }
  }

  updateTimer();
}

// Cancel 30-second timer (e.g., when user starts printing)
function cancel30SecondTimer() {
  if (state.timerAnimationFrame) {
    console.log('[RENDERER] Cancelling 30-second auto-return timer');
    cancelAnimationFrame(state.timerAnimationFrame);
    state.timerAnimationFrame = null;
  }
}

// Glass wipe animation - return to booth screen
function triggerGlassWipe() {
  // Cancel any in-progress typing animation
  cancelTypingAnimation();

  console.log('[RENDERER] Triggering glass wipe animation...');

  // Show glass wipe overlay
  elements.glassWipe.style.display = 'block';

  // Wait for animation to complete (800ms)
  setTimeout(() => {
    elements.glassWipe.style.display = 'none';

    // Hide QR circle
    const qrCircle = document.getElementById('qr-circle');
    if (qrCircle) {
      qrCircle.classList.remove('show');
    }

    // Reset result photo for next session (may have been hidden for image generation)
    if (elements.resultPhoto) {
      elements.resultPhoto.style.display = '';
    }
    // Detach the live camera background until the next generated-image result
    hideResultCameraBackground();

    // Reset state and return to booth screen
    state.currentPhoto = null;
    state.currentSession = null;
    state.isProcessing = false;

    showScreen('booth');
  }, 800);
}


// Update printer status display
function updatePrinterStatus(status) {
  console.log('[RENDERER] Updating printer status:', status);
  state.printerStatus = status;

  // Find hardware instructions element
  const hardwareInstructions = document.querySelector('.hardware-instructions');
  if (!hardwareInstructions) return;

  // Create or update printer status element
  let printerStatusEl = document.getElementById('printer-status');
  if (!printerStatusEl) {
    printerStatusEl = document.createElement('p');
    printerStatusEl.id = 'printer-status';
    printerStatusEl.style.marginTop = '0.5rem';
    hardwareInstructions.appendChild(printerStatusEl);
  }

  // Update status text and color
  let statusText = '';
  let statusColor = '#ffffff';

  if (status.status === 'ready') {
    statusText = '✓ Printer ready';
    statusColor = '#4ade80'; // Green
  } else if (status.status === 'printing') {
    statusText = '⏳ Printing...';
    statusColor = '#60a5fa'; // Blue
  } else if (status.status === 'offline' || !status.available) {
    statusText = '⚠️ Printer offline';
    statusColor = '#f87171'; // Red
  } else if (status.status === 'error') {
    statusText = `⚠️ Printer error${status.message ? ': ' + status.message : ''}`;
    statusColor = '#f87171'; // Red
  } else {
    statusText = 'Printer status unknown';
    statusColor = '#9ca3af'; // Gray
  }

  printerStatusEl.textContent = statusText;
  printerStatusEl.style.color = statusColor;

  // Keep the QR action label in sync with the live printer status on the result screen
  if (state.screen === 'result') {
    updateResultActionLabel();
  }
}

// =============================================================================
// UI Helpers
// =============================================================================

function initLoadingLottie() {
  console.log('[LOTTIE] Initializing loading screen animation');

  if (!elements.loadingLottie) {
    console.error('[LOTTIE] Loading Lottie container not found');
    return;
  }

  try {
    // Initialize Lottie animation
    state.loadingLottieAnimation = lottie.loadAnimation({
      container: elements.loadingLottie,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: './assets/pb-animated-logo.json'
    });

    state.loadingLottieAnimation.addEventListener('DOMLoaded', () => {
      console.log('[LOTTIE] Animation loaded, playing frames 0-118');
      // Play animation from frame 0 to frame 118, then freeze
      state.loadingLottieAnimation.playSegments([0, 118], true);
    });

    state.loadingLottieAnimation.addEventListener('error', (err) => {
      console.error('[LOTTIE] Loading animation error:', err);
    });

    state.loadingLottieAnimation.addEventListener('complete', () => {
      console.log('[LOTTIE] Animation frozen at frame 118');
    });
  } catch (error) {
    console.error('[LOTTIE] Failed to initialize loading animation:', error);
  }
}

// Animate the Poem Booth branding logo (first frames of the startup animation) once,
// the first time the booth screen appears, then freeze the formed logo.
let boothBrandPlayed = false;
function playBoothBrandLogo() {
  if (boothBrandPlayed) return;
  const container = elements.boothBrandLogo;
  if (!container || typeof lottie === 'undefined') return;
  boothBrandPlayed = true;
  try {
    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: './assets/pb-animated-logo.json'
    });
    anim.addEventListener('DOMLoaded', () => {
      anim.playSegments([0, 118], true); // logo appears, then freezes
    });
    state.boothBrandAnimation = anim;
  } catch (e) {
    console.error('[LOTTIE] Failed to init booth brand logo:', e);
  }
}

function showScreen(screenName) {
  // Cancel typing animation when leaving result screen
  if (state.screen === 'result' && screenName !== 'result') {
    cancelTypingAnimation();
  }

  // Special handling for loading screen fade-out
  if (state.screen === 'loading' && screenName !== 'loading') {
    console.log('[RENDERER] Fading out loading screen');
    screens.loading.classList.add('fade-out');

    // Wait for fade-out transition before showing next screen
    setTimeout(() => {
      Object.keys(screens).forEach(key => {
        screens[key].classList.remove('active', 'fade-out');
      });

      screens[screenName].classList.add('active');
      state.screen = screenName;
      updateBoothBrandVisibility();
      if (screenName === 'booth') { resetStyleCoverflow(); playBoothBrandLogo(); }
    }, 1000); // Match CSS transition duration
  } else {
    // Normal screen transition
    Object.keys(screens).forEach(key => {
      screens[key].classList.remove('active');
    });

    screens[screenName].classList.add('active');
    state.screen = screenName;
    updateBoothBrandVisibility();

    // Reset the style coverflow when returning to the booth (after a capture)
    if (screenName === 'booth') { resetStyleCoverflow(); playBoothBrandLogo(); }
  }
}

// Branding (logo + URL) stays visible on the booth and while waiting for the result
function updateBoothBrandVisibility() {
  if (elements.boothBrand) {
    const show = state.screen === 'booth' || state.screen === 'processing';
    elements.boothBrand.classList.toggle('show', show);
  }
}

function updateStatus(screen, message) {
  if (screen === 'loading') {
    elements.loadingStatus.textContent = message;
  }
  console.log(`[${screen.toUpperCase()}] ${message}`);
}

function updateProgress(message, percent) {
  // New design: processing screen shows photo with spinner only (no text/progress bar)
  // Just log for debugging
  console.log(`[PROGRESS] ${message} (${percent}%)`);
}

function showError(title, message, error) {
  // Destroy loading animation
  destroyLottieAnimation();

  elements.errorMessage.textContent = message;

  if (state.isDev && error) {
    document.getElementById('debug-info').style.display = 'block';
    elements.errorDetails.textContent = JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack
    }, null, 2);
  }

  showScreen('error');
}

// Auto-dismiss timeout for notifications
let notificationTimeout = null;

/**
 * Show friendly notification and return to booth screen
 * @param {string} message - Translated notification message
 * @param {number} duration - Display duration in milliseconds (default: 6000)
 */
function showNotification(message, duration = 6000) {
  console.log('[NOTIFICATION] Showing notification:', message);

  // Destroy loading animation if present
  destroyLottieAnimation();

  // Clear any existing notification timeout
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }

  // Reset processing state
  state.isProcessing = false;
  state.currentPhoto = null;

  // Return to booth screen FIRST
  showScreen('booth');

  // Small delay to let screen transition settle
  setTimeout(() => {
    // Set notification message
    elements.notificationMessage.textContent = message;

    // Show notification with animation
    elements.notificationToast.style.display = 'block';
    elements.notificationToast.classList.remove('hide');

    // Auto-dismiss after duration
    notificationTimeout = setTimeout(() => {
      dismissNotification();
    }, duration);
  }, 100);
}

/**
 * Dismiss notification with animation
 */
function dismissNotification() {
  console.log('[NOTIFICATION] Dismissing notification');

  // Add hide animation class
  elements.notificationToast.classList.add('hide');

  // Remove from DOM after animation completes (400ms)
  setTimeout(() => {
    elements.notificationToast.style.display = 'none';
    elements.notificationToast.classList.remove('hide');
  }, 400);

  // Clear timeout reference
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
    notificationTimeout = null;
  }
}

function updateDebugInfo() {
  if (!state.isDev) return;

  const currentStyle = state.availableStyles.length > 0
    ? state.availableStyles[state.currentStyleIndex]
    : null;

  const info = {
    screen: state.screen,
    deviceId: state.deviceConfig?.device_id || 'Not registered',
    equipmentId: state.deviceConfig?.equipment_id || 'N/A',
    hubId: state.deviceConfig?.hub_id || 'N/A',
    online: navigator.onLine,
    processing: state.isProcessing,
    currentStyle: currentStyle ? `${currentStyle.name} (${state.currentStyleIndex + 1}/${state.availableStyles.length})` : 'None'
  };

  elements.debugContent.textContent = JSON.stringify(info, null, 2);
}

// =============================================================================
// Utilities
// =============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// App Lifecycle
// =============================================================================

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  console.log('[RENDERER] DOM loaded, initializing app...');
  console.log('[RENDERER] electronAPI available:', !!window.electronAPI);
  console.log('[RENDERER] Camera video element:', !!elements.cameraVideo);

  // Initialize loading screen Lottie animation
  initLoadingLottie();

  initializeApp();
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

// =============================================================================
// Config Polling (Auto-update configs from backend)
// =============================================================================

let configPollingInterval = null;

/**
 * Start periodic config polling to auto-update from backend
 * Checks every 2 minutes for config changes
 */
function startConfigPolling() {
  const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

  console.log('[CONFIG] Starting config polling (every 2 minutes)');

  // Poll immediately on start (after initial delay)
  setTimeout(checkForConfigUpdates, 10000); // Check after 10 seconds

  // Then poll every 2 minutes
  configPollingInterval = setInterval(checkForConfigUpdates, POLL_INTERVAL);
}

/**
 * Check for config updates from backend
 */
async function checkForConfigUpdates() {
  try {
    // Only check when idle (on booth screen, not processing)
    if (state.screen !== 'booth' || state.isProcessing) {
      console.log('[CONFIG] Skipping config check - screen:', state.screen, 'processing:', state.isProcessing);
      return;
    }

    console.log('[CONFIG] Checking for config updates...');

    // Fetch latest config from backend
    const newConfig = await window.electronAPI.apiGetConfig();

    // Check if config has changed (compare timestamp or hash)
    const hasChanged = JSON.stringify(newConfig) !== JSON.stringify(state.kioskConfig);

    if (hasChanged) {
      console.log('[CONFIG] New config detected! Applying updates...');

      // Update state
      const oldConfig = state.kioskConfig;
      state.kioskConfig = newConfig;

      // Pre-install the booking's venue WiFi profile if it appeared/changed
      await applyBookingWifi(newConfig);

      // Update camera rotation if changed
      const newRotation = newConfig.camera_rotation || 0;
      if (newRotation !== state.cameraRotation) {
        console.log('[CONFIG] Camera rotation changed:', state.cameraRotation, '→', newRotation);
        state.cameraRotation = newRotation;
        applyCameraRotation(elements.cameraVideo);
      }

      // Update poetry styles
      if (newConfig.style_configs && Array.isArray(newConfig.style_configs)) {
        // Only rebuild the coverflow if the styles actually changed (avoids image re-flash)
        const stylesChanged = JSON.stringify(oldConfig.style_configs) !== JSON.stringify(newConfig.style_configs);

        // Extract poem_style from each style_config
        state.availableStyles = newConfig.style_configs.map(sc => sc.poem_style);
        console.log('[CONFIG] Updated poetry styles:', state.availableStyles.map(s => s.name).join(', '));

        // Keep the current index in range
        if (state.currentStyleIndex >= state.availableStyles.length) {
          state.currentStyleIndex = 0;
        }

        // Update style hint visibility
        if (elements.styleHint) {
          elements.styleHint.style.display = state.availableStyles.length > 1 ? 'block' : 'none';
        }

        // Rebuild the coverflow cards with the new styles
        if (stylesChanged) buildStyleCoverflow();
      }

      // Update terms notice (enabled flag / content can change live)
      updateTermsNotice();

      // Update the price badge (payment config can change live)
      updatePriceBadge();

      // Log other config changes
      if (oldConfig.printing_enabled !== newConfig.printing_enabled) {
        console.log('[CONFIG] Printing enabled changed:', oldConfig.printing_enabled, '=>', newConfig.printing_enabled);
      }

      console.log('[CONFIG] Config updates applied successfully');
    } else {
      console.log('[CONFIG] No config changes detected');
    }
  } catch (error) {
    console.error('[CONFIG] Error checking for config updates:', error);
    // Don't throw - just log and continue
  }
}

console.log('[RENDERER] Renderer initialized');
