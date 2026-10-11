import { t } from './translations/index.js';
import { formatPrice, getCurrency, getTierPriceCents, getTierQuantities } from './booth/badges.js';
import { processPhoto } from './generate.js';
import { cancelOrder, createOrder, OrderError, waitForOrder } from './orders.js';
import { hidePayQr, renderPayQr } from './payqr.js';
import { showScreen } from './screens.js';
import { elements, screens, state } from './state.js';
import { showNotification } from './ui.js';

// =============================================================================
// Paywall (pay-first flow, phase 3)
// -----------------------------------------------------------------------------
// The fresh photo fills the screen with energy building around it. The price of
// one print is on the card terminal; turning the knob adds prints for a group
// (the terminal cannot change an amount, so the pending order is cancelled and
// a new one created, debounced). Once the terminal reports the payment, the
// portrait is generated with the paid order.
// =============================================================================

const POLL_INTERVAL_MS = 750;      // one booth, one terminal: cheap enough
const PAY_TIMEOUT_MS = 90000;      // nobody tapped: back to the booth
const QR_PAY_TIMEOUT_MS = 180000;  // paying by phone (Mollie) takes longer
const QTY_DEBOUNCE_MS = 700;       // knob rest before the terminal amount is replaced
const MAX_AUTO_RETRIES = 2;        // declined / timed-out terminal payments retried silently

let session = null; // { quantity, qtyTimer, abort, retries, done }

function setStatus(text, cls = '') {
  if (!elements.paywallStatus) return;
  elements.paywallStatus.textContent = text || '';
  elements.paywallStatus.className = 'paywall-status' + (cls ? ' ' + cls : '');
}

function renderPrice(quantity) {
  const cents = getTierPriceCents(quantity);
  if (elements.paywallPrice) {
    elements.paywallPrice.textContent = cents ? formatPrice(cents, getCurrency()) : '';
    elements.paywallPrice.classList.remove('bump');
    void elements.paywallPrice.offsetWidth;
    elements.paywallPrice.classList.add('bump');
  }
  if (elements.paywallQty) {
    elements.paywallQty.textContent = quantity === 1 ? t('paywall.onePrint') : t('paywall.nPrints').replace('{count}', String(quantity));
  }
}

// Only show an order's QR / status when it is for the amount on screen and no
// newer knob turn is waiting: otherwise a swap is underway and the screen keeps
// saying "updating the amount".
function showOrderIfCurrent(s, order) {
  if (!s || s.qtyTimer || !order || order.quantity !== s.quantity) return false;
  applyRail(order);
  setStatus(order.provider === 'mollie' ? t('paywall.terminalDown') : t('paywall.waitingTerminal'));
  return true;
}

// Terminal: "tap your card". Terminal unavailable: QR to pay by phone (Mollie).
function applyRail(order) {
  const qr = order && order.provider === 'mollie' && order.payUrl;
  if (qr) {
    renderPayQr(elements.paywallQr, order.payUrl, 220);
    if (elements.paywallTap) elements.paywallTap.textContent = t('paywall.scanToPay');
  } else {
    hidePayQr(elements.paywallQr);
    if (elements.paywallTap) elements.paywallTap.textContent = t('paywall.tap');
  }
}

function applyText() {
  if (elements.paywallTitle) elements.paywallTitle.textContent = t('paywall.title');
  if (elements.paywallTap) elements.paywallTap.textContent = t('paywall.tap');
  if (elements.paywallHint) {
    const multi = getTierQuantities().length > 1;
    elements.paywallHint.textContent = multi ? t('paywall.turnForMore') : '';
  }
}

function abortSession() {
  if (!session) return;
  session.done = true;
  if (session.qtyTimer) clearTimeout(session.qtyTimer);
  if (session.abort) session.abort.abort();
  session = null;
}

// Leave the paywall without a payment (walk-away, failure, terminal missing)
async function bailOut(message) {
  const current = state.order;
  abortSession();
  if (current && current.status === 'pending') cancelOrder(current.id, 'paywall_abandoned');
  state.order = null;
  hidePayQr(elements.paywallQr);
  screens.paywall.classList.remove('charged');
  showNotification(message);
}

export function isOnPaywall() {
  return state.screen === 'paywall' && !!session;
}

// Start the paywall for the photo that was just captured (state.currentPhoto)
export async function startPaywall() {
  abortSession();
  const quantities = getTierQuantities();
  if (!quantities.length) {
    console.error('[PAYWALL] No print tiers configured');
    return bailOut(t('error.terminalUnavailable'));
  }

  session = { quantity: quantities[0], qtyTimer: null, abort: null, retries: 0, done: false };
  state.order = null;

  applyText();
  renderPrice(session.quantity);
  setStatus(t('paywall.waitingTerminal'));
  hidePayQr(elements.paywallQr);
  if (elements.paywallPhoto) elements.paywallPhoto.src = state.currentPhoto || '';
  screens.paywall.classList.remove('charged');
  showScreen('paywall');

  await runPayment();
}

