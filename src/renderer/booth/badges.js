import { t, getCurrentLanguage } from '../translations/index.js';
import { elements, state } from '../state.js';

// True when the guest has to pay (a positive print or download price is configured)
export function isPaymentActive() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  if (!pay) return false;
  const printPaid = pay.print_enabled && pay.print_tiers &&
    Object.values(pay.print_tiers).some(v => Number(v) > 0);
  const downloadPaid = pay.download_enabled && Number(pay.download_price) > 0;
  return !!(printPaid || downloadPaid);
}

// True only when guests must PAY TO PRINT (portal paid printing is enabled with a
// positive tier). The kiosk's free hold-to-print is suppressed in that case so
// prints go through the paid portal flow. Paid *downloads* don't affect this.
export function isPaidPrintActive() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  if (!pay) return false;
  return !!(pay.print_enabled && pay.print_tiers &&
    Object.values(pay.print_tiers).some(v => Number(v) > 0));
}

// Cents for a single print (first/smallest tier = most expensive per print), or null
export function getFirstPrintPriceCents() {
  const pay = state.kioskConfig && state.kioskConfig.payment;
  if (!pay || !pay.print_tiers) return null;
  const qtys = Object.keys(pay.print_tiers).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  return qtys.length ? pay.print_tiers[String(qtys[0])] : null;
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
  const pay = state.kioskConfig && state.kioskConfig.payment;
  const firstTierCents = getFirstPrintPriceCents();

  // Price circle on the booth (single-print cost)
  if (elements.priceBadge && elements.priceAmount) {
    if (pay && pay.print_enabled && firstTierCents && firstTierCents > 0) {
      elements.priceAmount.textContent = formatPrice(firstTierCents, pay.currency);
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
