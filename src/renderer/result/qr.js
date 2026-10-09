import { isPaidPrintActive, isTerminalPayMode } from '../booth/badges.js';
import { resetPrintCircleIdle, updatePrintContainerVisibility } from './print.js';
import { enterTerminalResult } from './terminal.js';
import { triggerGlassWipe } from './transitions.js';
import { updateResultActionLabel, updateResultPaymentUI } from './ui.js';
import { elements, state } from '../state.js';

export function showQRCode(publicViewUrl) {
  console.log('[RENDERER] Showing QR code for:', publicViewUrl);

  // Fresh print allowance for this result, and a clean idle print circle
  // (pay-first: what was paid on the terminal; set in enterTerminalResult)
  state.printsRemaining = state.maxPrints;
  resetPrintCircleIdle();

  // Generate styled QR code using qr-code-styling library
  if (typeof QRCodeStyling !== 'undefined') {
    try {
      // Clear any existing QR code
      elements.resultQr.innerHTML = '';

      // Create styled QR code
      const qrCode = new QRCodeStyling({
        type: "canvas",
        shape: "square",
        width: 220,
        height: 220,
        data: publicViewUrl,
        margin: 0,
        qrOptions: {
          typeNumber: "0",
          mode: "Byte",
          // Lower error correction → fewer, larger modules → a cleaner, simpler,
          // easier-to-scan code (the white circle around it is the quiet zone).
          errorCorrectionLevel: "L"
        },
        imageOptions: {
          saveAsBlob: true,
          hideBackgroundDots: false,
          imageSize: 0.4,
          margin: 0
        },
        dotsOptions: {
          type: "rounded",
          color: "#000000",
          roundSize: true
        },
        // Transparent background so the QR sits cleanly on the white circle and never
        // covers the countdown ring at the corners.
        backgroundOptions: {
          round: 0,
          color: "transparent"
        },
        image: null,
        cornersSquareOptions: {
          type: "extra-rounded",
          color: "#000000"
        },
        cornersDotOptions: {
          type: "dot",
          color: "#000000"
        }
      });

      // Append QR code to container
      qrCode.append(elements.resultQr);

      console.log('[QR] Styled QR code generated successfully');

      // Show QR circle with pop animation after QR code is generated
      const qrCircle = document.getElementById('qr-circle');
      const printCircle = document.getElementById('print-circle');

      setTimeout(() => {
        if (qrCircle) {
          qrCircle.classList.add('show');
        }
        // Pop the hold-to-print circle in at the SAME time as the QR (if it's available;
        // updatePrintContainerVisibility() set its display just before this fires)
        if (printCircle && elements.printContainer && elements.printContainer.style.display !== 'none') {
          printCircle.classList.add('show');
        }
      }, 100);
    } catch (error) {
      console.error('[QR] Generation error:', error);
    }
  } else {
    console.error('[QR] QR Code Styling library not loaded');
  }

  // Adapt the QR label to the printer state (print & save vs save)
  updateResultActionLabel();

  // Show/hide the hold-to-print circle (free mode + printer)
  updatePrintContainerVisibility();

  // Paid-mode extras: watermark over the image + pulsing attention glow
  updateResultPaymentUI();

  if (isTerminalPayMode() && state.order) {
    // Pay-first: print/retake/upsell phases drive the timer from here on
    enterTerminalResult();
    return;
  }

  // Start countdown timer (longer in paid mode)
  start30SecondTimer();
}

// Default auto-return countdown: pay-to-print (portal) gives guests more time to
// scan, pay, save and print; otherwise 30s.
export function start30SecondTimer() {
  startResultTimer(isPaidPrintActive() ? 60000 : 30000);
}

// Countdown ring on the QR circle; wipes back to the booth when it runs out.
// Restartable: a running countdown is replaced by the new one.
export function startResultTimer(TIMER_DURATION) {
  cancelResultTimer();
  const circumference = 440; // Match CSS stroke-dasharray value (r=70px)
  let startTime = Date.now();

  // Interpolate color from green → yellow → red based on progress (1→0)
  function getCountdownColor(progress) {
    // progress: 1 = full time, 0 = expired
    // green (120°) → yellow (60°) → red (0°)
    const hue = progress * 120; // 120 at start, 0 at end
    return `hsl(${hue}, 80%, 55%)`;
  }

  // Animate the timer circle
  function updateTimer() {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, TIMER_DURATION - elapsed);
    const linearProgress = Math.min(1, elapsed / TIMER_DURATION); // 0→1 as time passes

    // Linear progress - no easing so the timer completes exactly when time runs out
    const offset = circumference * (1 - linearProgress);
    elements.timerCircle.style.strokeDashoffset = offset;

    // Update color based on time remaining (1→0)
    const timeProgress = remaining / TIMER_DURATION;
    elements.timerCircle.style.stroke = getCountdownColor(timeProgress);

    if (remaining > 0) {
      state.timerAnimationFrame = requestAnimationFrame(updateTimer);
    } else {
      // Timer expired - check if a print (or a terminal payment) is in progress
      const busy = () => state.printHoldStart || state.isPrinting || state.terminalBusy || state.resultPhase === 'printing';
      if (busy()) {
        console.log('[RENDERER] Countdown expired but print/payment in progress - waiting...');
        // Keep checking until it completes
        state.timerAnimationFrame = requestAnimationFrame(() => {
          if (!busy()) {
            console.log('[RENDERER] Print complete - now triggering glass wipe');
            state.timerAnimationFrame = null;
            triggerGlassWipe();
          } else {
            // Still printing, continue waiting
            updateTimer();
          }
        });
      } else {
        // No print in progress - trigger glass wipe animation
        state.timerAnimationFrame = null;
        triggerGlassWipe();
      }
    }
  }

  updateTimer();
}

// Cancel the auto-return timer (e.g., when user starts printing)
export function cancelResultTimer() {
  if (state.timerAnimationFrame) {
    console.log('[RENDERER] Cancelling auto-return timer');
    cancelAnimationFrame(state.timerAnimationFrame);
    state.timerAnimationFrame = null;
  }
}
export const cancel30SecondTimer = cancelResultTimer;

// Cancel the auto-return timer and wipe back to the booth for the next guest.
export function returnToBoothFromResult() {
  cancel30SecondTimer();
  triggerGlassWipe();
}

// Glass wipe animation - return to booth screen
// Wipe-out transition: 108 frames @ 24fps = 4.5s native; played at WIPE_SPEED.
