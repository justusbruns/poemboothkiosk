import { t } from './translations/index.js';
import { destroyLottieAnimation, initializeLottieAnimation, startLoadingTextRotation } from './lottie.js';
import { cancelTypingAnimation, showPoemWithTypingEffect } from './result/poem.js';
import { updatePrintContainerVisibility } from './result/print.js';
import { showQRCode } from './result/qr.js';
import { showResultCameraBackground, updateResultActionLabel, updateResultPaymentUI } from './result/ui.js';
import { showScreen } from './screens.js';
import { createStarfield } from './starfield.js';
import { playReveal } from './result/reveal.js';
import { elements, screens, state } from './state.js';
import { showNotification, updateProgress } from './ui.js';
import { handlePaidGenerationFailure } from './retry.js';

// opts.orderId: paid kiosk order (pay-first terminal flow) that entitles this
// generation; opts.retake: the free second generation of that order;
// opts.retriedSamePhoto / opts.newPhoto: retries after a failed paid
// generation (see retry.js).
// Stars keep flying on the processing screen after a payment (theater)
let processingStars = null;
function startProcessingStars() {
  const canvas = document.getElementById('processing-stars');
  if (!canvas) return;
  if (!processingStars) processingStars = createStarfield(canvas, { count: 140 });
  processingStars.setSpeed(2.2, true);
  processingStars.start();
}

function stopProcessingStars() {
  if (processingStars) processingStars.stop();
}

export async function processPhoto(opts = {}) {
  const orderId = opts.orderId || null;
  try {
    // Cancel any in-progress typing animation from previous session
    cancelTypingAnimation();

    // Validate we have a photo
    if (!state.currentPhoto) {
      console.error('[RENDERER] ERROR: No photo captured! Cannot generate content.');
      throw new Error('No photo captured');
    }

    console.log('[RENDERER] Processing photo, length:', state.currentPhoto.length);

    // opts.gate: the paywall's "Paid!" moment is still on screen. The upload
    // and generation start right away; the processing screen (and the result)
    // only take over once the gate opens.
    const gate = opts.gate || null;
    state.revealGate = gate;
    // Forget the previous generation (a retake starts from a result on screen:
    // its 'resultShown' must not keep the processing screen away)
    state.generate = null;
    const enterProcessing = async () => {
      if (state.generate && state.generate.resultShown) return; // result came first
      // Show processing screen with captured photo ("theater" escalation after a payment)
      if (screens.processing) screens.processing.classList.toggle('theater', !!orderId);
      showScreen('processing');
      // Display the captured photo full-screen
      elements.processingPhoto.src = state.currentPhoto;
      if (orderId) startProcessingStars();
      // Start loading text rotation
      startLoadingTextRotation();
      // Initialize and play Lottie animation
      try {
        await initializeLottieAnimation();
      } catch (lottieError) {
        console.error('[RENDERER] Lottie animation failed:', lottieError);
        // Continue even if animation fails
      }
    };
    if (gate) gate.then(enterProcessing);
    else await enterProcessing();

    updateProgress('Sending photo to AI...', 10);

    // Get selected style (if available)
    const selectedStyle = state.availableStyles.length > 0
      ? state.availableStyles[state.currentStyleIndex]
      : null;

    const metadata = {
      equipment_id: state.deviceConfig.equipment_id,
      hub_id: state.deviceConfig.hub_id
    };

    // Include style in metadata if selected
    if (selectedStyle) {
      metadata.style = selectedStyle.id || selectedStyle.name;
      console.log('[RENDERER] Using selected style:', selectedStyle.name);
    }
    if (orderId) metadata.order_id = orderId;

    // Upload a downscaled copy: the backend caption model downsamples anyway,
    // and a 4K/q0.95 JPEG (~1.5 MB) was the single biggest avoidable delay.
    const uploadPhoto = await downscalePhotoDataUrl(state.currentPhoto, 2048, 0.85);

    // Streaming generation: the main process forwards NDJSON events from the
    // backend ('generate:event'); handleGenerateEvent drives the UI (poem
    // typing while tokens arrive, QR when the backend render is ready).
    state.generate = {
      started: false, sessionId: null, type: null,
      poemStream: null, render: null, renderError: null, done: false, startedAt: Date.now()
    };
    state.generateHandler = handleGenerateEvent;

    console.log('[RENDERER] Calling API to generate content (streaming)...');
    let result;
    try {
      result = await window.electronAPI.apiGenerateContent(uploadPhoto, metadata);
    } finally {
      state.generateHandler = null;
    }
    // Failures and results below may only show once the paid moment is over
    if (gate) await gate;

    const g = state.generate;
    // Pay-first: the poem was written but its picture could not be rendered,
    // so there is nothing to hand over: retry (or refund) like any failure.
    if (orderId && g.paidRenderFailed) {
      if (g.refund) { // older backend refunded on its own
        state.order = null;
        showNotification(t(g.refund === 'refund_required' ? 'error.generationFailedManualRefund' : 'error.generationFailedRefund'));
        return;
      }
      return handlePaidGenerationFailure(opts, 'render_failed');
    }
    console.log('[RENDERER] Generation finished:', JSON.stringify({
      type: g.type, started: g.started, render: !!g.render, renderError: g.renderError || null,
      ms: Date.now() - g.startedAt
    }));

    // Defensive: if no stream events reached us (shouldn't happen - the API
    // client synthesises them for non-streaming backends), use the result.
    if (!g.started) {
      if ((result.generation_type || 'poem') === 'image' && result.image) {
        await processImageGeneration(result.image);
      } else {
        await processPoemGeneration({
          session_id: result.session_id, poem: result.poem,
          public_view_url: result.render && result.render.public_view_url
        });
      }
    }

  } catch (error) {
    console.error('[RENDERER] Process error:', error);
    // A failure during the paid moment shows once that moment is over
    if (opts.gate) await Promise.resolve(opts.gate).catch(() => {});
    stopProcessingStars();
    state.generateHandler = null;
    state.isProcessing = false;  // Explicit reset on error
    destroyLottieAnimation();    // Clean up animation
    if (orderId) {
      // Pay-first: the backend refunds the payment when the first generation
      // fails and says whether that worked ('payment_refund' event; a card
      // payment can only be voided shortly after the tap). 402 = the order
      // was not accepted at all.
      const paymentRejected = /HTTP 402/.test(error && error.message || '');
      const g = state.generate || {};
      if (paymentRejected) {
        state.order = null;
        showNotification(t('error.paymentRequired'));
        return;
      }
      if (g.refund) { // older backend refunded on its own
        state.order = null;
        showNotification(t(g.refund === 'refund_required' ? 'error.generationFailedManualRefund' : 'error.generationFailedRefund'));
        return;
      }
      // The guest already paid: retry with the same photo, then ask for a new one
      return handlePaidGenerationFailure(opts, g.errorCode);
    }
    showNotification(t('error.processingFailed'));
  }
}

