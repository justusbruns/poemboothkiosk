import { t } from '../translations/index.js';
import { isPaidPrintActive } from './badges.js';
import { updateDebugInfo } from '../debug.js';
import { elements, state } from '../state.js';

// Carousel turning timeout for fade-out of adjacent options
export let turningTimeout = null;

// Handle style selection with knob rotation (coverflow-style carousel)
export function handleStyleChange(direction) {
  if (state.availableStyles.length === 0) return;

  // Calculate new index
  if (direction === 'clockwise') {
    state.currentStyleIndex = (state.currentStyleIndex + 1) % state.availableStyles.length;
  } else {
    state.currentStyleIndex = (state.currentStyleIndex - 1 + state.availableStyles.length) % state.availableStyles.length;
  }

  const currentStyle = state.availableStyles[state.currentStyleIndex];
  console.log('[STYLE] Selected:', currentStyle.name, `(${state.currentStyleIndex + 1}/${state.availableStyles.length})`);

  // Reposition the coverflow + update the style name label (CSS transitions animate the move)
  positionStyleCoverflow();
  updateActionLabel();
  updateDebugInfo();
}

// Build the coverflow cards from the available styles.
// Image styles show their example output image; poem styles show a "record sleeve" name card.
export function buildStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (!cf) return;
  cf.innerHTML = '';

  state.availableStyles.forEach((style) => {
    const card = document.createElement('div');
    card.className = 'style-card';

    const outUrl = style && style.example_output_image_url;
    if (outUrl) {
      const img = document.createElement('img');
      img.src = outUrl;
      img.alt = style.name || '';
      // If the image fails to load, fall back to a name card
      img.onerror = () => makePoemCard(card, style);
      card.appendChild(img);
    } else {
      makePoemCard(card, style);
    }

    cf.appendChild(card);
  });

  positionStyleCoverflow();
  updateActionLabel();
}

// Turn a card into a poem "record sleeve" with the poet/style name
export function makePoemCard(card, style) {
  card.classList.add('style-card-poem');
  card.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'poet-name';
  name.textContent = (style && (style.name || style.action_button_text)) || '';
  card.appendChild(name);
}

// Position each card in the coverflow based on its circular distance from the current style
export function positionStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (!cf) return;
  const cards = cf.children;
  const N = state.availableStyles.length;

  for (let i = 0; i < cards.length; i++) {
    let o = i - state.currentStyleIndex;
    if (N > 0) {
      // shortest way around the ring so neighbours appear on both sides
      if (o > N / 2) o -= N;
      if (o < -N / 2) o += N;
    }
    const ao = Math.abs(o);
    const dir = Math.sign(o); // -1 = left, +1 = right

    // 3D cover-flow: side cards sit closer together and tilt inward toward the centre,
    // so many more styles fit on screen at once.
    let x, angle, scale, opacity, z;
    if (ao === 0)      { x = 0;   angle = 0;  scale = 1.0;  opacity = 1;    z = 30; }
    else if (ao === 1) { x = 92;  angle = 45; scale = 0.82; opacity = 0.85; z = 20; }
    else if (ao === 2) { x = 150; angle = 52; scale = 0.66; opacity = 0.5;  z = 12; }
    else if (ao === 3) { x = 196; angle = 55; scale = 0.55; opacity = 0.28; z = 6; }
    else               { x = 236; angle = 55; scale = 0.5;  opacity = 0;    z = 0; }

    const tx = dir * x;
    const rotY = -dir * angle; // left cards face right, right cards face left

    const card = cards[i];
    card.style.transform = `translateX(${tx}px) rotateY(${rotY}deg) scale(${scale})`;
    card.style.opacity = String(opacity);
    card.style.zIndex = String(z);
  }
}

// Update the call-to-action under the coverflow based on how many styles there are
export function updateActionLabel() {
  // The small "turn the knob" hint only appears when there's more than one style
  if (elements.styleHint) {
    elements.styleHint.textContent = t('booth.turnKnob');
    elements.styleHint.style.display = state.availableStyles.length > 1 ? 'block' : 'none';
  }
}

// Rotating hero CTA — cycles through inspiring phrases to invite people to use the booth
export let ctaRotationInterval = null;
export let ctaPhraseIndex = 0;

