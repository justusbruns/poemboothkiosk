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
  loadingTextInterval: null,
  loadingTextIndex: 0,
  typingTimeoutId: null,      // Current pending typing animation timeout
  typingSessionId: null       // Unique ID for current typing session
};

// DOM Elements
const screens = {
  loading: document.getElementById('loading-screen'),
  wifi: document.getElementById('wifi-screen'),
  booth: document.getElementById('booth-screen'),
  processing: document.getElementById('processing-screen'),
  result: document.getElementById('result-screen'),
  error: document.getElementById('error-screen')
};

const elements = {
  loadingLottie: document.getElementById('loading-lottie'),
  loadingStatus: document.getElementById('loading-status'),
  wifiStatus: document.getElementById('wifi-status'),
  wifiVideo: document.getElementById('wifi-scanner-video'),
  cameraVideo: document.getElementById('camera-video'),
  cameraCanvas: document.getElementById('camera-canvas'),
  countdownOverlay: document.getElementById('countdown-overlay'),
  countdownNumber: document.querySelector('.countdown-number'),
  whiteFlash: document.getElementById('white-flash'),
  actionButtonText: document.getElementById('action-button-text'),
  styleHint: document.getElementById('style-hint'),
  processingPhoto: document.getElementById('processing-photo'),
  processingStatus: document.getElementById('processing-status'),
  progressFill: document.getElementById('progress-fill'),
  resultPhoto: document.getElementById('result-photo'),
  poemText: document.getElementById('poem-text'),
  resultQr: document.getElementById('result-qr'),
  printContainer: document.getElementById('print-container'),
  printIcon: document.getElementById('print-icon'),
  printDoneIcon: document.getElementById('print-done-icon'),
  printProgress: document.getElementById('print-progress'),
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
  loadingStatusText: document.getElementById('loading-status-text')
};

// =============================================================================
// Camera Service (Inline - uses browser APIs)
// =============================================================================

// Apply camera rotation - size for POST-rotation dimensions
function applyCameraRotation(videoElement) {
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

  videoElement.style.transform = `translate(-50%, -50%) scaleX(-1) rotate(${rotation}deg)`;
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

  // Result screen - circle labels
  const scanToSaveLabel = document.querySelector('#qr-circle + .circle-label');
  const holdToPrintLabel = document.querySelector('#print-circle + .circle-label');
  if (scanToSaveLabel) scanToSaveLabel.textContent = t('result.scanToSave');
  if (holdToPrintLabel) holdToPrintLabel.textContent = t('result.holdToPrint');

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
    showError('Initialization failed', error.message, error);
  }
}

// =============================================================================
// WiFi Setup
// =============================================================================

async function initializeWiFiSetup() {
  try {
    elements.wifiStatus.textContent = 'Waiting for QR code...';

    // Start camera for QR scanning
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    elements.wifiVideo.srcObject = stream;

    // Wait for video to be ready
    await new Promise((resolve) => {
      elements.wifiVideo.onloadedmetadata = () => resolve();
    });

    // Start QR scanning loop
    scanForWiFiQR();

  } catch (error) {
    console.error('[WIFI] Setup error:', error);
    elements.wifiStatus.textContent = `Error: ${error.message}`;
  }
}

