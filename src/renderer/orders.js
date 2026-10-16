import { state } from './state.js';
import { getCurrentLanguage } from './translations/index.js';

// =============================================================================
// Kiosk orders (pay-first on the booth's card terminal)
// -----------------------------------------------------------------------------
// The backend brokers the terminal; the kiosk creates an order, polls it until
// the guest has tapped, and cancels it when the amount changes or the guest
// walks away. Exactly one order is "current" (state.order); status updates for
// superseded orders are ignored.
// =============================================================================

export class OrderError extends Error {
  constructor(code, message, status = 0) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

function toState(view) {
  return {
    id: view.order_id,
    kind: view.kind,
    status: view.status,
    failureReason: view.failure_reason || null,
    quantity: view.quantity,
    amountCents: view.amount_cents,
    currency: view.currency || 'EUR',
    sessionId: view.session_id || null,
    generationsLeft: typeof view.generations_left === 'number' ? view.generations_left : 0,
    // 'terminal' = tap the card on the booth; 'mollie' = scan payUrl (QR fallback)
    provider: view.provider || 'terminal',
    payUrl: view.pay_url || null
  };
}

// Create an order and make it the current one. Throws OrderError with
// code 'terminal_unavailable' when the booth has no working terminal.
function currentStyleId() {
  const style = state.availableStyles && state.availableStyles[state.currentStyleIndex];
  const id = style && style.id;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export async function createOrder(kind, quantity, sessionId = null, opts = {}) {
  // The backend falls back to a Mollie QR when the booth's terminal is
  // unavailable. Not for extra prints of a guest who paid on the terminal: a
  // QR there is confusing (they can order more via the portal QR instead).
  const view = await window.electronAPI.orderCreate(kind, quantity, sessionId, {
    allowMollieFallback: opts.allowMollieFallback !== false,
    locale: getCurrentLanguage() || 'nl',
    // The style on screen when the guest pays (conversion per style in the portal)
    styleId: kind === 'generation' ? currentStyleId() : null
  });
  if (!view || view.error) {
    throw new OrderError((view && view.error) || 'order_failed', view && view.message, view && view.status);
  }
  state.order = toState(view);
  console.log(`[ORDER] Created ${kind} ×${quantity}: ${state.order.id} (${state.order.amountCents}c, ${state.order.status}, via ${state.order.provider})`);
  return state.order;
}

export async function refreshOrder(orderId) {
  const view = await window.electronAPI.orderStatus(orderId);
  if (!view || view.error) throw new OrderError((view && view.error) || 'status_failed', view && view.message);
  const next = toState(view);
  if (state.order && state.order.id === orderId) state.order = next;
  return next;
}

// Cancel an order (fire-and-forget safe). Returns the backend's final view, or
// null on failure. A payment that was already committed stays 'paid' — callers
// that cancelled because of a quantity change must adopt such an order.
export async function cancelOrder(orderId, reason = 'cancelled_by_kiosk') {
  try {
    const view = await window.electronAPI.orderCancel(orderId, reason);
    if (!view || view.error) return null;
    const next = toState(view);
    if (state.order && state.order.id === orderId) state.order = next;
    console.log(`[ORDER] Cancelled ${orderId} → ${next.status}`);
    return next;
  } catch (e) {
    console.warn('[ORDER] Cancel failed:', e.message);
    return null;
  }
}

// Active waitForOrder loops; a Realtime 'order' poke wakes them so the status
// is fetched right away instead of at the next poll tick.
const wakers = new Set();
export function wakeOrderPolling() {
  wakers.forEach((wake) => wake());
}

// Poll an order every `intervalMs` until it leaves 'pending', the controller
// is aborted, or `timeoutMs` passes (→ resolves { status: 'timeout' }).
// Transient status errors are tolerated (the timeout is the backstop).
export function waitForOrder(orderId, { intervalMs = 1000, timeoutMs = 90000, signal = null, onUpdate = null } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timer = null;
    let done = false;

    let ticking = false;
    const wake = () => {
      if (done || ticking) return;
      if (timer) clearTimeout(timer);
      timer = null;
      tick();
    };

    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      wakers.delete(wake);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ status: 'aborted', id: orderId });
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
    }

    const tick = async () => {
      if (done) return;
      ticking = true;
      try {
        const order = await refreshOrder(orderId);
        if (done) return;
        if (onUpdate) onUpdate(order);
        if (order.status !== 'pending') return finish(order);
      } catch (e) {
        console.warn('[ORDER] Status poll failed:', e.message);
      } finally {
        ticking = false;
      }
      if (done) return;
      if (Date.now() - startedAt >= timeoutMs) return finish({ status: 'timeout', id: orderId });
      timer = setTimeout(tick, intervalMs);
    };
    wakers.add(wake);
    tick();
  });
}
