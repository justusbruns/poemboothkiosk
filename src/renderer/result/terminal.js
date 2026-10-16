import { t } from '../translations/index.js';
import { formatPrice, getCurrency, getExtraPrintPriceCents, getTierQuantities, isTerminalPayMode } from '../booth/badges.js';
import { processPhoto } from '../generate.js';
import { buildStyleCoverflow, flyOutSelectedCard, positionStyleCoverflow, startCtaRotation, stopCtaRotation, stopIdleAttract } from '../booth/coverflow.js';
import { showScreen, updateBoothBrandVisibility } from '../screens.js';
import { cancelOrder, createOrder, refreshOrder, waitForOrder } from '../orders.js';
import { hidePayQr, renderPayQr, showPayQrLoading } from '../payqr.js';
import { cancelTypingAnimation } from './poem.js';
import { handlePrint, resetPrintCircleIdle } from './print.js';
import { cancelResultTimer, showQRCode, startResultTimer } from './qr.js';
import { showResultCameraBackground } from './ui.js';
import { elements, state } from '../state.js';
import { setLedPhase } from '../leds.js';
import { createCarousel } from '../carousel.js';

// =============================================================================
// Result screen in the pay-first (terminal) flow — phases 5 and 6
// -----------------------------------------------------------------------------
//  reveal   : portrait is on screen. Button = print the paid copies.
//             Knob = the start screen's row with the portraits made so far
//             and (while a free retake is left) the styles.
//  retake   : choosing in that row (see "Retake / compare portraits").
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

