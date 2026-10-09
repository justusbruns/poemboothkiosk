import { setupBoothBrand } from './booth/brand.js';
import { resumeCameraPreview } from './booth/camera.js';
import { resetStyleCoverflow } from './booth/coverflow.js';
import { cancelTypingAnimation } from './result/poem.js';
import { elements, screens, state } from './state.js';

// Knob/button routing for modal setup screens (update, language). The IPC
// listeners are registered exactly once (see the App Lifecycle section);
// screens claim and release the handlers instead of adding listeners.
export const screenHardware = { knob: null, button: null };
export function claimScreenHardware(onKnob, onButton) {
  screenHardware.knob = onKnob || null;
  screenHardware.button = onButton || null;
}
export function releaseScreenHardware() {
  screenHardware.knob = null;
  screenHardware.button = null;
}

// The encoder (real GPIO and the Pico/keyboard mock alike) reports
// 'clockwise' / 'counterclockwise'; modal screens think in left/right.
export function knobDirection(data) {
  const d = data && data.direction;
  return (d === 'counterclockwise' || d === 'counter-clockwise' || d === 'left') ? 'left' : 'right';
}

export function showScreen(screenName) {
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
      if (screenName === 'booth') state.isCapturing = false;
      updateBoothBrandVisibility();
      if (screenName === 'booth') { resumeCameraPreview(); resetStyleCoverflow(); setupBoothBrand(); updateBoothBrandVisibility(); }
    }, 1000); // Match CSS transition duration
  } else {
    // Normal screen transition
    Object.keys(screens).forEach(key => {
      screens[key].classList.remove('active');
    });

    screens[screenName].classList.add('active');
    state.screen = screenName;
    if (screenName === 'booth') state.isCapturing = false;
    updateBoothBrandVisibility();

    // Reset the style coverflow when returning to the booth (after a capture)
    if (screenName === 'booth') { resumeCameraPreview(); resetStyleCoverflow(); setupBoothBrand(); updateBoothBrandVisibility(); }
  }
}

// Branding (logo + URL) only belongs on the idle booth/home screen — it disappears
// as soon as the countdown/capture starts and stays gone through processing.
export function updateBoothBrandVisibility() {
  if (elements.boothBrand) {
    const show = state.screen === 'booth' && state.showBoothBrand && !state.isCapturing;
    elements.boothBrand.classList.toggle('show', show);
  }
}
