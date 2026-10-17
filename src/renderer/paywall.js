import { t } from './translations/index.js';
import { formatPrice, getCurrency, getTierPriceCents, getTierQuantities } from './booth/badges.js';
import { processPhoto } from './generate.js';
import { cancelOrder, createOrder, OrderError, waitForOrder } from './orders.js';
import { hidePayQr, renderPayQr, showPayQrLoading } from './payqr.js';
import { showScreen } from './screens.js';
import { elements, screens, state } from './state.js';
import { showNotification } from './ui.js';
import { setLedPhase } from './leds.js';
import { createCarousel } from './carousel.js';
import { createStarfield } from './starfield.js';

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
const PAID_MOMENT_MS = 5000;
const QR_SIZE = 170;               // inside the chosen price card: the photo stays visible       // "Paid!" stays this long; the portrait is already being made

let session = null; // { quantity, qtyTimer, abort, retries, done }
let carousel = null; // price cards (number of prints)
let stars = null;    // stars flying towards the guest

function setStatus(text, cls = '') {
  if (!elements.paywallStatus) return;
  elements.paywallStatus.textContent = text || '';
  elements.paywallStatus.className = 'paywall-status' + (cls ? ' ' + cls : '');
}

function printsLabel(quantity) {
  return quantity === 1 ? t('paywall.onePrint') : t('paywall.nPrints').replace('{count}', String(quantity));
}

// One price card: the price per photo big (with the single-print price struck
// through when it is cheaper), the total underneath so it is always clear
// what will be charged.
export function buildPriceCard(quantity, totalCents, singleCents) {
  const currency = getCurrency();
  const per = totalCents ? Math.round(totalCents / quantity) : null;
  const card = document.createElement('div');
  card.className = 'price-card';
  const qty = document.createElement('div');
  qty.className = 'price-card-qty';
  qty.textContent = printsLabel(quantity);
  const perRow = document.createElement('div');
  perRow.className = 'price-card-per';
  const amount = document.createElement('span');
  amount.className = 'price-card-amount';
  amount.textContent = per ? formatPrice(per, currency) : '';
  const unit = document.createElement('span');
  unit.className = 'price-card-unit';
  unit.textContent = t('paywall.perPhoto');
  perRow.append(amount, unit);
  const was = document.createElement('div');
  was.className = 'price-card-was';
  was.textContent = singleCents && per && per < singleCents ? formatPrice(singleCents, currency) : '';
  const total = document.createElement('div');
  total.className = 'price-card-total';
  total.textContent = t('paywall.total').replace('{price}', totalCents ? formatPrice(totalCents, currency) : '');
  // Paying by phone: the QR sits in the chosen card itself (see placeQr)
  const pay = document.createElement('div');
  pay.className = 'price-card-pay';
  const slot = document.createElement('div');
  slot.className = 'price-card-qr-slot';
  const scan = document.createElement('div');
  scan.className = 'price-card-scan';
  scan.textContent = t('paywall.scanToPay');
  pay.append(slot, scan);
  card.append(qty, perRow, was, total, pay);
  return card;
}

// Move the (single) QR element into the chosen card, or back under the carousel
function placeQr() {
  const qr = elements.paywallQr;
  if (!qr) return;
  const byPhone = screens.paywall.classList.contains('by-phone');
  const slot = byPhone && carousel && carousel.node(carousel.index)
    ? carousel.node(carousel.index).querySelector('.price-card-qr-slot')
    : document.querySelector('#paywall-screen .paywall-pay-row');
  if (slot && qr.parentElement !== slot) slot.insertBefore(qr, slot.firstChild);
}

export function knobHintHtml(text) {
  return text ? `<span class="knob-arrow left">‹</span><span>${text}</span><span class="knob-arrow right">›</span>` : '';
}

function buildCarousel(quantities) {
  if (!elements.paywallCarousel) return;
  const single = getTierPriceCents(quantities[0]);
  const items = quantities.map((q) => ({ q, total: getTierPriceCents(q) }));
  carousel = createCarousel(elements.paywallCarousel, {
    items,
    index: 0,
    render: (it) => buildPriceCard(it.q, it.total, single)
  });
}

function renderPrice(quantity) {
  if (!carousel) return;
  const quantities = getTierQuantities();
  const i = quantities.indexOf(quantity);
  if (i >= 0 && i !== carousel.index) carousel.select(i);
}

// Small round thumbnail of the chosen style above the price
export function renderStyleChip(el) {
  if (!el) return;
  const style = state.availableStyles && state.availableStyles[state.currentStyleIndex];
  if (!style || style.__portrait) { el.style.display = 'none'; return; }
  const img = el.querySelector('.style-chip-img');
  const name = el.querySelector('.style-chip-name');
  const url = style.example_output_image_url || null;
  if (img) {
    img.style.backgroundImage = url ? `url("${url}")` : '';
    img.classList.toggle('no-image', !url);
    img.textContent = url ? '' : (style.name || '?').trim().charAt(0).toUpperCase();
  }
  if (name) name.textContent = style.name || '';
  el.style.display = 'flex';
}

