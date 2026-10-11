import { t } from '../translations/index.js';
import { formatPrice, getCurrency, getExtraPrintPriceCents, getTierQuantities, isTerminalPayMode } from '../booth/badges.js';
import { processPhoto } from '../generate.js';
import { flyOutSelectedCard, handleStyleChange, stopIdleAttract } from '../booth/coverflow.js';
import { showScreen, updateBoothBrandVisibility } from '../screens.js';
import { cancelOrder, createOrder, waitForOrder } from '../orders.js';
import { hidePayQr, renderPayQr, showPayQrLoading } from '../payqr.js';
import { cancelTypingAnimation } from './poem.js';
import { handlePrint, resetPrintCircleIdle } from './print.js';
import { cancelResultTimer, startResultTimer } from './qr.js';
import { elements, state } from '../state.js';

// =============================================================================
// Result screen in the pay-first (terminal) flow — phases 5 and 6
// -----------------------------------------------------------------------------
//  reveal   : portrait is on screen. Button = print the paid copies.
//             Knob (while a free retake is left) = pick another style → retake.
//  retake   : style picker panel open. Knob cycles styles, button regenerates.
//  printing : the paid copies are being printed.
//  printed  : prints done; QR for the download. Knob = add prints (upsell).
//  upsell   : extra-print panel open. Knob picks the amount, the terminal
//             shows the price; paid → the extra copies print right away.
// 20 s after the last print (or interaction) the booth is handed to the next guest.
// =============================================================================

const REVEAL_TIMEOUT_MS = 60000;   // decide to print / retake
const IDLE_AFTER_PRINT_MS = 20000; // back to the booth after the last print
const PANEL_IDLE_MS = 10000;       // retake / upsell panel closes when the knob rests
const UPSELL_DEBOUNCE_MS = 700;
const UPSELL_POLL_MS = 750;
const UPSELL_TIMEOUT_MS = 60000;

let panelTimer = null;
let upsell = null; // { extra, timer, abort }
let paidTotal = 0; // prints paid so far for this session (generation + extra orders)

function setHint(text) {
  if (!elements.resultHint) return;
  elements.resultHint.innerHTML = text || '';
  elements.resultHint.style.display = text ? 'block' : 'none';
}

function showPanel(title, value, sub, cls = '') {
  if (!elements.resultPanel) return;
  elements.resultPanelTitle.textContent = title || '';
  elements.resultPanelValue.textContent = value || '';
  elements.resultPanelSub.textContent = sub || '';
  elements.resultPanel.className = 'result-panel' + (cls ? ' ' + cls : '');
  elements.resultPanel.style.display = 'block';
}

function hidePanel() {
  hidePayQr(elements.resultPanelQr);
  if (elements.resultPanel) elements.resultPanel.style.display = 'none';
  if (panelTimer) { clearTimeout(panelTimer); panelTimer = null; }
}

function armPanelClose(fn) {
  if (panelTimer) clearTimeout(panelTimer);
  panelTimer = setTimeout(() => { panelTimer = null; fn(); }, PANEL_IDLE_MS);
}

function setPhase(phase) {
  state.resultPhase = phase;
  console.log('[TERMINAL] Result phase:', phase);
}

function currentStyleName() {
  const s = state.availableStyles[state.currentStyleIndex];
  return s ? (s.name || s.id || '') : '';
}

function canUpsell() {
  const max = Math.max(0, ...getTierQuantities());
  return paidTotal < max && getExtraPrintPriceCents(paidTotal, 1) !== null;
}

// Called by showQRCode() once the render is in (terminal mode only)
export function enterTerminalResult() {
  if (!isTerminalPayMode() || !state.order) return;
  hidePanel();
  upsell = null;
  state.terminalBusy = false;
  paidTotal = state.order.quantity;
  state.printsRemaining = state.order.quantity;
  if (elements.printLabel) elements.printLabel.textContent = t('result.pressToPrint');

  setPhase('reveal');
  const retake = state.order.generationsLeft > 0 ? `<br/>${t('result.hintRetake')}` : '';
  setHint(`${t('result.hintPrint')}${retake}`);
  startResultTimer(REVEAL_TIMEOUT_MS);
}

// Runs after the wipe back to the booth
export function leaveTerminalResult() {
  if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
  if (state.retakeMode) { state.retakeMode = false; setRetakeChrome(false); }
  hidePanel();
  setHint('');
  if (upsell) {
    if (upsell.timer) clearTimeout(upsell.timer);
    if (upsell.abort) upsell.abort.abort();
    upsell = null;
  }
  if (state.order && state.order.status === 'pending') cancelOrder(state.order.id, 'result_left');
  state.order = null;
  state.terminalBusy = false;
  state.resultPhase = null;
  paidTotal = 0;
}

// ---------------------------------------------------------------------------
// Printing the paid copies
// ---------------------------------------------------------------------------