// Downscale a captured photo (data URL) for upload. Keeps the orientation that
// capturePhoto already baked in. Returns the original on any failure.
export function downscalePhotoDataUrl(dataUrl, maxEdge = 2048, quality = 0.85) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          // Already small enough (capturePhoto caps at CAPTURE_MAX_EDGE): don't
          // re-encode a second time.
          if (scale >= 1) return resolve(dataUrl);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) return resolve(dataUrl);
            const reader = new FileReader();
            reader.onload = () => {
              console.log(`[RENDERER] Upload photo: ${img.width}x${img.height} → ${w}x${h}, ${(blob.size / 1024).toFixed(0)} KB`);
              resolve(reader.result);
            };
            reader.onerror = () => resolve(dataUrl);
            reader.readAsDataURL(blob);
          }, 'image/jpeg', quality);
        } catch (e) {
          console.warn('[RENDERER] Downscale failed, sending original:', e.message);
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (e) {
      resolve(dataUrl);
    }
  });
}

// Non-blocking toast on the current screen (showNotification() returns the
// guest to the booth, which is wrong when the poem is already on screen).
export let toastTimeout = null;
export function showToast(message, duration = 6000) {
  if (!elements.notificationMessage) return;
  if (toastTimeout) clearTimeout(toastTimeout);
  elements.notificationMessage.textContent = message;
  const toast = document.getElementById('notification-toast');
  if (toast) {
    toast.style.display = 'block';
    toast.classList.add('show');
  }
  toastTimeout = setTimeout(() => {
    if (toast) {
      toast.classList.remove('show');
      toast.style.display = 'none';
    }
  }, duration);
}

