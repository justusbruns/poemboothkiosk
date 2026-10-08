import { t } from '../translations/index.js';
import { capturePhoto } from './camera.js';
import { flyOutSelectedCard } from './coverflow.js';
import { processPhoto } from '../generate.js';
import { updateBoothBrandVisibility } from '../screens.js';
import { elements, state } from '../state.js';
import { showError } from '../ui.js';

// =============================================================================
// Photo Capture Flow
// =============================================================================

// Cache of the raw countdown animation data (loaded once, text localized per play)
export let countdownBaseData = null;

export function loadJsonXHR(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'json';
    xhr.onload = () => {
      // file:// returns status 0 on success
      if (xhr.status === 200 || xhr.status === 0) resolve(xhr.response);
      else reject(new Error('HTTP ' + xhr.status));
    };
    xhr.onerror = () => reject(new Error('XHR error loading ' + url));
    xhr.send();
  });
}

// Load the countdown animation and swap its baked text layers for the active language
export async function getLocalizedCountdownData() {
  if (!countdownBaseData) {
    countdownBaseData = await loadJsonXHR('./assets/pb_countdown.json');
  }
  const data = JSON.parse(JSON.stringify(countdownBaseData)); // clone so the cached base stays clean
  // Drop the baked-in flash layer: the DOM #white-flash overlay does the flash instead,
  // so it stays in sync with the capture even when the Lottie drops frames.
  data.layers = (data.layers || []).filter((layer) => layer.nm !== 'flash');
  const map = {
    txt_look: t('countdown.look'),
    txt_ready: t('countdown.ready'),
    txt_pose: t('countdown.pose'),
    txt_smile: t('countdown.smile')
  };
  (data.layers || []).forEach((layer) => {
    if (layer.ty === 5 && map[layer.nm] != null) {
      try { layer.t.d.k[0].s.t = map[layer.nm]; } catch (e) { /* keep baked text on failure */ }
    }
  });
  return data;
}

// Delay between the screen going white and the capture, so the lit camera frame has had
// time to travel through the camera pipeline. Must stay well below the overlay's white hold.
export const FLASH_CAPTURE_DELAY_MS = 200;

// Run fn when the camera delivers its next frame (timer fallback if the API is missing)
export function onNextVideoFrame(video, fn) {
  if (video && typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => fn());
  } else {
    setTimeout(fn, 34);
  }
}

// Flash the screen white and grab the camera frame while it is white. The overlay is a
// plain DOM element with a CSS animation (cheap, GPU-composited), so the white is really
// on screen at the moment of capture — unlike a Lottie flash layer, which can be skipped
// or delayed when the animation drops frames on slower kiosks.
export function flashAndCapture() {
  const flash = elements.whiteFlash;
  const capture = () => capturePhoto(elements.cameraVideo, elements.cameraCanvas)
    .then((url) => { state.currentPhoto = url; })
    .catch((e) => console.error('[RENDERER] Capture during flash failed:', e));

  if (!flash) return capture();

  const flashFaded = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      flash.removeEventListener('animationend', finish);
      flash.style.display = 'none';
      resolve();
    };
    flash.addEventListener('animationend', finish);
    flash.style.display = 'block'; // (re)starts the CSS flash animation: hold white, then fade
    setTimeout(finish, 1500);      // safety net if animationend never fires
  });

  // Wait until the white overlay has actually been painted, then give the camera time to
  // see it: a webcam frame only reaches the <video> element ~100-200ms after it was exposed,
  // so capturing right away grabs a frame from before the flash (an unlit face). The overlay
  // holds full white for ~500ms, so FLASH_CAPTURE_DELAY_MS keeps us well inside the white;
  // we then draw the next fresh camera frame rather than whatever is still in the element.
  const captured = new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => {
        onNextVideoFrame(elements.cameraVideo, () => {
          console.log('[RENDERER] Flash on screen — capturing photo');
          capture().then(resolve);
        });
      }, FLASH_CAPTURE_DELAY_MS);
    }));
  });

  // Done once the photo is taken AND the flash has faded out
  return Promise.all([captured, flashFaded]).then(() => {});
}

