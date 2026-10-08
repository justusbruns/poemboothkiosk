import { fill } from './setup/text.js';
import { updateProgress } from './ui.js';

// State management
export const state = {
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
  maxPrints: 1,               // config.max_prints_per_photo (how many kiosk prints per photo)
  printsRemaining: 0,         // prints left for the current result (reset when a result is shown)
  glassWiping: false,         // guard so the return-to-booth wipe can't fire twice
  timerAnimationFrame: null, // 30-second auto-return timer
  lottieAnimation: null,
  loadingLottieAnimation: null,
  printerStatus: { available: false, status: 'unknown' },
  cameraRotation: 0, // Camera rotation from backend config (0, 90, 180, 270)
  cameraResolution: null,    // { width, height, fps, label } actually delivered by the camera
  cameraMaxResolution: null, // { width, height } the track reports it can do
  installedWifiSsid: null, // SSID of the booking WiFi profile already installed (dedup)
  loadingTextInterval: null,
  loadingTextIndex: 0,
  showBoothBrand: false,      // whether the top branding slot is shown (set from config)
  isCapturing: false,         // true from countdown start until back on the idle booth screen
  typingTimeoutId: null,      // Current pending typing animation timeout
  typingSessionId: null,      // Unique ID for current typing session
  // Update state
  updateAvailable: false,
  updateInfo: null,
  updateSelectedOption: 'install' // 'skip' or 'install'
};

// DOM Elements
export const screens = {
  loading: document.getElementById('loading-screen'),
  update: document.getElementById('update-screen'),
  wifi: document.getElementById('wifi-screen'),
  language: document.getElementById('language-screen'),
  pairing: document.getElementById('pairing-screen'),
  booth: document.getElementById('booth-screen'),
  processing: document.getElementById('processing-screen'),
  result: document.getElementById('result-screen'),
  error: document.getElementById('error-screen')
};

export const elements = {
  loadingLottie: document.getElementById('loading-lottie'),
  boothBrand: document.getElementById('booth-brand'),
  boothBrandLogo: document.getElementById('booth-brand-logo'),
  boothBrandUrl: document.getElementById('booth-brand-url'),
  loadingStatus: document.getElementById('loading-status'),
  wifiStatus: document.getElementById('wifi-status'),
  wifiVideo: document.getElementById('wifi-scanner-video'),
  languageTitle: document.getElementById('language-title'),
  languageHint: document.getElementById('language-hint'),
  languageOptions: Array.from(document.querySelectorAll('#language-screen .language-option')),
  pairingTitle: document.getElementById('pairing-title'),
  pairingIntro: document.getElementById('pairing-intro'),
  pairingQr: document.getElementById('pairing-qr'),
  pairingCode: document.getElementById('pairing-code'),
  pairingUrl: document.getElementById('pairing-url'),
  pairingStatus: document.getElementById('pairing-status'),
  pairingEnv: document.getElementById('pairing-env'),
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
  printContainer: document.getElementById('print-container'),
  printIcon: document.getElementById('print-icon'),
  printDoneIcon: document.getElementById('print-done-icon'),
  printProgress: document.getElementById('print-progress'),
  printLabel: document.getElementById('print-label'),
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