async function printAllPaid() {
  if (state.resultPhase === 'printing') return;
  setPhase('printing');
  hidePanel();
  cancelResultTimer();
  setHint(t('result.hintPrinting'));

  while (state.printsRemaining > 0 && state.screen === 'result') {
    const before = state.printsRemaining;
    await handlePrint();
    if (state.printsRemaining >= before) {
      console.warn('[TERMINAL] Print did not go through — stopping the batch');
      break;
    }
    // Let the "sent" checkmark show before the next copy
    if (state.printsRemaining > 0) await new Promise(r => setTimeout(r, 1200));
  }

  if (state.screen !== 'result') return;
  setPhase('printed');
  resetPrintCircleIdle();
  setHint(canUpsell() ? t('result.hintUpsell') : t('result.hintDone'));
  startResultTimer(IDLE_AFTER_PRINT_MS);
}

// ---------------------------------------------------------------------------
// Retake (one free regeneration with another style)
// ---------------------------------------------------------------------------

// Free retake: the start screen with its style coverflow, but with the guest's
// own photo instead of the live camera and a "free retake" banner. Turning the
// knob picks a style exactly like on the start screen; the button makes the
// portrait again with the same photo. No input for a while → back to the result.
const RETAKE_IDLE_MS = 25000;
let retakeTimer = null;

function armRetakeTimeout() {
  if (retakeTimer) clearTimeout(retakeTimer);
  retakeTimer = setTimeout(() => {
    retakeTimer = null;
    if (state.retakeMode) closeRetake();
  }, RETAKE_IDLE_MS);
}

function setRetakeChrome(on) {
  const photo = document.getElementById('retake-photo');
  if (photo) {
    photo.src = on ? (state.currentPhoto || '') : '';
    photo.style.display = on ? 'block' : 'none';
  }
  if (elements.prepaidBanner) {
    if (on) {
      elements.prepaidTitle.textContent = t('result.retakeTitle');
      elements.prepaidBody.textContent = t('result.retakeBody');
      elements.prepaidCta.textContent = t('result.retakeSub');
    }
    elements.prepaidBanner.style.display = on ? 'block' : 'none';
  }
  // The retake is free: no price on the start screen
  if (elements.priceBadge) elements.priceBadge.style.visibility = on ? 'hidden' : '';
}

function openRetake(direction) {
  setPhase('retake');
  cancelResultTimer();
  hidePanel();
  state.retakeMode = true;
  showScreen('booth');
  stopIdleAttract(); // no auto-turning while the guest chooses
  setRetakeChrome(true);
  handleStyleChange(direction === 'clockwise' ? 'clockwise' : 'counterclockwise');
  armRetakeTimeout();
}

// Knob on the start screen while choosing a retake style
export function onRetakeKnob() {
  if (!state.retakeMode) return;
  stopIdleAttract();
  armRetakeTimeout();
}

function closeRetake() {
  if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
  state.retakeMode = false;
  setRetakeChrome(false);
  showScreen('result');
  setPhase('reveal');
  const retake = state.order && state.order.generationsLeft > 0 ? `<br/>${t('result.hintRetake')}` : '';
  setHint(`${t('result.hintPrint')}${retake}`);
  startResultTimer(REVEAL_TIMEOUT_MS);
}

// Button on the start screen while choosing a retake style
export async function confirmRetakeFromBooth() {
  if (!state.retakeMode || !state.order) return;
  if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
  state.retakeMode = false;
  state.isCapturing = true;
  updateBoothBrandVisibility();
  console.log('[TERMINAL] Free retake with style', currentStyleName());
  await flyOutSelectedCard(); // same send-off as a normal capture
  setRetakeChrome(false);
  cancelTypingAnimation();
  setHint('');
  state.order.generationsLeft = Math.max(0, state.order.generationsLeft - 1);
  document.getElementById('qr-circle')?.classList.remove('show');
  document.getElementById('print-circle')?.classList.remove('show');
  await processPhoto({ orderId: state.order.id, retake: true });
}

// ---------------------------------------------------------------------------
// Post-print upsell (pay for extra copies on the terminal)
// ---------------------------------------------------------------------------

function renderUpsell(sub, cls = 'pending') {
  const cents = getExtraPrintPriceCents(paidTotal, upsell.extra);
  const label = t('result.upsellPrints').replace('{count}', String(upsell.extra));
  showPanel(t('result.upsellTitle'), `${label} · ${cents ? formatPrice(cents, getCurrency()) : ''}`, sub, cls);
}

function openUpsell(direction) {
  if (!canUpsell()) return;
  setPhase('upsell');
  upsell = { extra: 1, timer: null, abort: null };
  renderUpsell(t('result.upsellTap'));
  cancelResultTimer();
  scheduleUpsellOrder();
  armPanelClose(closeUpsell);
}

function changeUpsell(direction) {
  if (!upsell) return;
  const max = Math.max(0, ...getTierQuantities()) - paidTotal;
  let next = upsell.extra + (direction === 'clockwise' ? 1 : -1);
  next = Math.max(1, Math.min(max, next));
  while (next > 1 && getExtraPrintPriceCents(paidTotal, next) === null) next -= 1;
  if (next === upsell.extra) return;
  upsell.extra = next;
  renderUpsell(t('result.upsellUpdating'));
  // QR for the old amount: keep the tile, show "making your QR" until the new one is there
  if (state.order && state.order.kind === 'extra_print' && state.order.provider === 'mollie') {
    showPayQrLoading(elements.resultPanelQr, 160, t('paywall.qrUpdating'));
  }
  scheduleUpsellOrder();
  armPanelClose(closeUpsell);
}

