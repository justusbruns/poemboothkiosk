import { loadJsonXHR } from '../booth/capture.js';
import { cancelTypingAnimation } from './poem.js';
import { resetPrintCircleIdle } from './print.js';
import { hideResultCameraBackground } from './ui.js';
import { showScreen } from '../screens.js';
import { elements, screens, state } from '../state.js';

// 0.75 → ~6s: slow enough to really feel like someone wiping the screen clean.
export const WIPE_SPEED = 0.75;
export let wipeMaskData = null;

// Load the wiping animation and recolor its stroke to black: inside a luminance
// mask, black is what erases the result screen (the source file uses white).
export async function getWipeMaskData() {
  if (!wipeMaskData) {
    const data = await loadJsonXHR('./assets/wiping.json');
    const recolor = (shape) => {
      if (shape.ty === 'st' && shape.c) shape.c.k = [0, 0, 0, 1];
      (shape.it || []).forEach(recolor);
    };
    (data.layers || []).forEach((layer) => {
      (layer.shapes || []).forEach(recolor);
      // Drop layer effects (gaussian blur): an SVG blur filter at full screen
      // resolution is too heavy for kiosk hardware. Hard stroke edge instead.
      delete layer.ef;
    });
    wipeMaskData = data;
  }
  return wipeMaskData;
}

// Reset the result screen for the next session (runs after the wipe finishes)
export function finishResultCleanup() {
  // Hide QR circle
  const qrCircle = document.getElementById('qr-circle');
  if (qrCircle) {
    qrCircle.classList.remove('show');
  }

  // Reset the print circle (icons + progress ring) for the next session
  const printCircle = document.getElementById('print-circle');
  if (printCircle) printCircle.classList.remove('show');
  resetPrintCircleIdle();

  // Reset result photo for next session (may have been hidden for image generation)
  if (elements.resultPhoto) {
    elements.resultPhoto.style.display = '';
  }
  // Detach the live camera background until the next generated-image result
  hideResultCameraBackground();

  // Reset state
  state.currentPhoto = null;
  state.currentSession = null;
  state.isProcessing = false;
  state.glassWiping = false;
}

// Fallback transition when the wiping Lottie can't run: the original glass wipe
export function triggerGlassWipeFallback() {
  elements.glassWipe.style.display = 'block';

  setTimeout(() => {
    elements.glassWipe.style.display = 'none';
    finishResultCleanup();
    showScreen('booth');
  }, 800);
}

// Replace a blurred background (live camera <video> or blurred <img>) with a still
// <canvas> snapshot that has the CSS filter baked in. During the wipe the result screen
// is re-masked every frame; a live, CSS-blurred video underneath forces Chromium to
// redo the blur each frame too, which stutters on the NUCs. Returns the canvas (or null).
export function freezeBlurredLayer(el, srcW, srcH) {
  if (!el || el.offsetWidth === 0 || !srcW || !srcH) return null;
  try {
    const boxW = el.offsetWidth;
    const boxH = el.offsetHeight;
    // Half resolution is plenty for a blurred background and halves the work
    const res = 0.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(boxW * res);
    canvas.height = Math.round(boxH * res);

    // Bake the element's CSS filter in, scaling blur radii to canvas resolution
    const cssFilter = getComputedStyle(el).filter;
    const ctx = canvas.getContext('2d');
    if (cssFilter && cssFilter !== 'none') {
      ctx.filter = cssFilter.replace(/blur\(([\d.]+)px\)/g, (_, r) => `blur(${parseFloat(r) * res}px)`);
    }

    // object-fit: cover
    const scale = Math.max(canvas.width / srcW, canvas.height / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    ctx.drawImage(el, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);

    // Same box + transforms (rotation / mirror / zoom) as the original, minus the filter
    canvas.className = el.className;
    canvas.style.cssText = el.style.cssText;
    canvas.style.width = boxW + 'px';
    canvas.style.height = boxH + 'px';
    canvas.style.filter = 'none';
    canvas.style.animation = 'none';
    canvas.dataset.wipeFreeze = '1';

    el.after(canvas);
    el.style.display = 'none';
    return canvas;
  } catch (e) {
    console.warn('[RENDERER] Could not freeze blurred layer:', e);
    return null;
  }
}

export function freezeResultBackground() {
  const video = elements.resultCamera;
  if (video && video.videoWidth) {
    if (freezeBlurredLayer(video, video.videoWidth, video.videoHeight)) video.pause();
  }
  const photo = elements.resultPhoto;
  if (photo && photo.complete && photo.naturalWidth) {
    freezeBlurredLayer(photo, photo.naturalWidth, photo.naturalHeight);
  }
}

export function unfreezeResultBackground() {
  screens.result.querySelectorAll('canvas[data-wipe-freeze]').forEach((c) => c.remove());
}

export async function triggerGlassWipe() {
  if (state.glassWiping) return; // already returning to booth - don't double-fire
  state.glassWiping = true;

  // Cancel any in-progress typing animation
  cancelTypingAnimation();

  console.log('[RENDERER] Triggering wipe-out transition...');

  let animData = null;
  try { animData = await getWipeMaskData(); }
  catch (e) { console.error('[RENDERER] Could not load wiping animation:', e); }

  const maskTarget = document.getElementById('wipe-mask-anim');
  if (!maskTarget || typeof lottie === 'undefined' || !animData) {
    triggerGlassWipeFallback();
    return;
  }

  // Show the booth screen (live camera) underneath, while the result screen stays
  // on top with the animated wipe mask erasing it. Freeze the blurred background
  // first so only the mask changes per frame.
  freezeResultBackground();
  screens.result.classList.add('wiping');
  showScreen('booth');

  maskTarget.innerHTML = '';
  const anim = lottie.loadAnimation({
    container: maskTarget,
    renderer: 'svg',
    loop: false,
    autoplay: true,
    animationData: animData,
    rendererSettings: { preserveAspectRatio: 'xMidYMid slice' }
  });
  anim.setSpeed(WIPE_SPEED);

  // Lottie sets width/height="100%" on its <svg>, which inside the mask resolves
  // against the 0x0 host <svg> instead of the masked screen — give it the real
  // viewport size so the animation covers the result screen.
  const sizeLottieSvg = () => {
    const svg = maskTarget.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', String(window.innerWidth));
      svg.setAttribute('height', String(window.innerHeight));
    }
  };
  sizeLottieSvg();
  anim.addEventListener('DOMLoaded', sizeLottieSvg);

  let finished = false;
  const finishWipe = () => {
    if (finished) return;
    finished = true;
    screens.result.classList.remove('wiping');
    try { anim.destroy(); } catch (e) { /* already destroyed */ }
    maskTarget.innerHTML = '';
    unfreezeResultBackground();
    finishResultCleanup();
  };

  anim.addEventListener('complete', finishWipe);
  // Safety net: if 'complete' never fires, force-finish after the expected duration
  setTimeout(finishWipe, (4500 / WIPE_SPEED) + 2000);
}

// Whether this result is in "hold-to-print" mode at all: free mode (paid prints go
// through the portal) and a printer is connected and ready. In this mode the result
