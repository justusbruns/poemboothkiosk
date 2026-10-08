import { t } from '../translations/index.js';
import { formatPrice, getFirstPrintPriceCents, isPaidPrintActive } from '../booth/badges.js';
import { applyCameraRotation } from '../booth/camera.js';
import { elements, state } from '../state.js';

// printer is available the QR does both — otherwise it only offers save.
export function updateResultActionLabel() {
  if (!elements.qrLabel) return;

  const pay = state.kioskConfig && state.kioskConfig.payment;

  // Pay-to-print: a stronger call-to-action with the price ("Print for just €4 / Scan the QR code now")
  if (isPaidPrintActive()) {
    const cents = getFirstPrintPriceCents();
    const priceLabel = (cents && cents > 0) ? formatPrice(cents, pay && pay.currency) : '';
    const line1 = priceLabel
      ? `${t('result.printForJust')} ${priceLabel}`
      : t('result.scanToPrintAndSave');
    elements.qrLabel.innerHTML = `${line1}<br/>${t('result.scanQrNow')}`;
    return;
  }

  // Free: the QR saves the photo to the guest's phone. Only mention printing when the
  // PORTAL can print (printing enabled in config) — local hold-to-print uses the
  // physical button, not the QR. Otherwise it's simply "scan to save".
  const printerAttached = state.printerStatus && state.printerStatus.available &&
    (state.printerStatus.status === 'ready' || state.printerStatus.status === 'printing');
  const portalCanPrint = !!(pay && pay.print_enabled) && printerAttached;
  elements.qrLabel.innerHTML = portalCanPrint
    ? t('result.scanToPrintAndSave')
    : t('result.scanToSave');
}

// Watermark over the result — only on generated images when pay-to-print is active
// (never on poems, and not when printing is free). Paid downloads don't add it.
export function updateResultPaymentUI() {
  const paid = isPaidPrintActive();
  const overlay = elements.poemText && elements.poemText.parentElement;
  const isImage = overlay && overlay.classList.contains('image-display');

  if (elements.resultWatermark) {
    elements.resultWatermark.style.display = (paid && isImage) ? 'flex' : 'none';
  }
}

// Show the live, blurred camera feed as the result background (for generated images)
export function showResultCameraBackground() {
  if (!elements.resultCamera) return;
  if (state.cameraStream && elements.resultCamera.srcObject !== state.cameraStream) {
    elements.resultCamera.srcObject = state.cameraStream;
  }
  // (Re)start playback — the previous wipe-out paused it when freezing the frame
  if (elements.resultCamera.srcObject && elements.resultCamera.paused) {
    const p = elements.resultCamera.play && elements.resultCamera.play();
    if (p && p.catch) p.catch(() => {});
  }
  elements.resultCamera.style.display = 'block';
  // Match the booth camera's rotation + mirroring (extra zoom hides the blurred edges)
  applyCameraRotation(elements.resultCamera, 1.12);
}

export function hideResultCameraBackground() {
  if (elements.resultCamera) elements.resultCamera.style.display = 'none';
}
