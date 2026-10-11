import { checkForConfigUpdates } from './config.js';
import { wakeOrderPolling } from './orders.js';
import { state } from './state.js';

// =============================================================================
// Realtime pokes + remote commands (renderer side)
// -----------------------------------------------------------------------------
// The main process forwards pokes from the backend ('order' | 'config') and
// asks before running a remote command (restart app / reboot) whether the
// booth is idle. Nothing here ever interrupts a guest.
// =============================================================================

const IDLE_CHECK_MS = 2000;
const CONFIG_RETRY_MS = 5000;
const CONFIG_RETRY_MAX_MS = 10 * 60 * 1000;

// No guest is mid-session: not paying, generating, looking at a result or printing
export function isBoothIdle() {
  const busyScreens = ['paywall', 'processing', 'result'];
  // A guest choosing a free retake style, or about to take a new photo for an
  // already paid order, is on the start screen but very much mid-session.
  return !busyScreens.includes(state.screen) &&
    !state.isProcessing && !state.isPrinting && !state.isCapturing && !state.glassWiping &&
    !state.retakeMode && !state.prepaidRetake;
}

let configTimer = null;
let configWaitingSince = 0;

// Config changed on the backend: apply it now, or as soon as the booth is idle
// (checkForConfigUpdates itself only applies on an idle booth screen).
function scheduleConfigCheck() {
  if (configTimer) return; // already scheduled
  configWaitingSince = configWaitingSince || Date.now();
  const attempt = () => {
    configTimer = null;
    const idleOnBooth = state.screen === 'booth' && !state.isProcessing;
    if (idleOnBooth) {
      configWaitingSince = 0;
      checkForConfigUpdates();
      return;
    }
    if (Date.now() - configWaitingSince > CONFIG_RETRY_MAX_MS) {
      configWaitingSince = 0; // give up; the 2-minute poll picks it up
      return;
    }
    configTimer = setTimeout(attempt, CONFIG_RETRY_MS);
  };
  configTimer = setTimeout(attempt, 800); // small debounce: edits often come in bursts
}

export function setupRemoteHandlers() {
  if (!window.electronAPI.onPoke) return;

  window.electronAPI.onPoke((reason) => {
    console.log('[REMOTE] Poke:', reason);
    if (reason === 'order') wakeOrderPolling();
    else if (reason === 'config') scheduleConfigCheck();
  });

  window.electronAPI.onCommandRequest((cmd) => {
    console.log(`[REMOTE] Command ${cmd.type} requested - waiting until the booth is idle`);
    const check = () => {
      if (isBoothIdle()) {
        console.log(`[REMOTE] Booth idle - running ${cmd.type}`);
        window.electronAPI.commandReady(cmd.id);
      } else {
        setTimeout(check, IDLE_CHECK_MS);
      }
    };
    check();
  });
}
