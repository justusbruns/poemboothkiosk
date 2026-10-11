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

  backToReveal();

  // The backend knows how many generations this order has left (the first
  // portrait counts too): ask, so the screen never offers a retake that the
  // backend would refuse.
  const orderId = state.order.id;
  refreshOrder(orderId).then((o) => {
    if (!state.order || state.order.id !== orderId) return;
    state.order.generationsLeft = o.generationsLeft;
    if (state.resultPhase === 'reveal') setHint(revealHint());
  }).catch((e) => console.warn('[TERMINAL] Order refresh failed:', e.message));
}

// Runs after the wipe back to the booth
export function leaveTerminalResult() {
  if (retakeSaved) restoreNormalCoverflow();
  state.resultHistory = [];
  // Restore the shared result layout for the next guest (and other modes)
  const qrBox = document.getElementById('qr-circle')?.closest('.circle-container');
  if (qrBox) qrBox.style.display = '';
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
  showCircles({ qr: false, print: true });
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
  if (elements.qrLabel) elements.qrLabel.innerHTML = t('result.scanForDigital');
  showCircles({ qr: true, print: false });
  setHint(canUpsell() ? t('result.hintUpsell') : '');
  startResultTimer(IDLE_AFTER_PRINT_MS);
}

// ---------------------------------------------------------------------------
// Retake / compare portraits (start screen coverflow)
// ---------------------------------------------------------------------------

// Turning the knob on the result opens the start screen's style row with the
// guest's own photo as background. In front of the styles sit the portraits
// already made with this order ("Your portrait", or "Portrait 1 / 2" after a
// retake); the one on screen is selected, so an accidental turn never loses
// it. Pick a portrait → back to that result (an earlier one gets the prints);
// pick a style (only while a free retake is left) → regenerate with the same
// photo. No input for a while → back to the result.
const RETAKE_IDLE_MS = 25000;
let retakeTimer = null;
let retakeSaved = null; // { styles, index } of the normal coverflow

function armRetakeTimeout() {
  if (retakeTimer) clearTimeout(retakeTimer);
  retakeTimer = setTimeout(() => {
    retakeTimer = null;
    if (state.retakeMode) closeRetake();
  }, RETAKE_IDLE_MS);
}

function selectedEntry() {
  return state.availableStyles[state.currentStyleIndex] || null;
}

function isPortraitSelected() {
  const s = selectedEntry();
  return !!(s && s.__portrait);
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
    publicViewUrl: publicViewUrl || null
  };
  const list = portraits().slice();
  const at = list.findIndex((p) => p.sessionId === id);
  if (at >= 0) list[at] = { ...list[at], ...snap, publicViewUrl: snap.publicViewUrl || list[at].publicViewUrl };
  else list.push(snap);
  state.resultHistory = list;
}

function updateRetakeCta() {
  if (!elements.actionButtonText) return;
  const s = selectedEntry();
  let text = t('result.retakeCta');
  if (s && s.__portrait) {
    const onScreen = state.currentSession && s.__portrait.sessionId === state.currentSession.id;
    text = onScreen ? t('result.keepCta') : t('result.pickCta');
  }
  elements.actionButtonText.innerHTML = text;
  elements.actionButtonText.style.opacity = '1';
}

function markPortraitCards(count) {
  const cards = document.getElementById('style-coverflow')?.children || [];
  for (let i = 0; i < count && i < cards.length; i++) {
    cards[i].classList.add('style-card-keep');
    const badge = document.createElement('span');
    badge.className = 'keep-badge';
    badge.textContent = count > 1
      ? t('result.portraitN').replace('{n}', String(i + 1))
      : t('result.keepBadge');
    cards[i].appendChild(badge);
  }
}

function setRetakeChrome(on) {
  const photo = document.getElementById('retake-photo');
  if (photo) {
    photo.src = on ? (state.currentPhoto || '') : '';
    photo.style.display = on ? 'block' : 'none';
  }
  // Nothing to pay here: no price on the start screen
  if (elements.priceBadge) elements.priceBadge.style.visibility = on ? 'hidden' : '';
}

function restoreNormalCoverflow(selectedStyle = null) {
  if (!retakeSaved) return;
  const { styles, index } = retakeSaved;
  retakeSaved = null;
  state.availableStyles = styles;
  const found = selectedStyle ? styles.indexOf(selectedStyle) : -1;
  state.currentStyleIndex = found >= 0 ? found : index;
  buildStyleCoverflow();
}

// Where the portrait sits on the result screen right now (for the fly-in)
function resultImageRect() {
  const img = document.querySelector('#poem-text .result-image-wrap img');
  const el = img || elements.poemText;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 10 && r.height > 10 ? r : null;
}

