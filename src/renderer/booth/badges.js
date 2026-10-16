import { t, getCurrentLanguage } from '../translations/index.js';
import { elements, state } from '../state.js';

// Fake tiers for --mock-terminal when the booking has none configured
const MOCK_TIERS = { '1': 500, '2': 700, '3': 900, '4': 1100 };

function paymentConfig() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  if (state.mockTerminal) {
    const hasTiers = pay && pay.print_tiers && Object.values(pay.print_tiers).some(v => Number(v) > 0);
    return { currency: 'EUR', ...(pay || {}), mode: 'terminal', print_enabled: true,
      print_tiers: hasTiers ? pay.print_tiers : MOCK_TIERS };
  }
  return pay || null;
}

function hasPaidTiers(pay) {
  return !!(pay && pay.print_enabled && pay.print_tiers &&
    Object.values(pay.print_tiers).some(v => Number(v) > 0));
}

// Pay-first flow: the guest pays on the booth's own card terminal BEFORE the
// portrait is generated (payment.mode === 'terminal'). The kiosk prints itself.
export function isTerminalPayMode() {
  const pay = paymentConfig();
  return !!(pay && pay.mode === 'terminal' && hasPaidTiers(pay));
}

// True when the guest has to pay (a positive print or download price is configured)
export function isPaymentActive() {
  const pay = paymentConfig();
  if (!pay) return false;
  const downloadPaid = pay.download_enabled && Number(pay.download_price) > 0;
  return !!(hasPaidTiers(pay) || downloadPaid);
}

// True only when guests must PAY TO PRINT *through the portal* (paid printing is
// enabled with a positive tier and the booking is not in terminal mode). The
// kiosk's free hold-to-print is suppressed in that case so prints go through the
// paid portal flow. Paid *downloads* and the terminal flow don't affect this.
export function isPaidPrintActive() {
  const pay = paymentConfig();
  return hasPaidTiers(pay) && pay.mode !== 'terminal';
}

// Sorted quantities that have a price (e.g. [1, 2, 3, 5])
export function getTierQuantities() {
  const pay = paymentConfig();
  if (!pay || !pay.print_tiers) return [];
  return Object.keys(pay.print_tiers)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0 && Number(pay.print_tiers[String(n)]) > 0)
    .sort((a, b) => a - b);
}

// Total price in cents for `quantity` prints, or null when that tier isn't offered
export function getTierPriceCents(quantity) {
  const pay = paymentConfig();
  if (!pay || !pay.print_tiers) return null;
  const v = Number(pay.print_tiers[String(quantity)]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Price for `extra` more prints when `already` are paid (difference to that tier)
export function getExtraPrintPriceCents(already, extra) {
  const target = getTierPriceCents(already + extra);
  if (target === null) return null;
  if (already === 0) return target;
  const base = getTierPriceCents(already);
  if (base === null) return null;
  return target - base > 0 ? target - base : null;
}

export function getCurrency() {
  const pay = paymentConfig();
  return (pay && pay.currency) || 'EUR';
}

// Cents for a single print (first/smallest tier = most expensive per print), or null
export function getFirstPrintPriceCents() {
  const qtys = getTierQuantities();
  return qtys.length ? getTierPriceCents(qtys[0]) : null;
}

// Format a price (in minor units / cents) with the right currency for the active language
export function formatPrice(cents, currency) {
  const amount = (cents || 0) / 100;
  const locale = getCurrentLanguage() || 'nl';
  try {
    const opts = { style: 'currency', currency: currency || 'EUR' };
    if (Number.isInteger(amount)) { opts.minimumFractionDigits = 0; opts.maximumFractionDigits = 0; }
    return new Intl.NumberFormat(locale, opts).format(amount);
  } catch (e) {
    return (currency === 'EUR' ? '€ ' : '') + amount.toFixed(2);
  }
}

// Show the single-print price badge on the booth when paid printing is enabled.
// Shows the first tier (one print) — the most expensive per-print rate.
export function updatePriceBadge() {
  const pay = paymentConfig();
  const firstTierCents = getFirstPrintPriceCents();

  // Price circle on the booth (single-print cost)
  if (elements.priceBadge && elements.priceAmount) {
    if (pay && pay.print_enabled && firstTierCents && firstTierCents > 0) {
      elements.priceAmount.textContent = formatPrice(firstTierCents, pay.currency);
      const only = document.getElementById('price-only');
      if (only) only.textContent = t('booth.priceOnly');
      elements.priceBadge.style.display = 'flex';
    } else {
      elements.priceBadge.style.display = 'none';
    }
  }

}

// Show/hide the terms notice (small text + mini QR) under the booth action button.
// Driven by config.terms.enabled; content.url / content.text override the defaults.
// Dev preview: pass --force-terms to show it without flipping the backend flag.
export function updateTermsNotice() {
  if (!elements.termsNotice) return;

  const terms = state.kioskConfig && state.kioskConfig.terms;
  const forceShow = window.location.search.includes('forceTerms');
  const enabled = !!(terms && terms.enabled) || forceShow;

  if (!enabled) {
    elements.termsNotice.style.display = 'none';
    return;
  }

  const content = (terms && terms.content) || {};
  const url = content.url || 'https://poembooth.com/terms';
  const text = content.text || t('terms.agree');
  const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  // URL sits inline at the end of the same sentence, no separate styling
  if (elements.termsText) elements.termsText.textContent = `${text} ${displayUrl}`;

  elements.termsNotice.style.display = 'flex';
}

// Set the QR action label based on whether a printer is currently connected.
// Printing now happens from the guest's phone (portal print button), so when a
