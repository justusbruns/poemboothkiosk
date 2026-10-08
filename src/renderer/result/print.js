import { isPaidPrintActive } from '../booth/badges.js';
import { updateResultActionLabel } from './ui.js';
import { elements, state } from '../state.js';

// screen is print-oriented — the button only prints and never returns to booth early.
export function isLocalPrintMode() {
  return !isPaidPrintActive() &&
    state.printerStatus && state.printerStatus.available &&
    (state.printerStatus.status === 'ready' || state.printerStatus.status === 'printing');
}

// Whether the kiosk's own attached printer can print *right now*: hold-to-print mode
// AND the guest hasn't used up the allowed prints for this photo.
export function canLocalPrint() {
  return isLocalPrintMode() && state.printsRemaining > 0;
}

// Show/hide the hold-to-print circle: only when pay-to-print is off and a printer
// is connected. The circle must pop in *together with* the QR, so we only add the
// `show` (pop) class once the QR circle is already shown — the synchronized first
// pop is done in showQRCode(); here it only catches later printer-status changes.
export function updatePrintContainerVisibility() {
  if (!elements.printContainer) return;
  const available = isLocalPrintMode();
  elements.printContainer.style.display = available ? 'flex' : 'none';
  const printCircle = document.getElementById('print-circle');
  if (printCircle) {
    const qrShown = document.getElementById('qr-circle')?.classList.contains('show');
    if (available && state.screen === 'result' && qrShown) printCircle.classList.add('show');
    else if (!available) printCircle.classList.remove('show');
  }
}

// Reset the print circle to its idle "ready to hold" state (printer icon, empty ring).
export function resetPrintCircleIdle() {
  if (elements.printDoneIcon) {
    elements.printDoneIcon.classList.remove('show');
    elements.printDoneIcon.style.display = 'none';
  }
  if (elements.printIcon) {
    elements.printIcon.style.display = 'flex';
  }
  if (elements.printProgress) {
    const circumference = 440; // Match CSS stroke-dasharray value (r=70px)
    elements.printProgress.style.transition = 'none';
    elements.printProgress.style.strokeDashoffset = circumference; // empty
    void elements.printProgress.offsetWidth; // force reflow
    elements.printProgress.style.transition = 'stroke-dashoffset 0.05s linear';
  }
}

// Start the 2-second print hold (matches MockHardwareService.longPressThreshold).
export function startPrintHold() {
  if (state.printHoldStart) return; // already holding

  console.log('[RENDERER] Starting print hold...');

  // Keep the auto-return countdown running (don't cancel it). If it expires mid-print,
  // the timer logic waits for the print to finish before doing the glass wipe.

  state.printHoldStart = Date.now();

  const HOLD_DURATION = 2000; // 2s (must match MockHardwareService.longPressThreshold)
  const circumference = 440;

  // INSTANT FEEDBACK: start the ring from empty
  elements.printProgress.style.transition = 'none';
  elements.printProgress.style.strokeDashoffset = circumference;
  void elements.printProgress.offsetWidth; // force reflow
  elements.printProgress.style.transition = 'stroke-dashoffset 0.05s linear';

  function updatePrintProgress() {
    if (!state.printHoldStart) return; // cancelled

    const elapsed = Date.now() - state.printHoldStart;
    const progress = Math.min(1, elapsed / HOLD_DURATION);
    elements.printProgress.style.strokeDashoffset = circumference * (1 - progress);

    if (progress >= 1) {
      completePrintHold();
    } else {
      state.printHoldInterval = requestAnimationFrame(updatePrintProgress);
    }
  }

  requestAnimationFrame(updatePrintProgress);
}

// Cancel an in-progress print hold (button released before 2s).
export function cancelPrintHold() {
  if (!state.printHoldStart) return;

  console.log('[RENDERER] Cancelling print hold');
  state.printHoldStart = null;

  if (state.printHoldInterval) {
    cancelAnimationFrame(state.printHoldInterval);
    state.printHoldInterval = null;
  }

  // SNAP-BACK: quick transition back to empty
  const circumference = 440;
  elements.printProgress.style.transition = 'stroke-dashoffset 0.2s ease-out';
  elements.printProgress.style.strokeDashoffset = circumference;
  setTimeout(() => {
    elements.printProgress.style.transition = 'stroke-dashoffset 0.05s linear';
  }, 200);

  // The auto-return countdown was never paused, so there's nothing to resume here.
}

// Hold completed - fire the print (which first asks the backend for permission).
export async function completePrintHold() {
  console.log('[RENDERER] Print hold complete');

  state.printHoldStart = null;
  if (state.printHoldInterval) {
    cancelAnimationFrame(state.printHoldInterval);
    state.printHoldInterval = null;
  }

  await handlePrint();
}

