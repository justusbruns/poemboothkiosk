import { updatePriceBadge, updateTermsNotice } from './booth/badges.js';
import { applyCameraRotation } from './booth/camera.js';
import { buildStyleCoverflow } from './booth/coverflow.js';
import { applyBookingWifi } from './setup/wifi.js';
import { elements, state } from './state.js';

// =============================================================================
// Config Polling (Auto-update configs from backend)
// =============================================================================

// config polling interval handle lives on state.configPollingInterval (shared with the pairing flow)

/**
 * Start periodic config polling to auto-update from backend
 * Checks every 2 minutes for config changes
 */
export function startConfigPolling() {
  const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

  console.log('[CONFIG] Starting config polling (every 2 minutes)');

  // Poll immediately on start (after initial delay)
  setTimeout(checkForConfigUpdates, 10000); // Check after 10 seconds

  // Then poll every 2 minutes
  state.configPollingInterval = setInterval(checkForConfigUpdates, POLL_INTERVAL);
}

/**
 * Check for config updates from backend
 */
export async function checkForConfigUpdates() {
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
