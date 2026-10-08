import { updateBoothBrandVisibility } from '../screens.js';
import { elements, state } from '../state.js';

// Strip protocol / www / trailing slash so e.g. "https://www.url.com/" → "url.com".
export function formatDisplayUrl(url) {
  return String(url || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

// Read the hub's own branding from config, if any. hub_branding may be null or an
// object; we accept a few likely key names for the logo image and the URL so it
// works regardless of exactly how the backend names them.
export function getHubBranding() {
  const hb = state.kioskConfig && state.kioskConfig.hub_branding;
  if (!hb || typeof hb !== 'object') return null;
  const logo = hb.logo_url || hb.logo || hb.image_url || hb.image || hb.logo_image_url || null;
  const url = hb.url || hb.website || hb.link || hb.site || null;
  if (!logo && !url) return null;
  return { logo, url };
}

// Decide what (if anything) goes in the top branding slot, based on config:
//  - client white-label (branding_enabled === true) → show NOTHING (even if the
//    hub has its own branding) — we don't advertise on a branded booking
//  - else hub_branding set → the hub's static logo + their URL
//  - else → the default Poem Booth animated logo + poembooth.com
// Runs once, the first time the booth screen appears.
export let boothBrandInitialized = false;
export function setupBoothBrand() {
  if (boothBrandInitialized) return;
  if (!elements.boothBrand) return;
  boothBrandInitialized = true;

  const clientBranded = !!(state.kioskConfig && state.kioskConfig.branding_enabled);
  if (clientBranded) {
    // Client supplies their own branding → keep the top of the booth clean
    state.showBoothBrand = false;
    updateBoothBrandVisibility();
    return;
  }

  const hub = getHubBranding();
  if (hub) {
    renderHubBrand(hub);
  } else {
    renderPoemBoothBrand();
  }
  state.showBoothBrand = true;
  updateBoothBrandVisibility();
}

// Hub branding: a static logo image + the hub's URL (protocol stripped).
export function renderHubBrand(hub) {
  const container = elements.boothBrandLogo;
  if (container) {
    container.innerHTML = '';
    if (hub.logo) {
      const img = document.createElement('img');
      img.src = hub.logo;
      img.alt = 'Logo';
      img.className = 'booth-brand-img';
      container.appendChild(img);
    }
  }
  if (elements.boothBrandUrl) {
    if (hub.url) {
      elements.boothBrandUrl.textContent = formatDisplayUrl(hub.url);
      elements.boothBrandUrl.style.display = '';
    } else {
      elements.boothBrandUrl.style.display = 'none';
    }
  }
}

// Default Poem Booth branding: animated logo + poembooth.com.
export function renderPoemBoothBrand() {
  if (elements.boothBrandUrl) {
    elements.boothBrandUrl.textContent = 'poembooth.com';
    elements.boothBrandUrl.style.display = '';
  }
  playBoothBrandLogo();
}

// Animate the Poem Booth branding logo (first frames of the startup animation) once,
// the first time the booth screen appears, then freeze the formed logo.
export let boothBrandPlayed = false;
export function playBoothBrandLogo() {
  if (boothBrandPlayed) return;
  const container = elements.boothBrandLogo;
  if (!container || typeof lottie === 'undefined') return;
  boothBrandPlayed = true;
  try {
    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: './assets/pb-animated-logo.json'
    });
    anim.addEventListener('DOMLoaded', () => {
      anim.playSegments([0, 118], true); // logo appears, then freezes
    });
    state.boothBrandAnimation = anim;
  } catch (e) {
    console.error('[LOTTIE] Failed to init booth brand logo:', e);
  }
}
