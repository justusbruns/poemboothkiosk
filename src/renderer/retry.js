import { t } from './translations/index.js';
import { showScreen } from './screens.js';
import { elements, state } from './state.js';
import { showNotification } from './ui.js';

// =============================================================================
// Paid generation failed (pay-first flow)
// -----------------------------------------------------------------------------
// The guest already paid, so a failed generation never ends in "sorry":
//   1. retry once with the same photo (most failures are transient),
//   2. then explain why and ask for a new photo (no new payment; the guest can
//      also pick another style with the knob),
//   3. only when that fails too, or the guest walks away, ask the backend for
//      a refund and say honestly whether the money is back already.
// The backend gives every failed attempt back to the order
// ('order_attempt_released'); without that (cap reached) we go to step 3.
// =============================================================================

const NEW_PHOTO_TIMEOUT_MS = 90000;
let newPhotoTimer = null;

export function hasPrepaidRetake() {
  return !!state.prepaidRetake;
}

// Called by processPhoto when a generation on a paid order failed.
// opts: the processPhoto opts of the failed attempt; reason: backend error code.
export async function handlePaidGenerationFailure(opts, reason) {
  const g = state.generate || {};
  const orderId = opts.orderId;

  if (g.attemptReleased === false) {
    console.warn('[RETRY] Backend did not give the attempt back (cap reached) - refunding');
    return giveUp(orderId);
  }
  if (!opts.retriedSamePhoto) {
    console.log(`[RETRY] Generation failed (${reason || 'unknown'}) - retrying once with the same photo`);
    const { processPhoto } = await import('./generate.js');
    if (elements.loadingStatusText) elements.loadingStatusText.textContent = t('retry.retrying');
    return processPhoto({ ...opts, retriedSamePhoto: true });
  }
  if (!opts.newPhoto) {
    return offerNewPhoto(orderId, reason);
  }
  console.warn('[RETRY] The new photo failed as well - refunding');
  return giveUp(orderId);
}

// Back to the booth with a banner: why it failed, and "press for a new photo,
// you have already paid". The knob still picks a style.
function offerNewPhoto(orderId, reason) {
  const blocked = reason === 'content_blocked';
  state.prepaidRetake = { orderId, reason, at: Date.now() };
  if (elements.prepaidTitle) elements.prepaidTitle.textContent = t(blocked ? 'retry.blockedTitle' : 'retry.errorTitle');
  if (elements.prepaidBody) elements.prepaidBody.textContent = t(blocked ? 'retry.blockedBody' : 'retry.errorBody');
  if (elements.prepaidCta) elements.prepaidCta.textContent = t('retry.cta');
  showScreen('booth');
  if (elements.prepaidBanner) elements.prepaidBanner.style.display = 'block';
  console.log(`[RETRY] Asking for a new photo (reason: ${reason || 'unknown'})`);

  if (newPhotoTimer) clearTimeout(newPhotoTimer);
  newPhotoTimer = setTimeout(() => {
    newPhotoTimer = null;
    // Still waiting for that new photo and nobody started one: refund
    if (state.prepaidRetake && state.prepaidRetake.orderId === orderId && !state.isProcessing) {
      console.log('[RETRY] No new photo taken - refunding');
      giveUp(orderId);
    }
  }, NEW_PHOTO_TIMEOUT_MS);
}

// The guest pressed the button on the booth: take the prepaid retake (if any)
export function takePrepaidRetake() {
  const p = state.prepaidRetake;
  clearPrepaidRetake();
  return p;
}

export function clearPrepaidRetake() {
  state.prepaidRetake = null;
  if (newPhotoTimer) { clearTimeout(newPhotoTimer); newPhotoTimer = null; }
  if (elements.prepaidBanner) elements.prepaidBanner.style.display = 'none';
}

async function giveUp(orderId) {
  clearPrepaidRetake();
  let refunded = true;
  let delivered = false;
  try {
    const res = await window.electronAPI.orderRefund(orderId, 'generation_failed');
    if (res && res.refunded === false) refunded = false;
    // The order already gave the guest a portrait (a failed free retake):
    // nothing is refunded, the first portrait and its prints stay theirs.
    if (res && /409|portrait_delivered/.test(String(res.message || res.error || ''))) delivered = true;
    console.log('[RETRY] Refund result:', JSON.stringify(res));
  } catch (e) {
    console.error('[RETRY] Refund request failed:', e.message);
    refunded = false;
  }
  state.order = null;
  showNotification(t(delivered ? 'retry.retakeFailed'
    : refunded ? 'error.generationFailedRefund' : 'error.generationFailedManualRefund'));
}