export function getCtaPhrases() {
  const phrases = [t('booth.cta1')];
  // "Trying is Free" only makes sense when guests actually have to pay to print
  if (isPaidPrintActive()) phrases.push(t('booth.cta2'));
  phrases.push(t('booth.cta3'));
  return phrases;
}

export function renderCtaPhrase() {
  if (!elements.actionButtonText) return;
  const phrases = getCtaPhrases();
  elements.actionButtonText.innerHTML = phrases[ctaPhraseIndex % phrases.length];
  // Re-trigger the grow-in animation every time the phrase changes (smooth ease-out,
  // no bounce — scales up from small with a gentle fade)
  elements.actionButtonText.style.animation = 'none';
  void elements.actionButtonText.offsetWidth; // reflow so the animation restarts
  elements.actionButtonText.style.animation = 'ctaSlideIn 0.75s cubic-bezier(0.16, 1, 0.3, 1)';
}

export function startCtaRotation() {
  stopCtaRotation();
  ctaPhraseIndex = 0;
  if (elements.actionButtonText) elements.actionButtonText.style.opacity = '1';
  renderCtaPhrase();
  ctaRotationInterval = setInterval(() => {
    // Skip while capturing or off the booth screen so we don't fight the fade-out
    if (!elements.actionButtonText || state.isProcessing || state.screen !== 'booth') return;
    ctaPhraseIndex = (ctaPhraseIndex + 1) % getCtaPhrases().length;
    renderCtaPhrase();
  }, 2800);
}

export function stopCtaRotation() {
  if (ctaRotationInterval) { clearInterval(ctaRotationInterval); ctaRotationInterval = null; }
}

// On capture: the selected card rushes toward the viewer, then the countdown begins.
export function flyOutSelectedCard() {
  return new Promise((resolve) => {
    const cf = document.getElementById('style-coverflow');
    if (!cf || !cf.children.length) { resolve(); return; }
    const cards = cf.children;

    // Fade out the surrounding cards and the labels
    for (let i = 0; i < cards.length; i++) {
      if (i !== state.currentStyleIndex) {
        cards[i].style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        cards[i].style.opacity = '0';
      }
    }
    if (elements.styleHint) elements.styleHint.style.opacity = '0';
    if (elements.actionButtonText) elements.actionButtonText.style.opacity = '0';
    if (elements.termsNotice) {
      elements.termsNotice.style.transition = 'opacity 0.3s ease';
      elements.termsNotice.style.opacity = '0';
    }

    // Hide the pulsating circles for the countdown
    const pulse = document.querySelector('.pulsating-circles');
    if (pulse) {
      pulse.style.transition = 'opacity 0.3s ease';
      pulse.style.opacity = '0';
    }

    // Fade out the price badge with the coverflow
    if (elements.priceBadge) {
      elements.priceBadge.style.transition = 'opacity 0.3s ease';
      elements.priceBadge.style.opacity = '0';
    }

    // The selected card flies toward the viewer and fades out
    const center = cards[state.currentStyleIndex];
    if (center) {
      center.style.transition = 'transform 0.7s cubic-bezier(0.5, 0, 0.75, 0), opacity 0.7s ease';
      center.style.transform = 'translateX(0) rotateY(0deg) scale(2.8)';
      center.style.opacity = '0';
      center.style.zIndex = '40';
    }

    setTimeout(resolve, 600);
  });
}

// Restore the coverflow to its resting state after returning to the booth
export function resetStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (cf && cf.children.length) {
    const cards = cf.children;
    for (let i = 0; i < cards.length; i++) cards[i].style.transition = 'none';
    positionStyleCoverflow();
    void cf.offsetWidth; // reflow so the snap-back isn't animated
    for (let i = 0; i < cards.length; i++) cards[i].style.transition = '';
  }
  if (elements.styleHint) elements.styleHint.style.opacity = '';
  if (elements.actionButtonText) elements.actionButtonText.style.opacity = '';
  const pulse = document.querySelector('.pulsating-circles');
  if (pulse) pulse.style.opacity = '';
  if (elements.priceBadge) elements.priceBadge.style.opacity = '';
  if (elements.termsNotice) elements.termsNotice.style.opacity = '';
  updateActionLabel();
  startCtaRotation();
}