// One thing at a time on the result screen: before printing only the print
// circle; after printing the QR for the digital copy (the print is the main
// thing the guest paid for, the download is a bonus).
function showCircles({ qr, print }) {
  const qrCircle = document.getElementById('qr-circle');
  const qrBox = qrCircle && qrCircle.closest('.circle-container');
  if (qrBox) qrBox.style.display = qr ? '' : 'none';
  if (qr && qrCircle) setTimeout(() => qrCircle.classList.add('show'), 50);
  if (elements.printContainer) elements.printContainer.style.display = print ? 'flex' : 'none';
  if (print) document.getElementById('print-circle')?.classList.add('show');
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
export function enterTerminalResult(publicViewUrl) {
  if (!isTerminalPayMode() || !state.order) return;
  recordPortrait(publicViewUrl);
  hidePanel();
  upsell = null;
  state.terminalBusy = false;
  paidTotal = state.order.quantity;
  state.printsRemaining = state.order.quantity;
  if (elements.printLabel) elements.printLabel.textContent = t('result.pressToPrint');

  hideChoice();
  choice = null;
  backToReveal();
  showPeek();

  // The backend knows how many generations this order has left (the first
  // portrait counts too): ask, so the screen never offers a retake that the
  // backend would refuse.
  const orderId = state.order.id;
  refreshOrder(orderId).then((o) => {
    if (!state.order || state.order.id !== orderId) return;
    const changed = state.order.generationsLeft !== o.generationsLeft;
    state.order.generationsLeft = o.generationsLeft;
    if (state.resultPhase === 'reveal') {
      setHint(revealHint());
      if (changed) showPeek();
    }
  }).catch((e) => console.warn('[TERMINAL] Order refresh failed:', e.message));
}

// Runs after the wipe back to the booth
export function leaveTerminalResult() {
  hideChoice();
  choice = null;
  state.resultHistory = [];
  // Restore the shared result layout for the next guest (and other modes)
  const qrBox = document.getElementById('qr-circle')?.closest('.circle-container');
  if (qrBox) qrBox.style.display = '';
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
  hideChoice(); // printing: the choice is made
  setPhase('printing');
  hidePanel();
  cancelResultTimer();
  showCircles({ qr: false, print: true });
  setHint(t('result.hintPrinting'));

  // All paid copies in one go: a counter on the button, one check mark at the end
  const total = state.printsRemaining;
  let done = 0;
  while (state.printsRemaining > 0 && state.screen === 'result') {
    if (elements.printLabel) {
      elements.printLabel.textContent = total > 1
        ? t('result.printingProgress').replace('{n}', String(done + 1)).replace('{total}', String(total))
        : t('result.printingOne');
    }
    const before = state.printsRemaining;
    await handlePrint({ batch: true });
    if (state.printsRemaining >= before) {
      console.warn('[TERMINAL] Print did not go through — stopping the batch');
      break;
    }
    done += 1;
  }

  if (state.screen !== 'result') return;
  if (done > 0) {
    // One "sent" check mark for the batch
    if (elements.printIcon) elements.printIcon.style.display = 'none';
    if (elements.printDoneIcon) {
      elements.printDoneIcon.style.display = 'flex';
      setTimeout(() => elements.printDoneIcon.classList.add('show'), 50);
    }
    if (elements.printLabel) elements.printLabel.textContent = t('result.printsComing');
  }
  setPhase('printed');
  setLedPhase('reveal');
  setHint(canUpsell() ? t('result.hintUpsell') : '');
  // The check mark stays a moment; then the QR takes the print button's place
  // (receipt, digital copy and extra prints)
  setTimeout(() => {
    if (state.screen !== 'result' || state.resultPhase !== 'printed') return;
    if (state.printsRemaining > 0) { // a copy failed: keep the print button
      resetPrintCircleIdle();
      if (elements.printLabel) elements.printLabel.textContent = t('result.pressToPrint');
      return;
    }
    swapPrintForQr();
  }, 2200);
  startResultTimer(IDLE_AFTER_PRINT_MS);
}

// Print button shrinks away, then the QR grows in on the same spot
function swapPrintForQr() {
  const printCircle = document.getElementById('print-circle');
  const qrCircle = document.getElementById('qr-circle');
  if (elements.qrLabel) elements.qrLabel.innerHTML = t('result.scanReceiptAndMore');
  if (printCircle) printCircle.classList.remove('show'); // scale out (0.4 s)
  setTimeout(() => {
    if (state.screen !== 'result') return;
    resetPrintCircleIdle();
    if (elements.printContainer) elements.printContainer.style.display = 'none';
    if (qrCircle) qrCircle.classList.remove('show');
    const qrBox = qrCircle && qrCircle.closest('.circle-container');
    if (qrBox) qrBox.style.display = '';
    // next frame: grow in
    requestAnimationFrame(() => requestAnimationFrame(() => qrCircle && qrCircle.classList.add('show')));
  }, 420);
}

// ---------------------------------------------------------------------------
// Retake / compare portraits: a carousel on the result screen
// ---------------------------------------------------------------------------

// The portrait on screen is the middle of a carousel: next to it, at the edges
// of the screen, the guest sees the other choices peeking in (the styles while
// a free retake is left, and earlier portraits). Turning the knob makes the
// carousel the main thing: the portrait becomes its middle card and the other
// cards slide in. Button on a portrait → that one is chosen (an earlier one
// gets the paid prints); on a style → a new portrait in that style with the
// same photo. No input for a while → back to the portrait.
const RETAKE_IDLE_MS = 25000;
const PEEK_DELAY_MS = 1800; // let the reveal land before the side cards appear
let retakeTimer = null;
let peekTimer = null;
let choice = null; // carousel instance

function armRetakeTimeout() {
  if (retakeTimer) clearTimeout(retakeTimer);
  retakeTimer = setTimeout(() => {
    retakeTimer = null;
    if (state.resultPhase === 'retake') closeChoice();
  }, RETAKE_IDLE_MS);
}

function canRetakeStyle() {
  return !!(state.order && state.order.generationsLeft > 0);
}

function portraits() {
  return state.resultHistory || [];
}

function canOpenRetake() {
  return canRetakeStyle() || portraits().length > 1;
}

function revealHint() {
  if (canRetakeStyle()) return t('result.hintRetake');
  if (portraits().length > 1) return t('result.hintCompare');
  return '';
}

// Remember the portrait on screen (one entry per session)
function recordPortrait(publicViewUrl) {
  const id = state.currentSession && state.currentSession.id;
  if (!id) return;
  const snap = {
    sessionId: id,
    image: state.lastResultImage || null,
    printUrl: state.currentPrintUrl || null,
    printBuffer: state.currentPrintBuffer || null,
    format: state.currentPrintFormat,
    orientation: state.currentPrintOrientation,
    publicViewUrl: publicViewUrl || null,
    styleIndex: state.currentStyleIndex
  };
  const list = portraits().slice();
  const at = list.findIndex((p) => p.sessionId === id);
  if (at >= 0) list[at] = { ...list[at], ...snap, publicViewUrl: snap.publicViewUrl || list[at].publicViewUrl };
  else list.push(snap);
  state.resultHistory = list;
}

function choiceItems() {
  const list = portraits();
  const items = list.map((p, i) => ({ kind: 'portrait', p, label: list.length > 1 ? t('result.portraitN').replace('{n}', String(i + 1)) : t('result.keepBadge') }));
  if (canRetakeStyle()) {
    (state.availableStyles || []).forEach((style, styleIndex) => items.push({ kind: 'style', style, styleIndex }));
  }
  return items;
}

function renderChoiceCard(item) {
  const card = document.createElement('div');
  card.className = 'choice-card' + (item.kind === 'portrait' ? ' choice-portrait' : '');
  const url = item.kind === 'portrait' ? item.p.image : item.style.example_output_image_url;
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    card.appendChild(img);
  } else {
    const name = document.createElement('div');
    name.className = 'choice-name-card';
    name.textContent = item.kind === 'style' ? (item.style.name || '') : item.label;
    card.appendChild(name);
  }
  // Only the guest's own portraits get a label (like the start screen, the
  // style cards speak for themselves)
  if (item.kind === 'portrait') {
    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = item.label;
    card.appendChild(label);
  }
  return card;
}

