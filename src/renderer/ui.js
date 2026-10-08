import { destroyLottieAnimation } from './lottie.js';
import { showScreen } from './screens.js';
import { elements, state } from './state.js';

// e.g. "1920×1080 @ 30fps", or "unknown" before the camera is up
export function formatCameraResolution() {
  const r = state.cameraResolution;
  if (!r || !r.width) return 'unknown';
  return `${r.width}×${r.height}${r.fps ? ` @ ${r.fps}fps` : ''}`;
}

export function updateStatus(screen, message) {
  if (screen === 'loading') {
    elements.loadingStatus.textContent = message;
  }
  console.log(`[${screen.toUpperCase()}] ${message}`);
}

export function updateProgress(message, percent) {
  // New design: processing screen shows photo with spinner only (no text/progress bar)
  // Just log for debugging
  console.log(`[PROGRESS] ${message} (${percent}%)`);
}

export function showError(title, message, error) {
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
export let notificationTimeout = null;

/**
 * Show friendly notification and return to booth screen
 * @param {string} message - Translated notification message
 * @param {number} duration - Display duration in milliseconds (default: 6000)
 */
export function showNotification(message, duration = 6000) {
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
export function dismissNotification() {
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

// =============================================================================
// Utilities
// =============================================================================

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