// Create (or re-create) the order for the current quantity and wait for it
async function runPayment() {
  const s = session;
  if (!s || s.done) return;

  if (s.abort) s.abort.abort();
  s.abort = new AbortController();
  const signal = s.abort.signal;
  const quantity = s.quantity;

  let order;
  try {
    s.creating = createOrder('generation', quantity);
    order = await s.creating;
  } catch (e) {
    if (signal.aborted || s.done) return;
    console.error('[PAYWALL] Order create failed:', e.code || e.message);
    const unavailable = e instanceof OrderError && (e.code === 'terminal_unavailable' || e.status === 503);
    return bailOut(unavailable ? t('error.terminalUnavailable') : t('error.paymentFailed'));
  }
  if (signal.aborted || s.done) {
    // Quantity changed (or the guest left) while this order was being created:
    // it is outdated before anyone saw it, so close it right away.
    cancelOrder(order.id, 'superseded');
    return;
  }

  const byPhone = order.provider === 'mollie';
  showOrderIfCurrent(s, order);
  const result = await waitForOrder(order.id, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: byPhone ? QR_PAY_TIMEOUT_MS : PAY_TIMEOUT_MS,
    signal
  });
  if (s.done || signal.aborted || result.status === 'aborted') return;

  switch (result.status) {
    case 'paid':
      return onPaid(result);
    case 'timeout':
      console.log('[PAYWALL] No payment within the time limit');
      return bailOut(t('paywall.timeout'));
    case 'failed':
    case 'cancelled': {
      // Declined card or the terminal gave up waiting: put the amount back on
      // the terminal a couple of times before sending the guest away.
      const declined = result.status === 'failed';
      if (s.retries < MAX_AUTO_RETRIES) {
        s.retries += 1;
        console.log(`[PAYWALL] Payment ${result.status} (${result.failureReason}) — retry ${s.retries}`);
        setStatus(declined ? t('paywall.declined') : t('paywall.retrying'), 'error');
        await new Promise(r => setTimeout(r, 1500));
        if (s.done) return;
        return runPayment();
      }
      return bailOut(declined ? t('paywall.declinedFinal') : t('paywall.timeout'));
    }
    default:
      console.warn('[PAYWALL] Unexpected order status:', result.status);
      return bailOut(t('error.paymentFailed'));
  }
}

async function onPaid(order) {
  const s = session;
  if (!s || s.done) return;
  s.done = true;
  if (s.qtyTimer) clearTimeout(s.qtyTimer);
  state.order = order;
  console.log(`[PAYWALL] Paid: order ${order.id}, ${order.quantity} print(s), ${order.amountCents}c`);

  // Escalate the energy for a beat, then hand over to the generation theater
  setStatus(t('paywall.paid'), 'ok');
  hidePayQr(elements.paywallQr);
  screens.paywall.classList.add('charged');
  await new Promise(r => setTimeout(r, 900));
  session = null;
  screens.paywall.classList.remove('charged');
  await processPhoto({ orderId: order.id });
}

// Knob on the paywall: pick the number of prints. The price updates instantly
// on screen; the terminal amount follows once the knob rests (cancel + new order).
export function handlePaywallKnob(direction) {
  const s = session;
  if (!s || s.done) return;
  const quantities = getTierQuantities();
  if (quantities.length < 2) return;

  const idx = quantities.indexOf(s.quantity);
  const next = direction === 'clockwise'
    ? Math.min(quantities.length - 1, idx + 1)
    : Math.max(0, idx - 1);
  if (quantities[next] === s.quantity) return;

  s.quantity = quantities[next];
  renderPrice(s.quantity);
  setStatus(t('paywall.updatingTerminal'));
  // The QR on screen is for the old amount: take it away at once so nobody
  // scans a link that is about to be replaced.
  hidePayQr(elements.paywallQr);

  if (s.qtyTimer) clearTimeout(s.qtyTimer);
  s.qtyTimer = setTimeout(() => {
    s.qtyTimer = null;
    queueReplace(s);
  }, QTY_DEBOUNCE_MS);
}

// Replace the pending order with one for the current quantity. Replacements
// run strictly one after another (a guest who keeps turning while the previous
// swap is still talking to the backend must not end up with two open orders).
function queueReplace(s) {
  s.replaceChain = (s.replaceChain || Promise.resolve()).then(() => replaceOrder(s)).catch((e) => {
    console.warn('[PAYWALL] Order replace failed:', e && e.message);
  });
}

async function replaceOrder(s) {
  if (s.done) return;
  // Let an order that is still being created finish first, then decide
  if (s.creating) await s.creating.catch(() => {});
  if (s.done || session !== s) return;

  const current = state.order;
  if (current && current.status === 'pending' && current.quantity === s.quantity) {
    showOrderIfCurrent(s, current); // already the right amount (guest turned back and forth)
    return;
  }

  if (s.abort) s.abort.abort(); // stop polling the old order
  if (current && current.status === 'pending') {
    const final = await cancelOrder(current.id, 'quantity_changed');
    // The guest paid just before we cancelled: that order stands, honour it
    // instead of charging again.
    if (final && final.status === 'paid' && !s.done) {
      s.quantity = final.quantity;
      renderPrice(s.quantity);
      return onPaid(final);
    }
  }
  if (s.done || session !== s) return;
  runPayment();                 // creates the new order and starts waiting...
  await s.creating?.catch(() => {}); // ...the next replacement waits for that creation
}

// Dev/operator escape: leave the paywall and cancel any pending order
export function cancelPaywall() {
  if (!session) return;
  bailOut(t('paywall.timeout'));
}