function onScreenIndex(items) {
  const id = state.currentSession && state.currentSession.id;
  const i = items.findIndex((it) => it.kind === 'portrait' && it.p.sessionId === id);
  return i >= 0 ? i : 0;
}

// Build (or rebuild) the carousel around the portrait on screen. 'peek' =
// only the neighbours show at the screen edges, the real result is the middle.
function buildChoice() {
  const el = document.getElementById('result-carousel');
  if (!el) return null;
  const items = choiceItems();
  if (items.length < 2) { el.style.display = 'none'; choice = null; return null; }
  choice = createCarousel(el, {
    items,
    index: onScreenIndex(items),
    render: renderChoiceCard,
    mode: 'coverflow' // the same row as on the start screen, big
  });
  el.style.display = '';
  return choice;
}

function showPeek() {
  if (peekTimer) clearTimeout(peekTimer);
  peekTimer = null;
  const screen = document.getElementById('result-screen');
  if (!screen) return;
  screen.classList.remove('choosing');
  if (!canOpenRetake() || !buildChoice()) return;
  peekTimer = setTimeout(() => {
    peekTimer = null;
    if (state.resultPhase === 'reveal') screen.classList.add('peeking');
  }, PEEK_DELAY_MS);
}

function hideChoice() {
  if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
  if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
  const screen = document.getElementById('result-screen');
  if (screen) screen.classList.remove('peeking', 'choosing');
}

function choiceHint() {
  const it = choice && choice.item;
  if (!it) return '';
  if (it.kind === 'style') return t('result.tryStyleCta');
  const onScreen = state.currentSession && it.p.sessionId === state.currentSession.id;
  return (onScreen ? t('result.keepCta') : t('result.pickCta')).replace(/<br\s*\/?>/g, ' ');
}

function openChoice(direction) {
  if (!choice && !buildChoice()) return;
  setPhase('retake');
  cancelResultTimer();
  hidePanel();
  if (peekTimer) { clearTimeout(peekTimer); peekTimer = null; }
  const screen = document.getElementById('result-screen');
  screen.classList.add('peeking', 'choosing');
  showCircles({ qr: false, print: false });
  // The first turn already moves: the guest sees the next choice slide in
  choice.move(direction === 'clockwise' ? 1 : -1);
  setHint(knobHint(choiceHint()));
  armRetakeTimeout();
}

function moveChoice(direction) {
  if (!choice) return;
  choice.move(direction === 'clockwise' ? 1 : -1);
  setHint(knobHint(choiceHint()));
  armRetakeTimeout();
}

function knobHint(text) {
  return text ? `<span class="knob-arrow left">‹</span> ${text} <span class="knob-arrow right">›</span>` : '';
}

function closeChoice() {
  if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
  if (choice) choice.select(onScreenIndex(choiceItems()));
  const screen = document.getElementById('result-screen');
  if (screen) screen.classList.remove('choosing');
  backToReveal();
}

