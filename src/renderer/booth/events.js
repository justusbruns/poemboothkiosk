import { handleCapture } from './capture.js';
import { handleStyleChange } from './coverflow.js';
import { updateDebugInfo } from '../debug.js';
import { canLocalPrint, cancelPrintHold, isLocalPrintMode, startPrintHold, updatePrinterStatus } from '../result/print.js';
import { returnToBoothFromResult } from '../result/qr.js';
import { triggerGlassWipe } from '../result/transitions.js';
import { showScreen } from '../screens.js';
import { elements, state } from '../state.js';
import { dismissNotification } from '../ui.js';

// =============================================================================
// Hardware Event Listeners
// =============================================================================

export function setupEventListeners() {
  // initializeApp() can run more than once (WiFi retry, re-pairing); the
  // listeners below must only ever be attached once or every button press
  // reaches main twice.
  if (state.eventListenersAttached) {
    console.log('[RENDERER] Hardware event listeners already attached - skipping');
    return;
  }
  state.eventListenersAttached = true;
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
      if (isLocalPrintMode()) {
        // Hold-to-print mode: the button ONLY prints — it never returns to booth early.
        // The result stays up until the countdown timer ends.
        if (canLocalPrint() && !state.isPrinting) {
          console.log('[HARDWARE] Starting print hold on result screen');
          startPrintHold();
        } else {
          console.log('[HARDWARE] Print busy or max reached - staying on result until timer ends');
        }
      } else {
        // Paid mode / no printer: button returns to booth for the next guest
        console.log('[HARDWARE] Button on result screen - returning to booth');
        returnToBoothFromResult();
      }
    } else {
      console.log('[HARDWARE] Ignoring button press - wrong screen or already processing');
    }
  });

  // Hardware button release - cancel an in-progress print hold, or retry from error screen
  window.electronAPI.onButtonRelease((data) => {
    console.log('[HARDWARE] Button release event received:', data, 'printHoldStart:', !!state.printHoldStart, 'isPrinting:', state.isPrinting);

    // Released before the 2s hold completed → cancel the print hold and stay on the result
    if (state.printHoldStart && !state.isPrinting) {
      console.log('[HARDWARE] Cancelling print hold on button release');
      cancelPrintHold();
      return;
    }

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

      // Enter/P on result screen - hold to print (free mode + printer) or return to booth
      if ((e.code === 'Enter' || e.code === 'KeyP') && state.screen === 'result' && !e.repeat) {
        e.preventDefault();
        if (isLocalPrintMode()) {
          // Hold-to-print mode: only print; never return to booth early (wait for timer)
          if (canLocalPrint() && !state.isPrinting) {
            console.log('[DEV] Enter/P on result - starting print hold');
            startPrintHold();
          } else {
            console.log('[DEV] Print busy or max reached - staying on result until timer ends');
          }
        } else {
          console.log('[DEV] Enter/P on result - returning to booth');
          returnToBoothFromResult();
        }
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

    // Enter/P release on result screen - cancel print hold (released before 2s)
    document.addEventListener('keyup', (e) => {
      if ((e.code === 'Enter' || e.code === 'KeyP') && state.screen === 'result') {
        e.preventDefault();
        cancelPrintHold();
      }
    });

  }
}