// Play the countdown Lottie over the live camera, then flash and capture the photo.
// The animation is 1080x1920 (9:16), 30fps, 276 frames (9.2s, 5-4-3-2-1); its own flash
// layer starts at frame 266, which is when we hand over to the DOM flash + capture.
export async function playCountdownAndCapture() {
  const FLASH_FRAME = 266;
  const FLASH_FRAME_MS = (FLASH_FRAME / 30) * 1000;
  const container = elements.countdownLottie;

  let animData = null;
  try { animData = await getLocalizedCountdownData(); }
  catch (e) { console.error('[RENDERER] Could not load countdown animation:', e); }

  return new Promise((resolve) => {
    // Fallback: if the animation can't run, just capture immediately
    if (!container || typeof lottie === 'undefined' || !animData) {
      capturePhoto(elements.cameraVideo, elements.cameraCanvas)
        .then((url) => { state.currentPhoto = url; })
        .catch((e) => console.error('[RENDERER] Fallback capture failed:', e))
        .finally(resolve);
      return;
    }

    container.innerHTML = '';
    container.style.display = 'block';

    const anim = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      animationData: animData,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice' }
    });

    const startedAt = performance.now();
    let flashStarted = false;
    let wallClockTimer = null;

    // Hand over from the Lottie to the DOM flash + capture. Runs once, from whichever
    // fires first: the Lottie reaching the flash frame, or the wall clock (so a stalled
    // or throttled animation can never delay the flash).
    const startFlash = () => {
      if (flashStarted) return;
      flashStarted = true;
      clearTimeout(wallClockTimer);
      console.log(`[RENDERER] Countdown done after ${Math.round(performance.now() - startedAt)}ms — flashing`);
      // Stop the Lottie right away so it doesn't compete for frames with the flash
      try { anim.destroy(); } catch (e) {}
      container.style.display = 'none';
      container.innerHTML = '';
      flashAndCapture().finally(resolve);
    };

    anim.addEventListener('enterFrame', (e) => {
      if (e.currentTime >= FLASH_FRAME) startFlash();
    });
    wallClockTimer = setTimeout(startFlash, FLASH_FRAME_MS + 100);

    anim.addEventListener('complete', startFlash); // safety net if the frame event was skipped
    anim.addEventListener('data_failed', () => {
      console.error('[RENDERER] Countdown animation failed to load');
      startFlash();
    });
  });
}

export async function handleCapture() {
  console.log('[RENDERER] handleCapture() called, isProcessing:', state.isProcessing);

  if (state.isProcessing) {
    console.log('[RENDERER] Already processing, ignoring capture request');
    return;
  }

  // The booth screen is already active during the wipe-out transition; don't
  // start a capture until the previous result is fully erased.
  if (state.glassWiping) {
    console.log('[RENDERER] Wipe transition in progress, ignoring capture request');
    return;
  }
  state.isProcessing = true;

  try {
    // Hide the top branding the moment capture begins — it only belongs on the idle home screen
    state.isCapturing = true;
    updateBoothBrandVisibility();

    // Selected style card flies toward the viewer before the countdown
    console.log('[RENDERER] Flying out selected style card...');
    await flyOutSelectedCard();

    // Play the new countdown animation over the live camera; it captures the photo during its flash
    console.log('[RENDERER] Playing countdown animation...');
    await playCountdownAndCapture();
    console.log('[RENDERER] Photo captured during flash, length:', state.currentPhoto ? state.currentPhoto.length : 0);

    // Auto-proceed to processing (no confirmation needed)
    console.log('[RENDERER] Proceeding automatically to processPhoto()...');
    await processPhoto();

  } catch (error) {
    console.error('[RENDERER] Capture error:', error);
    if (elements.countdownLottie) {
      elements.countdownLottie.style.display = 'none';
      elements.countdownLottie.innerHTML = '';
    }
    if (elements.whiteFlash) elements.whiteFlash.style.display = 'none';
    state.isProcessing = false;
    showError('Capture failed', error.message, error);
  }
}
