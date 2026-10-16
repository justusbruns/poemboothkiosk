// =============================================================================
// "Temporarily out of order": at events where guests pay for prints, a booth
// whose printer is offline or out of paper must not take new guests (they
// would pay and get no print). The start screen then shows a clear notice and
// the button does nothing until the printer is back. Free events keep working
// (guests simply get the digital version).
//
// Inputs: printer status from main ('printer:statusChange') and the DNP supply
// reading (paper, jam, cover; 'printer:supply', about every 25 s).
// =============================================================================

import { t } from './translations/index.js';
import { isPaidPrintActive, isTerminalPayMode } from './booth/badges.js';
import { state } from './state.js';
import { setLedPhase } from './leds.js';

const PRINTER_DOWN = ['offline', 'hardware_err', 'paper_jam', 'cover_open', 'setting_err', 'ribbon_err'];
const PAPER_OUT = ['paper_out', 'ribbon_out'];

function paidPrinting() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  return !!(pay && pay.print_enabled && (isTerminalPayMode() || isPaidPrintActive()));
}

// null when the booth can take guests, else 'paper' | 'printer'
export function outOfServiceReason() {
  if (!paidPrinting()) return null;
  const status = state.printerStatus;
  // 'unknown' / 'initializing': no verdict yet (boot), do not block on that
  if (status && status.available === false && !['unknown', 'initializing', 'not_initialized'].includes(status.status)) return 'printer';
  const supply = state.printerSupply;
  if (supply && supply.ok) {
    if (PAPER_OUT.includes(supply.state) || supply.sheets_remaining === 0) return 'paper';
    if (supply.error && PRINTER_DOWN.includes(supply.state)) return 'printer';
  }
  return null;
}

export function updateOutOfService() {
  const el = document.getElementById('out-of-service');
  if (!el) return;
  const reason = outOfServiceReason();
  const was = el.dataset.reason || '';
  if (!reason) {
    el.style.display = 'none';
    el.dataset.reason = '';
    if (was && state.screen === 'booth') setLedPhase('idle');
    return;
  }
  const title = document.getElementById('oos-title');
  const text = document.getElementById('oos-text');
  if (title) title.textContent = t('outOfService.title');
  if (text) text.textContent = t(reason === 'paper' ? 'outOfService.paper' : 'outOfService.printer');
  el.style.display = 'flex';
  el.dataset.reason = reason;
  if (!was) console.warn('[OUT-OF-SERVICE] Booth paused:', reason);
  if (state.screen === 'booth') setLedPhase('error');
}

export function setPrinterSupply(supply) {
  state.printerSupply = supply || null;
  updateOutOfService();
}