function backToReveal() {
  setPhase('reveal');
  showCircles({ qr: false, print: true });
  setHint(revealHint());
  startResultTimer(REVEAL_TIMEOUT_MS);
  const screen = document.getElementById('result-screen');
  if (screen && choice && canOpenRetake()) screen.classList.add('peeking');
}

// Put an earlier portrait back on the result screen (as its image)
function showPortraitResult(p) {
  state.currentSession = { id: p.sessionId };
  state.currentPrintUrl = p.printUrl;
  state.currentPrintBuffer = p.printBuffer;
  if (p.format) state.currentPrintFormat = p.format;
  if (p.orientation) state.currentPrintOrientation = p.orientation;
  state.lastResultImage = p.image;

  cancelTypingAnimation();
  if (elements.resultPhoto) { elements.resultPhoto.src = ''; elements.resultPhoto.style.display = 'none'; }
  showResultCameraBackground();
  const overlay = elements.poemText && elements.poemText.parentElement;
  if (overlay) overlay.classList.add('image-display');
  if (elements.poemText) {
    elements.poemText.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'result-image-wrap';
    const img = document.createElement('img');
    img.src = p.image || '';
    img.alt = '';
    wrap.appendChild(img);
    if (elements.resultWatermark) wrap.appendChild(elements.resultWatermark);
    elements.poemText.appendChild(wrap);
    elements.poemText.classList.add('typing-complete');
  }
  showScreen('result');
  if (p.publicViewUrl) {
    showQRCode(p.publicViewUrl); // redraws the QR and re-enters the reveal phase
  } else {
    backToReveal();
  }
}

// Button while choosing
async function confirmChoice() {
  if (!choice || !state.order) return;
  const it = choice.item;
  if (!it) return;

  if (it.kind === 'portrait') {
    const p = it.p;
    const onScreen = state.currentSession && p.sessionId === state.currentSession.id;
    const screen = document.getElementById('result-screen');
    if (screen) screen.classList.remove('choosing');
    if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
    if (onScreen) {
      console.log('[TERMINAL] Guest keeps the portrait on screen');
      return backToReveal();
    }
    console.log('[TERMINAL] Guest picks an earlier portrait', p.sessionId);
    // The paid prints move to this portrait
    window.electronAPI.orderSelectSession(state.order.id, p.sessionId)
      .then((res) => { if (res && res.error) console.warn('[TERMINAL] select-session failed:', res.error); })
      .catch((e) => console.warn('[TERMINAL] select-session failed:', e.message));
    hideChoice();
    choice = null;
    return showPortraitResult(p);
  }

  if (!canRetakeStyle()) return;
  console.log('[TERMINAL] Free retake with style', it.style && it.style.name);
  hideChoice();
  state.currentStyleIndex = it.styleIndex; // the generation uses the selected style
  cancelTypingAnimation();
  setHint('');
  state.order.generationsLeft = Math.max(0, state.order.generationsLeft - 1);
  document.getElementById('qr-circle')?.classList.remove('show');
  document.getElementById('print-circle')?.classList.remove('show');
  choice = null;
  await processPhoto({ orderId: state.order.id, retake: true });
}

// Kept for the start screen's button / knob routing (the choice no longer
// happens there)
export function onRetakeKnob() {}
export async function confirmRetakeFromBooth() {}

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
    u.creating = createOrder('extra_print', u.extra, state.currentSession && state.currentSession.id, {
      allowMollieFallback: state.paidVia === 'mollie'
    });
    order = await u.creating;
  } catch (e) {
    if (upsell !== u || signal.aborted) return;
    console.error('[TERMINAL] Extra-print order failed:', e.code || e.message);
    // Terminal busy / offline (no Mollie fallback here): point to the portal QR
    const busy = e && (e.code === 'terminal_unavailable' || e.status === 503);
    renderUpsell(busy ? t('result.upsellTerminalBusy') : t('result.upsellFailed'), 'error');
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
      return confirmChoice();
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
      if (state.order && canOpenRetake()) openChoice(direction);
      return;
    case 'retake':
      return moveChoice(direction);
    case 'printed':
      return openUpsell(direction);
    case 'upsell':
      if (!state.terminalBusy || (state.order && state.order.status === 'pending')) changeUpsell(direction);
      return;
    default:
      return;
  }
}