function scanForWiFiQR() {
  if (state.screen !== 'wifi') return;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = elements.wifiVideo.videoWidth;
    canvas.height = elements.wifiVideo.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(elements.wifiVideo, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Try to detect QR code using jsQR (loaded via CDN in HTML)
    if (typeof jsQR !== 'undefined') {
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code) {
        console.log('[WIFI] QR code detected:', code.data);
        handleWiFiQRDetected(code.data);
        return;
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

    // Restart initialization now that we have connectivity
    await initializeApp();

  } catch (error) {
    console.error('[WIFI] Connection error:', error);
    elements.wifiStatus.textContent = `Connection failed: ${error.message}`;

    // Restart scanning after 3 seconds
    setTimeout(() => {
      elements.wifiStatus.textContent = 'Waiting for QR code...';
      scanForWiFiQR();
    }, 3000);
  }
}

function parseWiFiQR(qrData) {
  try {
    // WiFi QR format: WIFI:T:WPA;S:SSID;P:password;;
    const wifiRegex = /WIFI:T:([^;]+);S:([^;]+);P:([^;]+);/;
    const match = qrData.match(wifiRegex);

    if (match) {
      return {
        security: match[1],
        ssid: match[2],
        password: match[3]
      };
    }

    // Alternative: JSON format
    try {
      const json = JSON.parse(qrData);
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
    } else if (state.screen === 'result' && !state.isProcessing && !state.isPrinting && state.printerStatus.available) {
      // Start print hold immediately on result screen (instant feedback)
      console.log('[HARDWARE] Starting print hold on result screen');
      startPrintHold();
    } else {
      console.log('[HARDWARE] Ignoring button press - wrong screen, already processing, or printer not available');
    }
  });

  // Hardware button release - cancel print hold or return to booth
  window.electronAPI.onButtonRelease((data) => {
    console.log('[HARDWARE] Button release event received:', data, 'printHoldStart:', !!state.printHoldStart, 'isPrinting:', state.isPrinting);

    // Cancel print hold if in progress (released before 2 seconds)
    if (state.printHoldStart && !state.isPrinting) {
      console.log('[HARDWARE] Cancelling print hold on button release');
      cancelPrintHold();
      return; // Don't transition to booth - stay on result screen
    }

    // Add small delay to avoid race conditions with screen transitions
    setTimeout(() => {
      // Don't transition if print hold is active or printing
      if (state.printHoldStart || state.isPrinting) {
        console.log('[HARDWARE] Ignoring button release - print in progress');
        return;
      }

      if (state.screen === 'result' && !state.isProcessing) {
        // If printer is available, stay on result screen (user uses countdown or holds to print)
        // Only return to booth if printer is NOT available
        if (!state.printerStatus.available) {
          console.log('[HARDWARE] Printer not available - returning to booth screen');
          showScreen('booth');
          state.currentPhoto = null;
          state.currentSession = null;
        } else {
          console.log('[HARDWARE] Printer available - staying on result screen (short press)');
        }
      } else if (state.screen === 'error') {
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

      // 'P' key hold OR Enter hold - print (result screen)
      if ((e.code === 'KeyP' || e.code === 'Enter') && state.screen === 'result' && !e.repeat) {
        e.preventDefault();
        console.log('[HARDWARE] Enter/P detected on result screen, starting print hold');
        startPrintHold();
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

    document.addEventListener('keyup', (e) => {
      // 'P' key OR Enter release - cancel print hold
      if ((e.code === 'KeyP' || e.code === 'Enter') && state.screen === 'result') {
        e.preventDefault();
        cancelPrintHold();
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

  const styles = state.availableStyles;
  const len = styles.length;
  const currentStyle = styles[state.currentStyleIndex];
  const prevStyle = styles[(state.currentStyleIndex - 1 + len) % len];
  const nextStyle = styles[(state.currentStyleIndex + 1) % len];

  console.log('[STYLE] Selected:', currentStyle.name, `(${state.currentStyleIndex + 1}/${len})`);

  // Update UI to show current style (if element exists)
  const styleIndicator = document.getElementById('style-indicator');
  if (styleIndicator) {
    styleIndicator.textContent = `Style: ${currentStyle.name} (${state.currentStyleIndex + 1}/${len})`;
  }

  // Get carousel elements
  const carousel = document.querySelector('.style-carousel');
  const actionText = document.getElementById('action-button-text');
  const prevText = document.getElementById('style-prev');
  const nextText = document.getElementById('style-next');

  // Update all text content
  if (actionText) actionText.innerHTML = currentStyle?.action_button_text || '';
  if (prevText) prevText.innerHTML = prevStyle?.action_button_text || '';
  if (nextText) nextText.innerHTML = nextStyle?.action_button_text || '';

  // Animate entire carousel strip - MIRRORED direction
  if (carousel) {
    carousel.classList.remove('slide-left', 'slide-right');
    void carousel.offsetWidth; // Force reflow

    // Normalize direction check (handle 'counter-clockwise', 'counterclockwise', 'ccw', 'left')
    const isCounterClockwise = direction === 'counter-clockwise' ||
                                direction === 'counterclockwise' ||
                                direction === 'ccw' ||
                                direction === 'left';

    // MIRRORED: counter-clockwise (left turn) → slide-right
    const animClass = isCounterClockwise ? 'slide-right' : 'slide-left';
    carousel.classList.add(animClass);

    console.log('[STYLE] Direction:', direction, '→ Animation:', animClass);

    // Show adjacent options while turning
    carousel.classList.add('turning');

    // Clear previous timeout
    if (turningTimeout) clearTimeout(turningTimeout);

    // Fade out adjacent options after 600ms of no turning
    turningTimeout = setTimeout(() => {
      carousel.classList.remove('turning');
    }, 600);
  }

  updateDebugInfo();
}

// =============================================================================
// Photo Capture Flow
// =============================================================================

async function handleCapture() {
  console.log('[RENDERER] handleCapture() called, isProcessing:', state.isProcessing);

  if (state.isProcessing) {
    console.log('[RENDERER] Already processing, ignoring capture request');
    return;
  }
  state.isProcessing = true;

  try {
    console.log('[RENDERER] Starting countdown...');
    // Show countdown overlay (transparent background - camera visible)
    elements.countdownOverlay.style.display = 'flex';

    // Countdown: 3 → 2 → 1
    for (let i = 3; i > 0; i--) {
      console.log('[RENDERER] Countdown:', i);
      elements.countdownNumber.textContent = i;

      // Force reflow to restart animation
      elements.countdownNumber.style.animation = 'none';
      void elements.countdownNumber.offsetWidth; // trigger reflow
      elements.countdownNumber.style.animation = '';

      await sleep(1000);
    }

    // Hide countdown
    elements.countdownOverlay.style.display = 'none';

    // Show white flash and capture photo during flash
    console.log('[RENDERER] Triggering white flash...');
    elements.whiteFlash.style.display = 'block';

    // Capture photo immediately (during flash)
    const photoDataUrl = await capturePhoto(elements.cameraVideo, elements.cameraCanvas);
    state.currentPhoto = photoDataUrl;
    console.log('[RENDERER] Photo captured successfully, length:', photoDataUrl.length);

    // Wait for flash animation to complete (300ms)
    await sleep(300);
    elements.whiteFlash.style.display = 'none';

    // Auto-proceed to processing (no confirmation needed)
    console.log('[RENDERER] Photo captured, proceeding automatically to processPhoto()...');
    await processPhoto();

  } catch (error) {
    console.error('[RENDERER] Capture error:', error);
    elements.countdownOverlay.style.display = 'none';
    elements.whiteFlash.style.display = 'none';
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

    // Use API-provided dimensions for rendering (fill entire print format)
    const printWidth = brandingTemplate?.output_width || 2048;
    const printHeight = brandingTemplate?.output_height || 1536;
    const printDpi = brandingTemplate?.output_dpi || 300;

    console.log('[RENDERER] Poem generated, session ID:', sessionId);
    console.log('[RENDERER] Poem text length:', poemText.length, 'chars');
    console.log('[RENDERER] Print format:', state.currentPrintFormat, 'orientation:', state.currentPrintOrientation);
    console.log('[RENDERER] API dimensions:', printWidth, 'x', printHeight, '@', printDpi, 'DPI');

    // Show poem text immediately with typing effect
    showPoemWithTypingEffect(poemText);

    updateProgress('Creating artwork...', 60);

    // === STEP 1: Render HIGH-QUALITY image for printing ===
    // Use API-provided dimensions to fill entire print format
    console.log('[RENDERER] Rendering print image with API dimensions:', printWidth, 'x', printHeight);
    const printImageBuffer = await window.electronAPI.renderPoemImage(
      state.currentPhoto,
      { text: poemText },
      brandingTemplate,
      {
        outputWidth: printWidth,
        outputHeight: printHeight,
        quality: 95,  // Near-lossless JPEG quality for printing
        dpi: printDpi
      }
    );

    // Store high-resolution buffer for printing
    state.currentPrintBuffer = printImageBuffer;
    console.log('[RENDERER] ✅ Print buffer created:', printImageBuffer.length, 'bytes',
                '(' + (printImageBuffer.length / 1024 / 1024).toFixed(2) + ' MB)');

    updateProgress('Optimizing for web...', 70);

    // === STEP 2: Render WEB-OPTIMIZED image for backend upload ===
    // Uses template dimensions with quality 85 for smaller file size
    console.log('[RENDERER] Rendering web-optimized image (template dimensions, quality 85)...');
    const webImageBuffer = await window.electronAPI.renderPoemImage(
      state.currentPhoto,
      { text: poemText },
      brandingTemplate,
      {
        quality: 85  // Web-optimized quality (~2MB)
      }
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

    // For AI-generated images, hide result photo to show solid black background
    if (elements.resultPhoto) {
      elements.resultPhoto.src = '';
      elements.resultPhoto.style.display = 'none';
    }

    // Display centered image on result overlay
    // Show the image in the poem text area, but as an <img> instead of text
    if (elements.poemText) {
      // Add centering class to overlay
      const poemOverlay = elements.poemText.parentElement;
      if (poemOverlay) {
        poemOverlay.classList.add('image-display');
      }
      elements.poemText.innerHTML = ''; // Clear text
      const imageElement = document.createElement('img');
      imageElement.src = imageDataUrl;
      imageElement.style.maxWidth = '100%';
      imageElement.style.maxHeight = '100%';
      imageElement.style.objectFit = 'contain';
      imageElement.style.display = 'block';
      imageElement.style.margin = '0 auto';
      elements.poemText.appendChild(imageElement);
      // Hide blinking cursor for image generation (cursor is for poem typing effect)
      elements.poemText.classList.add('typing-complete');
    }

    // Check printer status and show/hide print container
    if (state.printerStatus.available && (state.printerStatus.status === 'ready' || state.printerStatus.status === 'printing')) {
      console.log('[RENDERER] Printer available - showing print container');
      elements.printContainer.style.display = 'flex';
    } else {
      console.log('[RENDERER] Printer not available - hiding print container');
      elements.printContainer.style.display = 'none';
    }

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
  elements.resultPhoto.style.display = '';
  elements.resultPhoto.src = state.currentPhoto;
  elements.resultPhoto.classList.add('blurred');

  // Clear previous poem text
  elements.poemText.textContent = '';
  elements.poemText.classList.remove('typing-complete');

  // Remove image-display class when showing poem text (restores poem layout)
  const poemOverlay = elements.poemText.parentElement;
  if (poemOverlay) {
    poemOverlay.classList.remove('image-display');
  }

  // Calculate and apply optimal font size
  const fontSize = calculatePoemFontSize(poemText);
  elements.poemText.style.fontSize = fontSize;
  console.log(`[RENDERER] Applied font size: ${fontSize}`);

  // Check printer status and show/hide print container
  if (state.printerStatus.available && (state.printerStatus.status === 'ready' || state.printerStatus.status === 'printing')) {
    console.log('[RENDERER] Printer available - showing print container');
    elements.printContainer.style.display = 'flex';
  } else {
    console.log('[RENDERER] Printer not available - hiding print container');
    elements.printContainer.style.display = 'none';
  }

  // Add typing effect with human-like timing
  let charIndex = 0;
  const baseSpeed = 30; // base milliseconds per character

  function typeNextChar() {
    // Guard: only proceed if this is still the active typing session
    if (state.typingSessionId !== sessionId) {
      return; // Abort - a new typing session has started
    }

    if (charIndex < poemText.length) {
      elements.poemText.textContent += poemText.charAt(charIndex);
      charIndex++;

      // Calculate delay with human-like variation
      let delay = baseSpeed;

      // Add random "thinking" pauses (about 8% chance) to simulate natural typing
      if (Math.random() < 0.08) {
        delay += Math.random() * 250 + 100; // Add 100-350ms pause
      }

      // Longer pause after punctuation and line breaks (feels like natural breathing)
      const lastChar = poemText.charAt(charIndex - 1);
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
      // Typing complete
      elements.poemText.classList.add('typing-complete');
      state.typingTimeoutId = null;
    }
  }

  typeNextChar();
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
      const printCircle = document.getElementById('print-circle');

      setTimeout(() => {
        if (qrCircle) {
          qrCircle.classList.add('show');
        }
        // Show print circle at same time if printer available
        if (printCircle && state.printerStatus.available) {
          printCircle.classList.add('show');
        }
      }, 100);
    } catch (error) {
      console.error('[QR] Generation error:', error);
    }
  } else {
    console.error('[QR] QR Code Styling library not loaded');
  }

  // Show print circle if printer hardware is available and ready
  if (state.printerStatus.available && state.printerStatus.status === 'ready') {
    console.log('[RENDERER] Printer available and ready - showing container');
    elements.printContainer.style.display = 'flex';
  } else {
    console.log('[RENDERER] Printer not available - hiding container (available:', state.printerStatus.available, 'status:', state.printerStatus.status + ')');
    elements.printContainer.style.display = 'none';
  }

  // Start 30-second countdown timer
  start30SecondTimer();
}

// 30-second countdown with glass wipe animation
function start30SecondTimer() {
  const TIMER_DURATION = 30000; // 30 seconds
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

    // Reset print icons for next session
    if (elements.printIcon) {
      elements.printIcon.style.display = 'flex';
    }
    if (elements.printDoneIcon) {
      elements.printDoneIcon.style.display = 'none';
      elements.printDoneIcon.classList.remove('show');
    }
    // Reset print progress ring to empty state
    if (elements.printProgress) {
      const circumference = 440; // Match CSS stroke-dasharray value (r=70px)
      elements.printProgress.style.transition = 'none';
      elements.printProgress.style.strokeDashoffset = circumference; // Equals dasharray = fully hidden
    }
    // Reset print circle animation (so it appears with QR code)
    const printCircle = document.getElementById('print-circle');
    if (printCircle) {
      printCircle.classList.remove('show');
    }

    // Reset result photo for next session (may have been hidden for image generation)
    if (elements.resultPhoto) {
      elements.resultPhoto.style.display = '';
    }

    // Reset state and return to booth screen
    state.currentPhoto = null;
    state.currentSession = null;
    state.isProcessing = false;

    showScreen('booth');
  }, 800);
}

// Start print hold progress (2-second hold - matches MockHardwareService.longPressThreshold)
function startPrintHold() {
  if (state.printHoldStart) return; // Already holding

  console.log('[RENDERER] Starting print hold...');

  // Keep 30-second timer running (don't cancel it)
  // Timer will continue counting down even while printing

  state.printHoldStart = Date.now();

  const HOLD_DURATION = 2000; // 2 seconds (must match MockHardwareService.longPressThreshold)
  const circumference = 440; // Match CSS stroke-dasharray value (r=70px)

  // INSTANT FEEDBACK: Show green line immediately (start from full)
  elements.printProgress.style.transition = 'none';
  elements.printProgress.style.strokeDashoffset = circumference; // Equals dasharray = fully hidden

  // Force reflow to apply instant change
  void elements.printProgress.offsetWidth;

  // Re-enable transition for smooth animation
  elements.printProgress.style.transition = 'stroke-dashoffset 0.05s linear';

  function updatePrintProgress() {
    // Guard: if print hold was cancelled, stop the animation loop
    if (!state.printHoldStart) {
      return;
    }

    const elapsed = Date.now() - state.printHoldStart;
    const progress = Math.min(1, elapsed / HOLD_DURATION);

    // Update stroke-dashoffset (440 = empty, 0 = full)
    const offset = circumference * (1 - progress);
    elements.printProgress.style.strokeDashoffset = offset;

    if (progress >= 1) {
      // Hold complete - trigger print
      completePrintHold();
    } else {
      state.printHoldInterval = requestAnimationFrame(updatePrintProgress);
    }
  }

  // Start animation on next frame for instant visual feedback
  requestAnimationFrame(updatePrintProgress);
}

// Cancel print hold progress
function cancelPrintHold() {
  if (!state.printHoldStart) return;

  console.log('[RENDERER] Cancelling print hold');
  state.printHoldStart = null;

  if (state.printHoldInterval) {
    cancelAnimationFrame(state.printHoldInterval);
    state.printHoldInterval = null;
  }

  // SNAP-BACK: Quick transition back to empty
  const circumference = 440; // Match CSS stroke-dasharray value (r=70px)
  elements.printProgress.style.transition = 'stroke-dashoffset 0.2s ease-out';
  elements.printProgress.style.strokeDashoffset = circumference; // Equals dasharray = fully hidden

  // Reset transition after snap-back
  setTimeout(() => {
    elements.printProgress.style.transition = 'stroke-dashoffset 0.05s linear';
  }, 200);
}

// Complete print hold - trigger print
async function completePrintHold() {
  console.log('[RENDERER] Print hold complete');

  // Clean up progress tracking
  state.printHoldStart = null;
  if (state.printHoldInterval) {
    cancelAnimationFrame(state.printHoldInterval);
    state.printHoldInterval = null;
  }

  // Show checkmark icon
  elements.printIcon.style.display = 'none';
  elements.printDoneIcon.style.display = 'block';

  // Trigger print
  await handlePrint();
}

async function handlePrint() {
  console.log('[RENDERER] ===== PRINT REQUEST STARTED =====');
  console.log('[RENDERER] Session ID:', state.currentSession?.id);
  console.log('[RENDERER] isPrinting:', state.isPrinting);

  // Mutex guard - prevent duplicate print jobs
  if (state.isPrinting) {
    console.log('[RENDERER] Print already in progress, ignoring duplicate request');
    return;
  }

  state.isPrinting = true;

  try {
    if (!state.currentSession) {
      console.error('[RENDERER] ❌ No session to print');
      updatePrinterStatus({ available: false, status: 'error', message: 'No session available' });
      state.isPrinting = false;
      return;
    }

    if (!state.currentPrintBuffer) {
      console.error('[RENDERER] ❌ No print buffer available');
      updatePrinterStatus({ available: false, status: 'error', message: 'No image to print' });
      state.isPrinting = false;
      return;
    }

    console.log('[RENDERER] Print buffer size:', state.currentPrintBuffer.length, 'bytes',
                '(' + (state.currentPrintBuffer.length / 1024 / 1024).toFixed(2) + ' MB)');

    // Check printer status
    console.log('[RENDERER] Checking printer status...');
    const printerStatus = await window.electronAPI.printerGetStatus();
    console.log('[RENDERER] Printer status:', JSON.stringify(printerStatus));

    if (!printerStatus.available) {
      console.error('[RENDERER] ❌ Printer not available');
      updatePrinterStatus(printerStatus);
      state.isPrinting = false;
      return;
    }

    // Update status to printing
    console.log('[RENDERER] Updating UI to show printing status...');
    updatePrinterStatus({ available: true, status: 'printing', message: 'Printing...' });

    // Send print job to printer via IPC with print format options
    console.log('[RENDERER] Calling window.electronAPI.printerPrint()...');
    console.log('[RENDERER] Print options:', {
      printFormat: state.currentPrintFormat,
      printOrientation: state.currentPrintOrientation
    });
    const result = await window.electronAPI.printerPrint(state.currentPrintBuffer, {
      printFormat: state.currentPrintFormat,
      printOrientation: state.currentPrintOrientation
    });

    console.log('[RENDERER] Print IPC returned:', JSON.stringify(result));

    if (result.success) {
      console.log('[RENDERER] ✅ Print job completed successfully');

      // Log print action to backend
      console.log('[RENDERER] Logging print action to backend...');
      try {
        await window.electronAPI.apiLogPrint(state.currentSession.id);
        console.log('[RENDERER] ✅ Print action logged');
      } catch (logError) {
        console.warn('[RENDERER] ⚠️ Failed to log print:', logError);
      }

      // Show print icon as done with pop animation
      if (elements.printIcon) {
        elements.printIcon.style.display = 'none';
      }
      if (elements.printDoneIcon) {
        elements.printDoneIcon.style.display = 'flex';
        // Trigger pop animation
        setTimeout(() => {
          elements.printDoneIcon.classList.add('show');
        }, 50);
      }

      // Update status back to ready after delay
      setTimeout(async () => {
        console.log('[RENDERER] Refreshing printer status...');
        const status = await window.electronAPI.printerGetStatus();
        updatePrinterStatus(status);
      }, 2000);

      // Reset isPrinting flag after successful print
      state.isPrinting = false;
      console.log('[RENDERER] isPrinting flag reset after successful print');
    } else {
      console.error('[RENDERER] ❌ Print job FAILED');
      console.error('[RENDERER] Error message:', result.error);
      updatePrinterStatus({ available: false, status: 'error', message: result.error || 'Print failed' });

      // Reset print icon
      if (elements.printIcon) {
        elements.printIcon.style.display = 'block';
      }
      if (elements.printDoneIcon) {
        elements.printDoneIcon.style.display = 'none';
      }

      // Reset isPrinting flag on failure
      state.isPrinting = false;
    }
  } catch (error) {
    console.error('[RENDERER] ❌ Print exception:', error);
    console.error('[RENDERER] Exception stack:', error.stack);
    updatePrinterStatus({ available: false, status: 'error', message: error.message });

    // Reset print icon
    if (elements.printIcon) {
      elements.printIcon.style.display = 'block';
    }
    if (elements.printDoneIcon) {
      elements.printDoneIcon.style.display = 'none';
    }

    // Reset isPrinting flag on exception
    state.isPrinting = false;
  }
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

  // Toggle print container visibility based on printer status
  // Only show print container when on result screen
  if (state.screen === 'result' && elements.printContainer) {
    if (status.available && (status.status === 'ready' || status.status === 'printing')) {
      console.log('[RENDERER] Showing print container (printer available)');
      elements.printContainer.style.display = 'flex';
    } else {
      console.log('[RENDERER] Hiding print container (printer not available)');
      elements.printContainer.style.display = 'none';
    }
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
    }, 1000); // Match CSS transition duration
  } else {
    // Normal screen transition
    Object.keys(screens).forEach(key => {
      screens[key].classList.remove('active');
    });

    screens[screenName].classList.add('active');
    state.screen = screenName;
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

      // Update camera rotation if changed
      const newRotation = newConfig.camera_rotation || 0;
      if (newRotation !== state.cameraRotation) {
        console.log('[CONFIG] Camera rotation changed:', state.cameraRotation, '→', newRotation);
        state.cameraRotation = newRotation;
        applyCameraRotation(elements.cameraVideo);
      }

      // Update poetry styles
      if (newConfig.style_configs && Array.isArray(newConfig.style_configs)) {
        // Extract poem_style from each style_config
        state.availableStyles = newConfig.style_configs.map(sc => sc.poem_style);
        console.log('[CONFIG] Updated poetry styles:', state.availableStyles.map(s => s.name).join(', '));

        // Update action button text if on booth screen
        if (state.screen === 'booth' && state.availableStyles.length > 0) {
          const currentStyle = state.availableStyles[state.currentStyleIndex] || state.availableStyles[0];
          if (currentStyle.action_button_text && elements.actionButtonText) {
            elements.actionButtonText.innerHTML = currentStyle.action_button_text;
            console.log('[CONFIG] Updated action button text:', currentStyle.action_button_text);
          }
        }

        // Update style hint visibility
        if (elements.styleHint) {
          elements.styleHint.style.display = state.availableStyles.length > 1 ? 'block' : 'none';
        }
      }

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