function startStars() {
  const canvas = document.getElementById('paywall-stars');
  if (!canvas) return;
  if (!stars) stars = createStarfield(canvas);
  stars.setSpeed(1, true);
  stars.start();
}

function stopStars() {
  if (stars) stars.stop();
}

// Only show an order's QR / status when it is for the amount on screen and no
// newer knob turn is waiting: otherwise a swap is underway and the screen keeps
// saying "updating the amount".
function showOrderIfCurrent(s, order) {
  if (!s || s.qtyTimer || !order || order.quantity !== s.quantity) return false;
  applyRail(order);
  setStatus(''); // the tap / scan line says it all
  return true;
}

// Terminal: "tap your card". Terminal unavailable: QR to pay by phone (Mollie).
function applyRail(order) {
  const qr = order && order.provider === 'mollie' && order.payUrl;
  screens.paywall.classList.toggle('by-phone', !!qr);
  placeQr();
  if (qr) {
    renderPayQr(elements.paywallQr, order.payUrl, QR_SIZE);
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
    elements.paywallHint.innerHTML = multi ? knobHintHtml(t('paywall.turnForMore')) : '';
  }
  const title = document.getElementById('paywall-success-title');
  const sub = document.getElementById('paywall-success-sub');
  if (title) title.textContent = t('paywall.paidTitle');
  if (sub) sub.textContent = t('paywall.paidSub');
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
  screens.paywall.classList.remove('charged', 'paid');
  stopStars();
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
  state.resultHistory = [];

  applyText();
  renderStyleChip(document.getElementById('paywall-style'));
  screens.paywall.classList.remove('by-phone');
  placeQr(); // back under the carousel before the cards are rebuilt
  buildCarousel(quantities);
  setStatus('');
  hidePayQr(elements.paywallQr);
  if (elements.paywallPhoto) elements.paywallPhoto.src = state.currentPhoto || '';
  screens.paywall.classList.remove('charged', 'paid', 'by-phone');
  showScreen('paywall');
  startStars();

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
        setLedPhase('payFailed');
        await new Promise(r => setTimeout(r, 1500));
        if (s.done) return;
        setLedPhase('paywall');
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
  state.paidVia = order.provider || 'terminal'; // extra prints: same way of paying
  console.log(`[PAYWALL] Paid: order ${order.id}, ${order.quantity} print(s), ${order.amountCents}c`);

  // A moment of joy: check mark, stars go to warp. The portrait is already
  // being made in the background; the processing screen only takes over once
  // the moment is over (gate), so the wait afterwards feels shorter.
  setStatus('');
  setLedPhase('paid');
  hidePayQr(elements.paywallQr);
  screens.paywall.classList.add('charged', 'paid');
  if (stars) stars.setSpeed(7);
  const gate = new Promise((r) => setTimeout(r, PAID_MOMENT_MS));
  gate.then(() => {
    session = null;
    screens.paywall.classList.remove('charged', 'paid');
    stopStars();
  });
  await processPhoto({ orderId: order.id, gate });
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
  if (carousel) carousel.select(next);
  placeQr(); // the QR travels with the chosen card
  // QR: the tile itself shows "making the QR"; terminal: a short status line
  setStatus(state.order && state.order.provider === 'mollie' ? '' : t('paywall.updatingTerminal'));
  // The QR on screen is for the old amount: swap it for a "making your QR"
  // placeholder at once (same tile, no jump) so nobody scans a link that is
  // about to be replaced. Terminal payments have no QR to replace.
  if (state.order && state.order.provider === 'mollie') {
    showPayQrLoading(elements.paywallQr, QR_SIZE, t('paywall.qrUpdating'));
  }

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

// Button on the paywall: a guest who changes their mind presses twice within
// a few seconds (one press only shows the hint, so a nudge never throws the
// photo away). Nothing has been paid at this point.
let stopArmedUntil = 0;
export function handlePaywallButton() {
  if (!session || session.done) return;
  if (Date.now() < stopArmedUntil) {
    console.log('[PAYWALL] Guest stopped before paying');
    stopArmedUntil = 0;
    return bailOut(t('paywall.stopped'));
  }
  stopArmedUntil = Date.now() + 4000;
  setStatus(t('paywall.pressAgainToStop'));
  setTimeout(() => {
    if (Date.now() >= stopArmedUntil && session && !session.done) setStatus('');
  }, 4100);
}
