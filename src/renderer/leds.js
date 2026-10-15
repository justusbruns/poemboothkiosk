// Booth LEDs: tell the main process which step of the guest flow is on.
// The colours per step live in src/services/ledPhases.js; without a WLED
// controller on USB this does nothing.

import { state } from './state.js';

const SCREEN_PHASES = {
  booth: 'idle',
  paywall: 'paywall',
  processing: 'processing',
  result: 'reveal',
  error: 'error'
  // loading, update, wifi, language, pairing → 'setup'
};

export function setLedPhase(phase) {
  try {
    if (window.electronAPI && window.electronAPI.ledPhase) window.electronAPI.ledPhase(phase);
  } catch (e) { /* LEDs are never in the way of the guest */ }
}

export function setLedPhaseForScreen(screenName) {
  // Picking a retake style happens on the booth screen, but the portrait is still "on"
  if (screenName === 'booth' && state.retakeMode) return setLedPhase('reveal');
  setLedPhase(SCREEN_PHASES[screenName] || 'setup');
}