function scheduleUpsellOrder() {
  const u = upsell;
  if (u.timer) clearTimeout(u.timer);
  u.timer = setTimeout(async () => {
    u.timer = null;
    if (upsell !== u) return;
    // One swap at a time: wait for an order that is still being created
    if (u.creating) await u.creating.catch(() => {});
    if (upsell !== u) return;
    if (u.abort) u.abort.abort();
    const stale = state.order && state.order.kind === 'extra_print' && state.order.status === 'pending' ? state.order : null;
    if (stale) {
      const final = await cancelOrder(stale.id, 'quantity_changed');
      if (final && final.status === 'paid' && upsell === u) return onUpsellPaid(final);
    }
    if (upsell === u) runUpsellOrder(u);
  }, UPSELL_DEBOUNCE_MS);
}

async function runUpsellOrder(u) {
  u.abort = new AbortController();
  const signal = u.abort.signal;
  state.terminalBusy = true;
  let order;
  try {
    u.creating = createOrder('extra_print', u.extra, state.currentSession && state.currentSession.id);
    order = await u.creating;
  } catch (e) {
    if (upsell !== u || signal.aborted) return;
    console.error('[TERMINAL] Extra-print order failed:', e.code || e.message);
    renderUpsell(t('result.upsellFailed'), 'error');
    state.terminalBusy = false;
    armPanelClose(closeUpsell);
    return;
  }
  if (upsell !== u || signal.aborted) {
    cancelOrder(order.id, 'superseded'); // outdated before it was shown
    return;
  }
  if (panelTimer) { clearTimeout(panelTimer); panelTimer = null; } // a live terminal amount keeps the panel open
  const byPhone = order.provider === 'mollie' && order.payUrl;
  renderUpsell(byPhone ? t('result.upsellScan') : t('result.upsellTap'));
  if (byPhone) renderPayQr(elements.resultPanelQr, order.payUrl, 160);

  const result = await waitForOrder(order.id, {
    intervalMs: UPSELL_POLL_MS,
    timeoutMs: byPhone ? UPSELL_TIMEOUT_MS * 2 : UPSELL_TIMEOUT_MS,
    signal
  });
  hidePayQr(elements.resultPanelQr);
  if (upsell !== u || signal.aborted || result.status === 'aborted') return;

  if (result.status === 'paid') return onUpsellPaid(result);
  console.log('[TERMINAL] Extra-print payment', result.status);
  renderUpsell(result.status === 'failed' ? t('result.upsellFailed') : t('result.upsellCancelled'), 'error');
  state.terminalBusy = false;
  armPanelClose(closeUpsell);
}

async function onUpsellPaid(order) {
  state.order = order;
  upsell = null;
  state.terminalBusy = false;
  paidTotal += order.quantity;
  state.printsRemaining += order.quantity;
  console.log(`[TERMINAL] Extra prints paid: +${order.quantity} (total ${paidTotal})`);
  showPanel(t('result.upsellTitle'), t('result.upsellPrints').replace('{count}', String(order.quantity)), t('result.upsellPaid'), 'ok');
  await new Promise(r => setTimeout(r, 900));
  await printAllPaid();
}

function closeUpsell() {
  const u = upsell;
  upsell = null;
  hidePanel();
  if (u) {
    if (u.timer) clearTimeout(u.timer);
    if (u.abort) u.abort.abort();
  }
  if (state.order && state.order.kind === 'extra_print' && state.order.status === 'pending') {
    cancelOrder(state.order.id, 'upsell_closed');
  }
  state.terminalBusy = false;
  setPhase('printed');
  startResultTimer(IDLE_AFTER_PRINT_MS);
}

// ---------------------------------------------------------------------------
// Hardware routing (called from booth/events.js)
// ---------------------------------------------------------------------------

export function handleTerminalResultButton() {
  switch (state.resultPhase) {
    case 'reveal':
      return printAllPaid();
    case 'retake':
      return confirmRetakeFromBooth();
    case 'printed':
      if (state.printsRemaining > 0) return printAllPaid(); // a copy failed earlier
      return;
    case 'upsell':
      if (!state.terminalBusy) closeUpsell();
      return;
    default:
      return; // printing: ignore
  }
}

export function handleTerminalResultKnob(direction) {
  switch (state.resultPhase) {
    case 'reveal':
      if (state.order && state.order.generationsLeft > 0) openRetake(direction);
      return;
    case 'retake':
      return; // handled by the start screen's coverflow (see onRetakeKnob)
    case 'printed':
      return openUpsell(direction);
    case 'upsell':
      if (!state.terminalBusy || (state.order && state.order.status === 'pending')) changeUpsell(direction);
      return;
    default:
      return;
  }
}
