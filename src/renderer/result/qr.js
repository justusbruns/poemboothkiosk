import { isPaidPrintActive } from '../booth/badges.js';
import { resetPrintCircleIdle, updatePrintContainerVisibility } from './print.js';
import { triggerGlassWipe } from './transitions.js';
import { updateResultActionLabel, updateResultPaymentUI } from './ui.js';
import { elements, state } from '../state.js';

export function showQRCode(publicViewUrl) {
  console.log('[RENDERER] Showing QR code for:', publicViewUrl);

  // Fresh print allowance for this result, and a clean idle print circle
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

  // Start countdown timer (longer in paid mode)
  start30SecondTimer();
}

// 30-second countdown with glass wipe animation
export function start30SecondTimer() {
  // Pay-to-print gives guests more time to scan, pay, save and print; otherwise 30s
  const TIMER_DURATION = isPaidPrintActive() ? 60000 : 30000; // 60s when paying to print, else 30s
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
      // Timer expired - check if print is in progress
      if (state.printHoldStart || state.isPrinting) {
        console.log('[RENDERER] Countdown expired but print in progress - waiting...');
        // Keep checking until print completes
        state.timerAnimationFrame = requestAnimationFrame(() => {
          if (!state.printHoldStart && !state.isPrinting) {
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

// Cancel 30-second timer (e.g., when user starts printing)
export function cancel30SecondTimer() {
  if (state.timerAnimationFrame) {
    console.log('[RENDERER] Cancelling 30-second auto-return timer');
    cancelAnimationFrame(state.timerAnimationFrame);
    state.timerAnimationFrame = null;
  }
}

// Cancel the auto-return timer and wipe back to the booth for the next guest.
export function returnToBoothFromResult() {
  cancel30SecondTimer();
  triggerGlassWipe();
}

// Glass wipe animation - return to booth screen
// Wipe-out transition: 108 frames @ 24fps = 4.5s native; played at WIPE_SPEED.