// Drive the UI from the backend's generation stream (see apiClient.generateContent)
export function handleGenerateEvent(evt) {
  const g = state.generate;
  if (!g || !evt) return;
  switch (evt.type) {
    case 'start':
      g.started = true;
      g.sessionId = evt.session_id || null;
      g.type = evt.generation_type || 'poem';
      state.currentSession = { id: g.sessionId };
      state.currentPrintBuffer = null;
      state.currentPrintUrl = null;
      console.log(`[RENDERER] Generation started: session ${g.sessionId}, type ${g.type}, +${Date.now() - g.startedAt}ms`);
      if (g.type === 'poem') {
        // Buffer the streamed tokens; the processing screen (photo + spinner)
        // stays up until the whole poem is in. Typing only starts once the
        // full text is known so the font size is computed exactly once —
        // sizing provisionally while streaming made the text visibly jump.
        g.poemStream = { text: '', done: false };
        updateProgress('Writing your poem...', 40);
      }
      break;

    case 'poem_delta':
      if (g.poemStream) g.poemStream.text += evt.text || '';
      break;

    case 'poem_done':
      if (g.poemStream) {
        if (typeof evt.poem === 'string' && evt.poem.length) g.poemStream.text = evt.poem;
        g.poemStream.done = true;
      }
      console.log(`[RENDERER] Poem complete (${g.poemStream ? g.poemStream.text.length : 0} chars), +${Date.now() - g.startedAt}ms`);
      updateProgress('Creating artwork...', 70);
      if (g.poemStream && g.poemStream.text) {
        const text = g.poemStream.text;
        Promise.resolve(state.revealGate).then(() => {
          if (state.generate !== g) return;
          g.resultShown = true;
          stopProcessingStars();
          showPoemWithTypingEffect(text);
        });
      }
      break;

    case 'image_result':
      g.type = 'image';
      processImageGeneration({ ...evt, session_id: evt.session_id || g.sessionId });
      break;

    case 'render':
      g.render = evt;
      state.currentPrintUrl = evt.print_image_url || evt.rendered_image_url || null;
      state.lastResultImage = evt.rendered_image_url || evt.print_image_url || null; // retake "keep" card
      state.currentPrintFormat = evt.print_format || state.currentPrintFormat || '4x6';
      state.currentPrintOrientation = evt.print_orientation || state.currentPrintOrientation || 'portrait';
      state.isProcessing = false;
      updateProgress('Complete!', 100);
      console.log(`[RENDERER] Render ready, QR + print asset available, +${Date.now() - g.startedAt}ms`);
      updatePrintContainerVisibility();
      setTimeout(() => showQRCode(evt.public_view_url), 300);
      break;

    case 'render_error':
      g.renderError = evt.error || 'render failed';
      state.isProcessing = false;
      state.currentPrintUrl = null;
      console.error('[RENDERER] Backend render failed:', g.renderError);
      updatePrintContainerVisibility();
      if (state.order) {
        // Pay-first: no print asset means nothing to hand over; processPhoto
        // retries (or refunds) once the stream is done.
        g.paidRenderFailed = true;
        break;
      }
      // Keep the poem on screen; just tell the guest there is no download/print
      showToast(t('error.renderFailed'));
      break;

    case 'error':
      g.error = evt.error || 'generation failed';
      g.errorCode = evt.code || null; // e.g. content_blocked: the model refused this photo
      break; // the invoke rejects; processPhoto's catch handles it

    case 'order_attempt_released':
      // Pay-first: the failed attempt does not count against the order
      g.attemptReleased = evt.released !== false;
      break;

    case 'payment_refund':
      // Pay-first: was the payment of a failed generation really returned?
      g.refund = evt.status;
      console.log(`[RENDERER] Payment refund for order ${evt.order_id}: ${evt.status}`);
      break;

    case 'done':
      g.done = true;
      if (g.type === 'poem' && !g.render && !g.renderError) {
        state.isProcessing = false;
        console.warn('[RENDERER] Stream done without render result');
      }
      break;

    default:
      console.log('[RENDERER] Unhandled generate event:', evt.type);
  }
}

