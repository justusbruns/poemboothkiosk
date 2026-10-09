import { t } from '../translations/index.js';
import { isPaidPrintActive } from './badges.js';
import { updateDebugInfo } from '../debug.js';
import { elements, state } from '../state.js';

// Carousel turning timeout for fade-out of adjacent options
export let turningTimeout = null;

// Handle style selection with knob rotation (coverflow-style carousel)
export function handleStyleChange(direction, { auto = false } = {}) {
  if (state.availableStyles.length === 0) return;
  // A guest turned the knob: stop auto-turning and give them time to choose
  if (!auto) restartIdleAttract(true);

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
// Returns a promise that resolves once every card image is downloaded and decoded,
// so the booth can wait for it at boot (no cards popping in, no blank flip side).
export function buildStyleCoverflow() {
  const cf = document.getElementById('style-coverflow');
  if (!cf) return Promise.resolve();
  cf.innerHTML = '';
  const imageLoads = [];

  state.availableStyles.forEach((style) => {
    const card = document.createElement('div');
    card.className = 'style-card';

    // Two faces so the card can flip: front = style example, back = the example's input photo
    const inner = document.createElement('div');
    inner.className = 'style-card-inner';
    const front = document.createElement('div');
    front.className = 'style-card-face style-card-front';
    inner.appendChild(front);
    card.appendChild(inner);

    const outUrl = style && style.example_output_image_url;
    if (outUrl) {
      const img = document.createElement('img');
      img.src = outUrl;
      imageLoads.push(img.decode().catch(() => {}));
      img.alt = style.name || '';
      // If the image fails to load, fall back to a name card
      img.onerror = () => {
        makePoemCard(front, style);
        card.querySelector('.style-card-back')?.remove();
        delete card.dataset.hasInput;
      };
      front.appendChild(img);
    } else {
      makePoemCard(front, style);
    }

    // Only image styles flip (poem styles have no before/after photo pair)
    const inUrl = outUrl && style.example_input_image_url;
    if (inUrl) {
      const back = document.createElement('div');
      back.className = 'style-card-face style-card-back';
      const img = document.createElement('img');
      img.src = inUrl;
      imageLoads.push(img.decode().catch(() => {}));
      img.alt = '';
      // No input photo to show → this card never flips
      img.onerror = () => { back.remove(); delete card.dataset.hasInput; };
      back.appendChild(img);
      // Small label so it's clear this is the photo that went in
      const badge = document.createElement('span');
      badge.className = 'input-badge';
      back.appendChild(badge);
      inner.appendChild(back);
      card.dataset.hasInput = '1';
    }

    cf.appendChild(card);
  });

  positionStyleCoverflow();
  updateActionLabel();
  if (state.screen === 'booth') restartIdleAttract();
  return Promise.all(imageLoads);
}

// Turn a card face into a poem "record sleeve" with the poet/style name
export function makePoemCard(face, style) {
  face.classList.add('style-card-poem');
  face.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'poet-name';
  name.textContent = (style && (style.name || style.action_button_text)) || '';
  face.appendChild(name);
}

// ---------------------------------------------------------------------------
// Idle attract loop. Nobody around: the carousel turns by itself and each style
// briefly flips to its input photo (what went in → what came out). Someone using
// the knob: no auto-turning, so they can choose in peace; once they rest on a
// style for a moment, that style flips once to show its input.
// ---------------------------------------------------------------------------
const IDLE_START_MS = 5000;           // booth shown, no input → start attract
const STYLE_DWELL_MS = 5000;          // attract: time on a style before it flips
const FLIP_HOLD_MS = 3000;            // how long the input photo stays visible
const FLIP_SETTLE_MS = 1200;          // flip-back animation before moving on
const STEP_NO_INPUT_MS = 4000;        // attract: time on a style that has no input photo
const USER_REST_FLIP_MS = 3500;       // knob at rest this long → show that style's input
const USER_QUIET_RESUME_MS = 30000;   // knob untouched this long → attract resumes

let attractGen = 0;

// Resolves true when the wait finished, false when the loop was cancelled meanwhile
function attractSleep(ms, gen) {
  return new Promise((resolve) => setTimeout(() => resolve(gen === attractGen), ms));
}

function attractAllowed() {
  return state.screen === 'booth' && !state.isProcessing && !state.isCapturing && state.availableStyles.length > 0;
}

function centreCard() {
  const cf = document.getElementById('style-coverflow');
  return cf ? cf.children[state.currentStyleIndex] : null;
}

function unflipAllCards() {
  const cf = document.getElementById('style-coverflow');
  if (!cf) return;
  for (const card of cf.children) card.classList.remove('flipped');
}

// Flip the centre card to its input photo, hold, flip back. Resolves false if cancelled.
async function flipCentreCard(gen) {
  const card = centreCard();
  if (!card || !card.dataset.hasInput || !attractAllowed()) return gen === attractGen;
  const badge = card.querySelector('.input-badge');
  if (badge) badge.textContent = t('booth.inputBadge'); // set here so a language switch is picked up
  card.classList.add('flipped');
  if (!(await attractSleep(FLIP_HOLD_MS, gen))) return false;
  card.classList.remove('flipped');
  return attractSleep(FLIP_SETTLE_MS, gen);
}

async function runIdleAttract(gen, afterUserInput) {
  if (afterUserInput) {
    // Guest is choosing: show the style they rest on, then stay still for a long while
    if (!(await attractSleep(USER_REST_FLIP_MS, gen))) return;
    if (!(await flipCentreCard(gen))) return;
    const rest = USER_QUIET_RESUME_MS - USER_REST_FLIP_MS - FLIP_HOLD_MS - FLIP_SETTLE_MS;
    if (!(await attractSleep(Math.max(0, rest), gen))) return;
  } else if (!(await attractSleep(IDLE_START_MS, gen))) return;

  // Attract: show the current style's input, then turn to the next one, and repeat
  while (gen === attractGen && attractAllowed()) {
    if (centreCard()?.dataset.hasInput) {
      if (!(await flipCentreCard(gen))) return;
    }
    if (state.availableStyles.length > 1) {
      handleStyleChange('clockwise', { auto: true });
      const dwell = centreCard()?.dataset.hasInput ? STYLE_DWELL_MS : STEP_NO_INPUT_MS;
      if (!(await attractSleep(dwell, gen))) return;
    } else if (!(await attractSleep(STYLE_DWELL_MS, gen))) return;
  }
}

// (Re)start the idle timing; any running attract loop or flip is cancelled.
// afterUserInput = the guest just turned the knob (longer calm before auto-turning).
export function restartIdleAttract(afterUserInput = false) {
  stopIdleAttract();
  runIdleAttract(attractGen, afterUserInput);
}

export function stopIdleAttract() {
  attractGen++;
  unflipAllCards();
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
  // Only invite guests to pick a style when there is something to pick
  if (state.availableStyles.length > 1) phrases.push(t('booth.ctaPickStyle'));
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
  stopIdleAttract();
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
  restartIdleAttract();
}
