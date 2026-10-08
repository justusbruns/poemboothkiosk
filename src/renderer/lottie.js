import { t } from './translations/index.js';
import { elements, state } from './state.js';

// =============================================================================
// Lottie Animation Service
// =============================================================================

export async function initializeLottieAnimation() {
  console.log('[LOTTIE] === FUNCTION CALLED ===');

  try {
    console.log('[LOTTIE] Starting initialization...');
    console.log('[LOTTIE] Container element:', elements.lottieContainer ? 'EXISTS' : 'NULL');
    console.log('[LOTTIE] Lottie library:', typeof lottie);

    // Destroy existing animation if present
    if (state.lottieAnimation) {
      console.log('[LOTTIE] Destroying existing animation');
      state.lottieAnimation.destroy();
      state.lottieAnimation = null;
    }

    // Check if lottie library is loaded
    if (typeof lottie === 'undefined') {
      console.error('[LOTTIE] ERROR: Lottie library not loaded!');
      throw new Error('Lottie library not available');
    }

    // Check if container exists
    if (!elements.lottieContainer) {
      console.error('[LOTTIE] ERROR: Container element not found!');
      throw new Error('Lottie container element missing');
    }

    // Fetch animation data once per session; later renders reuse the cached JSON
    let animationData = processingAnimationData;
    if (!animationData) {
      try {
        const response = await fetch('./assets/pb-animated-logo.json');
        if (!response.ok) {
          throw new Error(`Failed to fetch animation: ${response.status} ${response.statusText}`);
        }
        animationData = await response.json();
        processingAnimationData = animationData;
        console.log('[LOTTIE] Processing animation loaded:', animationData.w, 'x', animationData.h);
      } catch (fetchError) {
        console.error('[LOTTIE] FETCH FAILED:', fetchError.message);
        throw fetchError;
      }
    }

    // Load and play animation with data
    console.log('[LOTTIE] Creating Lottie animation with CANVAS renderer (Electron compatibility)...');
    state.lottieAnimation = lottie.loadAnimation({
      container: elements.lottieContainer,
      renderer: 'canvas', // Use canvas instead of svg for Electron compatibility
      loop: true,
      autoplay: true,
      animationData: animationData,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
        clearCanvas: true,
        progressiveLoad: false,
        hideOnTransparent: true
      }
    });

    console.log('[LOTTIE] Animation object created:', !!state.lottieAnimation);

    // Defensive: restart animation if it completes while still on processing screen
    state.lottieAnimation.addEventListener('complete', () => {
      if (state.screen === 'processing' && state.lottieAnimation) {
        console.log('[LOTTIE] Animation complete but still processing - restarting');
        state.lottieAnimation.goToAndPlay(0, true);
      }
    });

    console.log('[LOTTIE] ✅ Animation initialized and playing');
  } catch (error) {
    console.error('[LOTTIE] ❌ Initialization error:', error);
    console.error('[LOTTIE] Error stack:', error.stack);
    throw error; // Re-throw so caller knows it failed
  }
}

export function destroyLottieAnimation() {
  stopLoadingTextRotation();

  // Destroy processing screen animation
  if (state.lottieAnimation) {
    console.log('[LOTTIE] Destroying processing animation...');
    state.lottieAnimation.destroy();
    state.lottieAnimation = null;
  }

  // Also destroy loading screen animation if it exists (prevent interference)
  if (state.loadingLottieAnimation) {
    console.log('[LOTTIE] Destroying loading animation...');
    state.loadingLottieAnimation.destroy();
    state.loadingLottieAnimation = null;
  }
}

// =============================================================================
// Loading Text Rotation (Processing Screen)
// =============================================================================

export function startLoadingTextRotation() {
  const messages = t('processing.loadingMessages');
  if (!messages || !Array.isArray(messages)) {
    console.log('[LOADING] No loading messages found in translations');
    return;
  }

  // Start at random index
  state.loadingTextIndex = Math.floor(Math.random() * messages.length);
  updateLoadingText();

  // Rotate every 5 seconds
  state.loadingTextInterval = setInterval(() => {
    state.loadingTextIndex = (state.loadingTextIndex + 1) % messages.length;
    updateLoadingText();
  }, 5000);

  console.log('[LOADING] Started loading text rotation with', messages.length, 'messages');
}

export function updateLoadingText() {
  const messages = t('processing.loadingMessages');
  if (elements.loadingStatusText && messages && Array.isArray(messages)) {
    // Trigger animation restart by removing and re-adding
    elements.loadingStatusText.style.animation = 'none';
    elements.loadingStatusText.offsetHeight; // Trigger reflow
    elements.loadingStatusText.style.animation = '';
    elements.loadingStatusText.textContent = messages[state.loadingTextIndex];
  }
}

export function stopLoadingTextRotation() {
  if (state.loadingTextInterval) {
    clearInterval(state.loadingTextInterval);
    state.loadingTextInterval = null;
    console.log('[LOADING] Stopped loading text rotation');
  }
  if (elements.loadingStatusText) {
    elements.loadingStatusText.textContent = '';
  }
}

export let processingAnimationData = null; // cached ./assets/pb-animated-logo.json for the processing screen

// =============================================================================
// UI Helpers
// =============================================================================

export function initLoadingLottie() {
  console.log('[LOTTIE] Initializing loading screen animation');

  if (!elements.loadingLottie) {
    console.error('[LOTTIE] Loading Lottie container not found');
    return;
  }

  try {
    // Initialize Lottie animation
    state.loadingLottieAnimation = lottie.loadAnimation({
      container: elements.loadingLottie,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      path: './assets/pb-animated-logo.json'
    });

    state.loadingLottieAnimation.addEventListener('DOMLoaded', () => {
      console.log('[LOTTIE] Animation loaded, playing frames 0-118');
      // Play animation from frame 0 to frame 118, then freeze
      state.loadingLottieAnimation.playSegments([0, 118], true);
    });

    state.loadingLottieAnimation.addEventListener('error', (err) => {
      console.error('[LOTTIE] Loading animation error:', err);
    });

    state.loadingLottieAnimation.addEventListener('complete', () => {
      console.log('[LOTTIE] Animation frozen at frame 118');
    });
  } catch (error) {
    console.error('[LOTTIE] Failed to initialize loading animation:', error);
  }
}