// The portrait shrinks from the result screen into its card in the row
function flyIntoCard(fromRect, card, src) {
  if (!fromRect || !card || !src) return;
  const target = card.getBoundingClientRect();
  if (!target.width) return;
  const ghost = document.createElement('img');
  ghost.src = src;
  ghost.className = 'portrait-fly';
  Object.assign(ghost.style, {
    left: fromRect.left + 'px', top: fromRect.top + 'px',
    width: fromRect.width + 'px', height: fromRect.height + 'px'
  });
  document.body.appendChild(ghost);
  card.style.visibility = 'hidden';
  const dx = target.left - fromRect.left;
  const dy = target.top - fromRect.top;
  const sx = target.width / fromRect.width;
  const sy = target.height / fromRect.height;
  const anim = ghost.animate([
    { transform: 'translate(0, 0) scale(1, 1)', borderRadius: '8px', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: '14px', opacity: 1 }
  ], { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
  const done = () => { card.style.visibility = ''; ghost.remove(); };
  anim.onfinish = done;
  setTimeout(done, 1200); // safety net
}

function openRetake() {
  setPhase('retake');
  cancelResultTimer();
  hidePanel();
  const fromRect = resultImageRect();
  state.retakeMode = true;

  // Portraits first (oldest → newest), then the styles while a retake is left
  retakeSaved = { styles: state.availableStyles, index: state.currentStyleIndex };
  const portraitCards = portraits().map((p, i) => ({
    id: '__portrait_' + i,
    __portrait: p,
    name: t('result.keepBadge'),
    example_output_image_url: p.image || null
  }));
  const list = canRetakeStyle() ? portraitCards.concat(retakeSaved.styles) : portraitCards;
  const onScreen = portraits().findIndex((p) => state.currentSession && p.sessionId === state.currentSession.id);
  state.availableStyles = list;
  state.currentStyleIndex = onScreen >= 0 ? onScreen : Math.max(0, portraitCards.length - 1);
  buildStyleCoverflow();
  markPortraitCards(portraitCards.length);

  showScreen('booth');
  stopIdleAttract(); // no auto-turning while the guest chooses
  stopCtaRotation();
  positionStyleCoverflow();
  setRetakeChrome(true);
  updateRetakeCta();
  armRetakeTimeout();

  // Let the row settle, then fly the portrait into its card
  const card = document.getElementById('style-coverflow')?.children[state.currentStyleIndex];
  const src = state.lastResultImage;
  requestAnimationFrame(() => requestAnimationFrame(() => flyIntoCard(fromRect, card, src)));
}

// Knob on the start screen while choosing
export function onRetakeKnob() {
  if (!state.retakeMode) return;
  stopIdleAttract();
  updateRetakeCta();
  armRetakeTimeout();
}

function leaveRetakeChrome() {
  if (retakeTimer) { clearTimeout(retakeTimer); retakeTimer = null; }
  state.retakeMode = false;
  setRetakeChrome(false);
}

function backToReveal() {
  setPhase('reveal');
  showCircles({ qr: false, print: true });
  setHint(revealHint());
  startResultTimer(REVEAL_TIMEOUT_MS);
}

function closeRetake() {
  leaveRetakeChrome();
  restoreNormalCoverflow();
  startCtaRotation();
  showScreen('result');
  backToReveal();
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

// Button on the start screen while choosing
export async function confirmRetakeFromBooth() {
  if (!state.retakeMode || !state.order) return;
  const sel = selectedEntry();

  if (sel && sel.__portrait) {
    const p = sel.__portrait;
    const onScreen = state.currentSession && p.sessionId === state.currentSession.id;
    leaveRetakeChrome();
    restoreNormalCoverflow();
    startCtaRotation();
    if (onScreen) {
      console.log('[TERMINAL] Guest keeps the portrait on screen');
      showScreen('result');
      return backToReveal();
    }
    console.log('[TERMINAL] Guest picks an earlier portrait', p.sessionId);
    // The paid prints move to this portrait
    window.electronAPI.orderSelectSession(state.order.id, p.sessionId)
      .then((res) => { if (res && res.error) console.warn('[TERMINAL] select-session failed:', res.error); })
      .catch((e) => console.warn('[TERMINAL] select-session failed:', e.message));
    return showPortraitResult(p);
  }

  if (!canRetakeStyle()) return; // only portraits to choose from
  leaveRetakeChrome();
  const chosen = sel;
  state.isCapturing = true;
  updateBoothBrandVisibility();
  console.log('[TERMINAL] Free retake with style', currentStyleName());
  await flyOutSelectedCard(); // same send-off as a normal capture
  // Back to the real style list, with the chosen style selected for the generation
  restoreNormalCoverflow(chosen);
  startCtaRotation();
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
      if (state.order && canOpenRetake()) openRetake();
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
