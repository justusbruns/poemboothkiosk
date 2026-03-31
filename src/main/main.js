const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Import services (they run in main process)
const ApiClient = require('../services/apiClient');
const RenderingService = require('../services/renderingService');
const WiFiService = require('../services/wifiService');
const HardwareService = require('../services/hardwareService');
const MockHardwareService = require('../services/mockHardwareService');
const PrinterService = require('../services/printerService');
const MockPrinterService = require('../services/mockPrinterService');
const UpdateService = require('../services/updateService');

// Constants
const IS_DEV = process.argv.includes('--dev');
const IS_STAGING = process.argv.includes('--staging');
const FORCE_WIFI = process.argv.includes('--force-wifi');
// Mock printer: use in dev mode by default, unless --real-printer is specified
const USE_MOCK_PRINTER = process.argv.includes('--mock-printer') ||
                         (IS_DEV && !process.argv.includes('--real-printer'));
const CERT_PATHS = {
  win32: 'C:\\ProgramData\\PoemBooth',
  linux: '/etc/poembooth',
  darwin: '/Library/Application Support/PoemBooth'
};

let mainWindow;
let deviceConfig = null;
let kioskConfig = null;

// Services (initialized when needed)
let apiClient = null;
let renderingService = null;
let wifiService = null;
let hardwareService = null;
let printerService = null;
let updateService = null;

// Get platform-specific certificate path
function getCertificatePath() {
  const basePath = CERT_PATHS[process.platform];
  return {
    base: basePath,
    cert: path.join(basePath, 'device.crt'),
    key: path.join(basePath, 'device.key'),
    ca: path.join(basePath, 'ca.crt')
  };
}

// Check if certificates exist
function certificatesExist() {
  const certPaths = getCertificatePath();
  return (
    fs.existsSync(certPaths.cert) &&
    fs.existsSync(certPaths.key) &&
    fs.existsSync(certPaths.ca)
  );
}