// Process poem generation response
export async function processPoemGeneration(response) {
  try {
    // Extract poem data from response
    state.currentSession = response.session || { id: response.session_id };
    const sessionId = response.session_id || response.session?.id;
    const poemText = response.poem?.text || response.poem;
    const brandingConfig = response.branding_config || response.branding || state.kioskConfig?.branding;

    // Validate poem data
    if (!poemText) {
      throw new Error('No poem text received from backend');
    }

    // Extract branding template from config (API returns nested structure)
    const brandingTemplate = brandingConfig?.template || brandingConfig;

    // Extract print config from API response
    state.currentPrintFormat = brandingTemplate?.print_format || '4x6';
    state.currentPrintOrientation = brandingTemplate?.print_orientation || 'portrait';

    console.log('[RENDERER] Poem generated, session ID:', sessionId);
    console.log('[RENDERER] Poem text length:', poemText.length, 'chars');
    console.log('[RENDERER] Print format:', state.currentPrintFormat, 'orientation:', state.currentPrintOrientation);
    console.log('[RENDERER] Template output:', brandingTemplate?.output_width, 'x', brandingTemplate?.output_height, '@', brandingTemplate?.output_dpi, 'DPI');

    // Show poem text immediately with typing effect
    showPoemWithTypingEffect(poemText);

    // Rendering happens on the backend now (Fly.io renderer via the dashboard).
    // A non-streaming backend may already include the result; the streaming
    // flow delivers it as a separate 'render' event (see processPhoto).
    state.currentPrintBuffer = null;
    state.isProcessing = false;

    if (response.public_view_url) {
      setTimeout(() => showQRCode(response.public_view_url), 500);
    } else {
      console.warn('[RENDERER] No rendered image/QR in generate response');
    }

  } catch (error) {
    console.error('[RENDERER] Poem processing error:', error);
    state.isProcessing = false;  // Explicit reset on error
    destroyLottieAnimation();    // Clean up animation
    showNotification(t('error.generationFailed'));
    return; // Don't re-throw, gracefully handle
  }
}

