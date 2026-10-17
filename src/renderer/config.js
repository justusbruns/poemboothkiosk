import { updatePriceBadge, updateTermsNotice } from './booth/badges.js';
import { applyCameraRotation } from './booth/camera.js';
import { buildStyleCoverflow } from './booth/coverflow.js';
import { applyBookingWifi } from './setup/wifi.js';
import { elements, state } from './state.js';
import { updateOutOfService } from './outOfService.js';
import { updateClosed } from './closed.js';
import { refreshBoothBrand } from './booth/brand.js';
import { loadTranslations } from './translations/index.js';
import { updateUIText } from './app.js';

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
    // (also not while a guest picks a retake style or takes a paid new photo:
    // rebuilding the style row would drop the 'keep your portrait' card)
    if (state.screen !== 'booth' || state.isProcessing || state.retakeMode || state.prepaidRetake) {
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
        state.availableStyles = newConfig.style_configs.map(sc => ({ ...sc.poem_style, style_type: sc.poem_style.style_type || sc.style_type || 'poem' }));
        console.log('[CONFIG] Updated poetry styles:', state.availableStyles.map(s => s.name).join(', '));

        // Keep the current index in range
        if (state.currentStyleIndex >= state.availableStyles.length) {
          state.currentStyleIndex = 0;
        }

        // The 'turn the knob' line under the row stays hidden (see coverflow.js)

        // Rebuild the coverflow cards with the new styles
        if (stylesChanged) buildStyleCoverflow();
      }

      // Language of the booth changed: all texts follow at once
      if (newConfig.kiosk_language && newConfig.kiosk_language !== oldConfig.kiosk_language) {
        console.log('[CONFIG] Language changed:', oldConfig.kiosk_language, '→', newConfig.kiosk_language);
        loadTranslations(newConfig.kiosk_language);
        updateUIText();
        buildStyleCoverflow(); // card labels ('Original') in the new language
      }

      // Branding at the top of the booth (hub logo / white label) can change live
      if (JSON.stringify(oldConfig.hub_branding) !== JSON.stringify(newConfig.hub_branding) ||
          oldConfig.branding_enabled !== newConfig.branding_enabled) {
        console.log('[CONFIG] Booth branding changed');
        refreshBoothBrand();
      }

      // Update terms notice (enabled flag / content can change live)
      updateTermsNotice();

      // Update the price badge (payment config can change live)
      updatePriceBadge();

      // Log other config changes
      if (oldConfig.printing_enabled !== newConfig.printing_enabled) {
        console.log('[CONFIG] Printing enabled changed:', oldConfig.printing_enabled, '=>', newConfig.printing_enabled);
      }

      updateOutOfService();
      updateClosed(); // opening hours may have changed
      console.log('[CONFIG] Config updates applied successfully');
    } else {
      console.log('[CONFIG] No config changes detected');
    }
  } catch (error) {
    console.error('[CONFIG] Error checking for config updates:', error);
    // Don't throw - just log and continue
  }
}