export async function handlePrint() {
  console.log('[RENDERER] ===== PRINT REQUEST STARTED =====');
  console.log('[RENDERER] Session ID:', state.currentSession?.id, 'prints remaining:', state.printsRemaining);

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
      resetPrintCircleIdle();
      state.isPrinting = false;
      return;
    }
    if (!state.currentPrintBuffer && !state.currentPrintUrl) {
      console.error('[RENDERER] ❌ No print image available (no local buffer, no backend asset)');
      updatePrinterStatus({ available: false, status: 'error', message: 'No image to print' });
      resetPrintCircleIdle();
      state.isPrinting = false;
      return;
    }

    // Register the print with the backend FIRST. It writes the print_jobs row and
    // enforces the per-photo max: logged === true → allowed, logged === false → max
    // reached (don't print). A missing/old endpoint or network error returns no
    // `logged` field → we fall back to allowing the print so it still works offline.
    let logged = true;
    try {
      const res = await window.electronAPI.apiLogPrint(state.currentSession.id);
      if (res && res.logged === false) logged = false;
      console.log('[RENDERER] Print register result:', JSON.stringify(res));
    } catch (logError) {
      console.warn('[RENDERER] ⚠️ Print register call failed (allowing print):', logError);
    }

    if (!logged) {
      console.log('[RENDERER] Max prints reached (server) — not printing');
      state.printsRemaining = 0; // lock out further holds
      resetPrintCircleIdle();
      updatePrintContainerVisibility();
      state.isPrinting = false;
      return;
    }

    const printerStatus = await window.electronAPI.printerGetStatus();
    if (!printerStatus.available) {
      console.error('[RENDERER] ❌ Printer not available');
      updatePrinterStatus(printerStatus);
      resetPrintCircleIdle();
      state.isPrinting = false;
      return;
    }

    // Allowed → send the print. Keep the printer icon while it prints; we only show
    // the checkmark *after* it succeeds (a checkmark mid-print would imply "done").
    updatePrinterStatus({ available: true, status: 'printing', message: 'Printing...' });

    const printOptions = {
      printFormat: state.currentPrintFormat,
      printOrientation: state.currentPrintOrientation
    };
    // Poems: backend-rendered print asset (prefetched by main when the render
    // event arrived). Image styles still carry their buffer locally.
    const result = state.currentPrintUrl
      ? await window.electronAPI.printerPrintSession(state.currentSession.id, state.currentPrintUrl, printOptions)
      : await window.electronAPI.printerPrint(state.currentPrintBuffer, printOptions);
    console.log('[RENDERER] Print IPC returned:', JSON.stringify(result));

    if (result.success) {
      console.log('[RENDERER] ✅ Print job completed successfully');
      state.printsRemaining = Math.max(0, state.printsRemaining - 1);

      // Brief "sent" checkmark as confirmation
      if (elements.printIcon) elements.printIcon.style.display = 'none';
      if (elements.printDoneIcon) {
        elements.printDoneIcon.style.display = 'flex';
        setTimeout(() => elements.printDoneIcon.classList.add('show'), 50);
      }

      // Refresh printer status after a moment
      setTimeout(async () => {
        const status = await window.electronAPI.printerGetStatus();
        updatePrinterStatus(status);
      }, 2000);

      state.isPrinting = false;

      if (state.printsRemaining > 0) {
        // More prints allowed → after a short confirmation, snap back to the printer
        // icon so it's clear the guest can still print again
        console.log('[RENDERER] Prints remaining:', state.printsRemaining, '- back to printer icon for another print');
        setTimeout(() => {
          if (state.screen === 'result') resetPrintCircleIdle();
        }, 900);
      }
      // else: no prints left — leave the checkmark showing (done)
      // The countdown kept running throughout — don't restart it. If it already
      // expired during this print, the timer logic does the glass wipe now.
    } else {
      console.error('[RENDERER] ❌ Print job FAILED:', result.error);
      updatePrinterStatus({ available: false, status: 'error', message: result.error || 'Print failed' });
      resetPrintCircleIdle();
      state.isPrinting = false;
    }
  } catch (error) {
    console.error('[RENDERER] ❌ Print exception:', error);
    updatePrinterStatus({ available: false, status: 'error', message: error.message });
    resetPrintCircleIdle();
    state.isPrinting = false;
  }
}

// Update printer status display
export function updatePrinterStatus(status) {
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

  // Keep the QR action label + hold-to-print circle in sync with the live printer
  // status on the result screen. Don't disturb the circle mid-print/mid-hold.
  if (state.screen === 'result') {
    updateResultActionLabel();
    if (!state.isPrinting && !state.printHoldStart) {
      updatePrintContainerVisibility();
    }
  }
}