// Create main window
async function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Portrait 9:16 aspect ratio (1080x1920)
  // Dev mode: 50% scale for easier development (540x960)
  mainWindow = new BrowserWindow({
    width: IS_DEV ? 540 : 1080,
    height: IS_DEV ? 960 : 1920,
    fullscreen: !IS_DEV,
    kiosk: !IS_DEV,
    frame: IS_DEV,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,  // Changed to false for security
      contextIsolation: true,   // Changed to true for security
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a1a',
    show: false
  });

  // Prevent window from closing (kiosk mode)
  if (!IS_DEV) {
    mainWindow.setClosable(false);
    mainWindow.setMinimizable(false);
    mainWindow.setMaximizable(false);
  }

  // Open DevTools in development mode
  if (IS_DEV) {
    mainWindow.webContents.openDevTools();

    // Pipe renderer console logs to terminal
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[RENDERER] ${message}`);
    });
  }

  // Prevent navigation away from app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Initialize hardware service (non-blocking)
  initializeHardware();

  // Initialize printer service BEFORE loading renderer
  // This ensures printer is detected before renderer queries status
  await initializePrinter();

  // Load the app AFTER printer is initialized
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    if (!IS_DEV) {
      // Ensure window is on top and truly fullscreen on startup
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setFullScreen(true);
      // Release always-on-top after a delay so it doesn't block OS dialogs permanently
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(true, 'floating');
        }
      }, 2000);
    }
  });
}

// Initialize hardware (GPIO or mock for dev)
async function initializeHardware() {
  console.log('[MAIN] Initializing hardware service...');

  try {
    // Use mock hardware for:
    // 1. Dev mode (keyboard testing)
    // 2. Windows production (Pico USB HID sends keyboard events)
    // Use real GPIO hardware only on Raspberry Pi
    const isRaspberryPi = process.platform === 'linux' && process.arch === 'arm';

    if (IS_DEV || !isRaspberryPi) {
      console.log('[MAIN] Using MockHardwareService (dev mode or non-Pi platform)');
      hardwareService = new MockHardwareService();
    } else {
      console.log('[MAIN] Using HardwareService (Raspberry Pi GPIO)');
      hardwareService = new HardwareService();
    }

    const initialized = await hardwareService.initialize();

    if (!initialized) {
      console.warn('[MAIN] Hardware initialization failed');
      return;
    }

    // Set up hardware event handlers
    hardwareService.on('buttonPress', () => {
      console.log('[MAIN] Hardware button pressed');
      mainWindow.webContents.send('hardware:buttonPress');
    });

    hardwareService.on('buttonRelease', (data) => {
      console.log('[MAIN] Hardware button released');
      mainWindow.webContents.send('hardware:buttonRelease', data);
    });

    hardwareService.on('longPress', () => {
      console.log('[MAIN] Hardware long press detected');
      mainWindow.webContents.send('hardware:longPress');
    });

    hardwareService.on('knobRotate', (data) => {
      console.log('[MAIN] Hardware knob rotated:', data.direction);
      mainWindow.webContents.send('hardware:knobRotate', data);
    });

    // In dev mode, set up keyboard shortcuts for testing
    if (IS_DEV && hardwareService instanceof MockHardwareService) {
      setupKeyboardShortcuts();
    }

    // PRODUCTION-READY: Intercept Enter key from renderer for Pico USB HID button
    // Works in both dev (keyboard testing) and production (Pico button)
    if (hardwareService instanceof MockHardwareService) {
      // Use IPC to receive key events from renderer
      const { ipcMain } = require('electron');

      ipcMain.on('hardware:keyEvent', (event, data) => {
        console.log('[MAIN] Received key event from renderer:', data);

        if (data.type === 'keydown' && (data.code === 'Space' || data.code === 'Enter')) {
          console.log('[MAIN] >>> Button PRESS');
          hardwareService.simulateButtonPress();
        } else if (data.type === 'keyup' && (data.code === 'Space' || data.code === 'Enter')) {
          console.log('[MAIN] >>> Button RELEASE');
          hardwareService.simulateButtonRelease();
        } else if (data.type === 'keydown' && data.code === 'ArrowLeft') {
          console.log('[MAIN] >>> Knob LEFT');
          hardwareService.simulateKnobRotate('left');
        } else if (data.type === 'keydown' && data.code === 'ArrowRight') {
          console.log('[MAIN] >>> Knob RIGHT');
          hardwareService.simulateKnobRotate('right');
        }
      });

      console.log('[MAIN] ✓ IPC key event handler registered');
    }

    console.log('[MAIN] Hardware service initialized successfully');
  } catch (error) {
    console.error('[MAIN] Error initializing hardware:', error);
  }
}

// Set up keyboard shortcuts for dev mode
// NOTE: We only use globalShortcut for arrow keys (which don't need keyup).
// For Space/Enter, we use the IPC path from renderer which properly handles keydown+keyup.
// This is critical for print hold snap-back behavior.
function setupKeyboardShortcuts() {
  const { globalShortcut } = require('electron');

  // NOTE: Space and Enter are NOT registered as global shortcuts because:
  // 1. globalShortcut only fires on keydown, NOT keyup
  // 2. We need keyup to cancel print hold (snap-back behavior)
  // 3. Instead, key events flow: renderer keydown/keyup → IPC → MockHardwareService
  // This path is set up in initializeHardware() via ipcMain.on('hardware:keyEvent')

  // Arrow keys = knob rotation (these don't need keyup, so globalShortcut is fine)
  globalShortcut.register('Left', () => {
    if (hardwareService && hardwareService instanceof MockHardwareService) {
      hardwareService.simulateKnobRotate('left');
    }
  });

  globalShortcut.register('Right', () => {
    if (hardwareService && hardwareService instanceof MockHardwareService) {
      hardwareService.simulateKnobRotate('right');
    }
  });

  console.log('[MAIN] Keyboard shortcuts registered (Left, Right arrows only)');
  console.log('[MAIN] Space/Enter handled via IPC for proper keyup support');
}

// Note: Enter key handling in initializeHardware() after hardware service is ready

// Initialize printer service
async function initializePrinter() {
  console.log('[MAIN] Initializing printer service...');
  console.log('[MAIN] USE_MOCK_PRINTER:', USE_MOCK_PRINTER);

  try {
    if (USE_MOCK_PRINTER) {
      console.log('[MAIN] Using MOCK printer service (testing mode - no paper will be used)');
      printerService = new MockPrinterService();
    } else {
      console.log('[MAIN] Using REAL printer service');
      printerService = new PrinterService();
    }

    const initialized = await printerService.initialize();

    if (!initialized) {
      console.warn('[MAIN] Printer not available - printing will be disabled');
    }

    // Set up status change callback to notify renderer
    printerService.onStatusChange((status) => {
      console.log('[MAIN] Printer status changed:', status);
      mainWindow.webContents.send('printer:statusChange', status);
    });

    console.log('[MAIN] Printer service initialized');
  } catch (error) {
    console.error('[MAIN] Error initializing printer:', error);
  }
}

// Cleanup hardware and printer on quit
app.on('will-quit', async () => {
  if (hardwareService) {
    await hardwareService.destroy();
  }
  if (printerService) {
    printerService.destroy();
  }
});

// App lifecycle
app.whenReady().then(async () => {
  console.log('[MAIN] App ready');
  console.log('[MAIN] Platform:', process.platform);
  console.log('[MAIN] Dev mode:', IS_DEV);
  console.log('[MAIN] Staging mode:', IS_STAGING);
  console.log('[MAIN] Certificates exist:', certificatesExist());

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || IS_DEV) {
    app.quit();
  }
});

// Prevent app quit in kiosk mode
if (!IS_DEV) {
  app.on('before-quit', (event) => {
    event.preventDefault();
  });
}

// =============================================================================
// IPC Handlers - Basic Info
// =============================================================================

// Get certificate paths
ipcMain.handle('get-certificate-path', async () => {
  return getCertificatePath();
});

// Check if certificates exist
ipcMain.handle('certificates-exist', async () => {
  return certificatesExist();
});

// SECURITY: read-certificate IPC handler removed
// Certificates are never exposed to renderer process
// All certificate operations happen in main process only

// Get system info
ipcMain.handle('get-system-info', async () => {
  const os = require('os');

  try {
    // Try to get machine ID, but don't fail if not available
    let machineid = 'unknown';
    try {
      const { machineId } = require('node-machine-id');
      machineid = await machineId();
    } catch (e) {
      console.log('[MAIN] node-machine-id not available, using hostname');
      machineid = os.hostname();
    }

    return {
      platform: process.platform,
      hostname: os.hostname(),
      machineId: machineid,
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      appVersion: app.getVersion()
    };
  } catch (error) {
    console.error('[MAIN] Error getting system info:', error);
    return {
      platform: process.platform,
      hostname: os.hostname(),
      machineId: 'unknown',
      appVersion: app.getVersion()
    };
  }
});

// Get debug flags
ipcMain.handle('get-flags', async () => {
  return {
    isDev: IS_DEV,
    forceWifi: FORCE_WIFI
  };
});

// =============================================================================
// IPC Handlers - API Client
// =============================================================================

// Initialize API client
ipcMain.handle('api:initialize', async () => {
  try {
    console.log('[MAIN] Initializing API client...');
    apiClient = new ApiClient();
    await apiClient.initialize();
    return { success: true };
  } catch (error) {
    console.error('[MAIN] API initialization error:', error);
    return { success: false, error: error.message };
  }
});

// Check connectivity
ipcMain.handle('api:check-connectivity', async () => {
  try {
    if (!apiClient) {
      apiClient = new ApiClient();
      await apiClient.initialize();
    }
    const isOnline = await apiClient.checkConnectivity();
    return { success: true, isOnline };
  } catch (error) {
    console.error('[MAIN] Connectivity check error:', error);
    return { success: false, error: error.message, isOnline: false };
  }
});

// Register device
ipcMain.handle('api:register-device', async () => {
  try {
    console.log('[MAIN] Registering device...');
    if (!apiClient) {
      apiClient = new ApiClient();
      await apiClient.initialize();
    }
    const response = await apiClient.registerDevice();
    deviceConfig = response.device;
    return response;
  } catch (error) {
    console.error('[MAIN] Device registration error:', error);
    throw error;
  }
});

// Get kiosk config
ipcMain.handle('api:get-config', async () => {
  try {
    console.log('[MAIN] Fetching kiosk config...');
    if (!apiClient) {
      throw new Error('API client not initialized');
    }
    kioskConfig = await apiClient.getKioskConfig();
    return kioskConfig;
  } catch (error) {
    console.error('[MAIN] Config fetch error:', error);
    throw error;
  }
});

// Unified content generation (poems and images)
ipcMain.handle('api:generate-content', async (event, photoDataUrl, metadata) => {
  try {
    console.log('[MAIN] Generating content...');
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    // Convert data URL to buffer
    const base64Data = photoDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const response = await apiClient.generateContent(buffer, metadata);
    return response;
  } catch (error) {
    console.error('[MAIN] Content generation error:', error);
    throw error;
  }
});

// DEPRECATED: Poem generation (kept for backward compatibility)
ipcMain.handle('api:generate-poem', async (event, photoDataUrl, metadata) => {
  try {
    console.log('[MAIN] Generating poem... (deprecated handler)');
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    // Convert data URL to blob
    const base64Data = photoDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const response = await apiClient.generatePoem(buffer, metadata);
    return response;
  } catch (error) {
    console.error('[MAIN] Poem generation error:', error);
    throw error;
  }
});

// Upload rendered image
ipcMain.handle('api:upload-image', async (event, imageBuffer, sessionId, quality = 'standard') => {
  try {
    console.log('[MAIN] Uploading rendered image...');
    console.log('[MAIN] Session ID:', sessionId);
    console.log('[MAIN] Quality:', quality);
    if (!apiClient) {
      throw new Error('API client not initialized');
    }

    // imageBuffer comes as ArrayBuffer from renderer, convert to Buffer
    const buf = Buffer.from(imageBuffer);

    const response = await apiClient.uploadRenderedImage(buf, sessionId, quality);
    return response;
  } catch (error) {
    console.error('[MAIN] Upload error:', error);
    throw error;
  }
});

// Log print
ipcMain.handle('api:log-print', async (event, sessionId) => {
  try {
    console.log('[MAIN] Logging print action...');
    if (!apiClient) {
      throw new Error('API client not initialized');
    }
    const response = await apiClient.logPrint(sessionId);
    return response;
  } catch (error) {
    console.error('[MAIN] Print logging error:', error);
    // Don't throw - printing should work even if logging fails
    return { success: false, error: error.message };
  }
});

// =============================================================================
// IPC Handlers - Rendering Service
// =============================================================================

// Render poem image
ipcMain.handle('render:poem-image', async (event, photoDataUrl, poem, branding, options = {}) => {
  try {
    console.log('[MAIN] Rendering poem image...');
    if (options.outputWidth || options.outputHeight) {
      console.log('[MAIN] Custom dimensions requested:', options.outputWidth, 'x', options.outputHeight);
    }
    if (options.quality) {
      console.log('[MAIN] Custom quality requested:', options.quality);
    }

    if (!renderingService) {
      renderingService = new RenderingService(branding || kioskConfig?.branding);
    }

    const imageBuffer = await renderingService.renderPoemImage(photoDataUrl, poem, branding, options);

    // Return as ArrayBuffer for renderer
    return imageBuffer;
  } catch (error) {
    console.error('[MAIN] Rendering error:', error);
    throw error;
  }
});

// =============================================================================
// IPC Handlers - WiFi Service
// =============================================================================

// Connect to WiFi
ipcMain.handle('wifi:connect', async (event, wifiConfig) => {
  try {
    console.log('[MAIN] Connecting to WiFi:', wifiConfig.ssid);

    if (!wifiService) {
      wifiService = new WiFiService();
    }

    await wifiService.connect(wifiConfig);
    return { success: true };
  } catch (error) {
    console.error('[MAIN] WiFi connection error:', error);
    return { success: false, error: error.message };
  }
});

// Get current WiFi network
ipcMain.handle('wifi:get-current', async () => {
  try {
    if (!wifiService) {
      wifiService = new WiFiService();
    }

    const network = await wifiService.getCurrentNetwork();
    return { success: true, network };
  } catch (error) {
    console.error('[MAIN] Get current network error:', error);
    return { success: false, error: error.message, network: null };
  }
});

// =============================================================================
// IPC Handlers - Printer
// =============================================================================

// Print image buffer
ipcMain.handle('printer:print', async (event, imageBuffer, options = {}) => {
  console.log('[MAIN][PRINTER] ===== PRINT REQUEST RECEIVED =====');
  console.log('[MAIN][PRINTER] Image buffer size:', imageBuffer ? imageBuffer.length : 'NULL', 'bytes');
  console.log('[MAIN][PRINTER] Print options:', options);

  if (!printerService) {
    console.error('[MAIN][PRINTER] ❌ Printer service not initialized');
    return { success: false, error: 'Printer service not initialized' };
  }

  try {
    // Convert array to Buffer if needed
    const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
    console.log('[MAIN][PRINTER] Buffer converted, size:', buffer.length, 'bytes');

    // Call printerService.print and capture the return value
    console.log('[MAIN][PRINTER] Calling printerService.print()...');
    const printSuccess = await printerService.print(buffer, options);

    console.log('[MAIN][PRINTER] printerService.print() returned:', printSuccess);

    if (printSuccess) {
      console.log('[MAIN][PRINTER] ✅ Print job completed successfully');
      return { success: true };
    } else {
      console.error('[MAIN][PRINTER] ❌ Print job failed (returned false)');
      return { success: false, error: 'Print job failed' };
    }
  } catch (error) {
    console.error('[MAIN][PRINTER] ❌ Print error (exception):', error);
    console.error('[MAIN][PRINTER] Error stack:', error.stack);
    return { success: false, error: error.message };
  }
});

// Get printer status
ipcMain.handle('printer:get-status', async () => {
  console.log('[MAIN] Printer status requested');

  if (!printerService) {
    return {
      available: false,
      status: 'not_initialized',
      printerName: 'Unknown'
    };
  }

  try {
    return await printerService.getStatus();
  } catch (error) {
    console.error('[MAIN] Get printer status error:', error);
    return {
      available: false,
      status: 'error',
      printerName: 'Unknown',
      error: error.message
    };
  }
});

// =============================================================================
// IPC Handlers - Misc
// =============================================================================

// Store device config
ipcMain.handle('store-device-config', async (event, config) => {
  deviceConfig = config;
  console.log('[MAIN] Device config stored:', {
    deviceId: config.device_id,
    equipmentId: config.equipment_id,
    hubId: config.hub_id
  });
  return true;
});

// Get device config
ipcMain.handle('get-device-config', async () => {
  return deviceConfig;
});

// Get kiosk config
ipcMain.handle('get-kiosk-config', async () => {
  return kioskConfig;
});

// Quit app (only in dev mode)
ipcMain.handle('quit-app', async () => {
  if (IS_DEV) {
    app.quit();
    return true;
  }
  return false;
});

// =============================================================================
// IPC Handlers - Auto-Update
// =============================================================================

// Check for updates
ipcMain.handle('update:check', async () => {
  try {
    console.log('[MAIN] Checking for updates...');

    if (!updateService) {
      updateService = new UpdateService();

      // Set up progress callback
      updateService.onDownloadProgress = (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:progress', progress);
        }
      };

      // Set up downloaded callback
      updateService.onUpdateDownloaded = (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:downloaded', info);
        }
      };
    }

    const result = await updateService.checkForUpdates();
    console.log('[MAIN] Update check result:', result);
    return result;
  } catch (error) {
    console.error('[MAIN] Update check error:', error);
    return {
      available: false,
      error: error.message,
      currentVersion: app.getVersion()
    };
  }
});

// Download update
ipcMain.handle('update:download', async () => {
  try {
    console.log('[MAIN] Downloading update...');
    if (!updateService) {
      return { success: false, error: 'Update service not initialized' };
    }
    const success = await updateService.downloadUpdate();
    return { success };
  } catch (error) {
    console.error('[MAIN] Update download error:', error);
    return { success: false, error: error.message };
  }
});

// Install update
ipcMain.handle('update:install', async () => {
  try {
    console.log('[MAIN] Installing update...');
    if (!updateService) {
      return { success: false, error: 'Update service not initialized' };
    }
    updateService.installUpdate();
    return { success: true };
  } catch (error) {
    console.error('[MAIN] Update install error:', error);
    return { success: false, error: error.message };
  }
});

// Skip update
ipcMain.handle('update:skip', async () => {
  console.log('[MAIN] Skipping update...');
  if (updateService) {
    updateService.skipUpdate();
  }
  return { success: true };
});

// Get update status
ipcMain.handle('update:get-status', async () => {
  if (!updateService) {
    return {
      currentVersion: app.getVersion(),
      updateAvailable: false,
      updateInfo: null,
      downloadProgress: 0,
      updateDownloaded: false
    };
  }
  return updateService.getStatus();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[MAIN] Uncaught exception:', error);
  // In production, log to file or send to backend
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MAIN] Unhandled rejection at:', promise, 'reason:', reason);
  // In production, log to file or send to backend
});

console.log('[MAIN] Main process initialized with IPC bridge');