// Process image generation response
export async function processImageGeneration(response) {
  try {
    // Extract image data from response
    state.currentSession = response.session || { id: response.session_id };
    const sessionId = response.session_id || response.session?.id;
    const generatedImage = response.generated_image;
    const imageType = response.generated_image_type || 'image/png';

    // Extract print config for image styles
    const printConfig = response.print_config || {};
    state.currentPrintFormat = printConfig.paper_size || '4x3';
    // Derive orientation from aspect ratio if not explicitly provided
    const aspectRatio = printConfig.aspect_ratio || '2:3';
    const [w, h] = aspectRatio.split(':').map(Number);
    state.currentPrintOrientation = (w > h) ? 'landscape' : 'portrait';

    console.log('[RENDERER] AI image generated, session ID:', sessionId);
    console.log('[RENDERER] Response keys:', Object.keys(response));
    console.log('[RENDERER] Has generated_image:', !!generatedImage);
    console.log('[RENDERER] Has storage_url:', !!response.storage_url);
    console.log('[RENDERER] Has rendered_image_url:', !!response.rendered_image_url);
    console.log('[RENDERER] Print format:', state.currentPrintFormat, 'orientation:', state.currentPrintOrientation);

    // Handle two scenarios:
    // 1. Backend returns image data directly (generated_image field)
    // 2. Backend generates and uploads image, returns URL only
    let imageDataUrl;
    let imageBuffer;

    if (generatedImage) {
      // Scenario 1: Backend returned base64 image data
      console.log('[RENDERER] Using generated_image from response');

      // Convert base64 to data URL
      imageDataUrl = `data:${imageType};base64,${generatedImage}`;

      // Convert base64 to ArrayBuffer (browser-compatible)
      const binaryString = atob(generatedImage);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      imageBuffer = bytes.buffer;

      console.log('[RENDERER] ✅ Image buffer created:', bytes.length, 'bytes',
                  '(' + (bytes.length / 1024 / 1024).toFixed(2) + ' MB)');
    } else if (response.storage_url || response.rendered_image_url) {
      // Scenario 2: Backend uploaded image, only URL provided
      const imageUrl = response.storage_url || response.rendered_image_url;
      console.log('[RENDERER] Fetching image from URL:', imageUrl);

      updateProgress('Downloading image...', 50);

      try {
        // Fetch the image from the URL
        const fetchResponse = await fetch(imageUrl);
        if (!fetchResponse.ok) {
          throw new Error(`Failed to fetch image: ${fetchResponse.status}`);
        }

        const blob = await fetchResponse.blob();
        imageBuffer = await blob.arrayBuffer();

        // Convert to data URL for display
        imageDataUrl = URL.createObjectURL(blob);

        console.log('[RENDERER] ✅ Image fetched from URL:', imageBuffer.byteLength, 'bytes',
                    '(' + (imageBuffer.byteLength / 1024 / 1024).toFixed(2) + ' MB)');
      } catch (fetchError) {
        console.error('[RENDERER] Failed to fetch image from URL:', fetchError);
        throw new Error(`Could not download image: ${fetchError.message}`);
      }
    } else {
      // No image data or URL provided
      console.error('[RENDERER] Response missing both generated_image and storage_url');
      throw new Error('No image data or URL received from backend');
    }

    updateProgress('Preparing image...', 60);

    // Store for printing (print directly, no re-rendering)
    state.currentPrintBuffer = imageBuffer;
    state.lastResultImage = imageDataUrl; // retake "keep" card

    // The paid moment may still be on screen: wait for it
    if (state.revealGate) await state.revealGate;
    if (state.generate) state.generate.resultShown = true;
    stopProcessingStars();

    // Destroy loading animation
    destroyLottieAnimation();

    // Show result screen FIRST before setting image sources
    showScreen('result');

    // Display image in result screen (reuse poem display layout)
    // Clear any poem text
    if (elements.poemText) {
      elements.poemText.textContent = '';
      elements.poemText.classList.remove('typing-complete');
    }

    // For AI-generated images, swap the black background for the live blurred camera feed
    if (elements.resultPhoto) {
      elements.resultPhoto.src = '';
      elements.resultPhoto.style.display = 'none';
    }
    showResultCameraBackground();

    // Display centered image on result overlay
    // Show the image in the poem text area, but as an <img> instead of text
    if (elements.poemText) {
      // Add centering class to overlay
      const poemOverlay = elements.poemText.parentElement;
      if (poemOverlay) {
        poemOverlay.classList.add('image-display');
      }
      elements.poemText.innerHTML = ''; // Clear text

      // Wrap the image so the watermark can be clipped to the image bounds
      const wrap = document.createElement('div');
      wrap.className = 'result-image-wrap';
      const imageElement = document.createElement('img');
      imageElement.src = imageDataUrl;
      imageElement.alt = '';
      wrap.appendChild(imageElement);
      // The watermark lives inside the wrap so overflow:hidden trims anything past the image
      if (elements.resultWatermark) wrap.appendChild(elements.resultWatermark);
      elements.poemText.appendChild(wrap);
      playReveal(); // TADAAA

      // Apply paid-mode extras (watermark) now that it sits inside the image wrap
      updateResultPaymentUI();

      // Hide blinking cursor for image generation (cursor is for poem typing effect)
      elements.poemText.classList.add('typing-complete');
    }

    // Adapt the QR label to the printer state (print & save vs save)
    updateResultActionLabel();

    // Show/hide the hold-to-print circle (free mode + printer)
    updatePrintContainerVisibility();

    // If image was already uploaded by backend, skip upload step
    if (response.storage_url || response.rendered_image_url) {
      console.log('[RENDERER] Image already uploaded by backend, skipping upload');
      updateProgress('Complete!', 100);

      // Reset processing state IMMEDIATELY (not inside setTimeout)
      state.isProcessing = false;

      // Show QR code with slight delay for visual effect
      setTimeout(() => {
        showQRCode(response.public_view_url || response.public_url);
      }, 500);
    } else {
      // Upload AI-generated image if not already uploaded
      updateProgress('Uploading image...', 80);

      const quality = state.kioskConfig?.branding?.quality || 'standard';
      const uploadResponse = await window.electronAPI.apiUploadImage(
        imageBuffer,
        sessionId,
        quality
      );

      updateProgress('Complete!', 100);

      // Reset processing state IMMEDIATELY (not inside setTimeout)
      state.isProcessing = false;

      // Show QR code with slight delay for visual effect
      setTimeout(() => {
        showQRCode(uploadResponse.public_view_url || uploadResponse.public_url);
      }, 500);
    }

  } catch (error) {
    console.error('[RENDERER] Image processing error:', error);
    state.isProcessing = false;  // Explicit reset on error
    destroyLottieAnimation();    // Clean up animation
    showNotification(t('error.generationFailed'));
    return; // Don't re-throw, gracefully handle
  }
}
